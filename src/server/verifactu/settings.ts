import { eq } from "drizzle-orm";

import { company, companySettings, verifactuRecord } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { recordAudit } from "@/server/audit";
import { getVerifactuReadiness } from "@/server/verifactu/certificates";
import { appendEvent, type VerifactuMode } from "@/server/verifactu/chain";
import { isValidIssuerNifFormat, normalizeIssuerNif } from "@/server/verifactu/format";

/**
 * "non_verifactu" es un modo heredado: ya no se puede elegir (el sistema solo funciona como
 * VERI*FACTU; la modalidad sin remisión exige firma electrónica de cada registro y un registro de
 * eventos con formato AEAT que no implementamos). Las empresas que lo tuvieran ya NO generan
 * registros (serían no conformes): la emisión se bloquea hasta que activen VERI*FACTU
 * (ver `registerIssuedInvoiceRecord`).
 */
export type VerifactuModeSetting = "pending" | "verifactu" | "non_verifactu";

export type VerifactuSettings = {
  /** ¿El país de la empresa usa VERI*FACTU? Si no, el modo es siempre "pending" (sin registros). */
  applies: boolean;
  mode: VerifactuModeSetting;
  since: Date | null;
  issuerTaxId: string | null;
  issuerName: string;
};

export function normalizeVerifactuModeSetting(value: string | null | undefined): VerifactuModeSetting {
  return value === "verifactu" || value === "non_verifactu" ? value : "pending";
}

/** Modo del registro: null si la empresa todavía no genera registros de facturación. */
export function recordModeFor(setting: VerifactuModeSetting): VerifactuMode | null {
  if (setting === "verifactu") return "VERIFACTU";
  if (setting === "non_verifactu") return "NO_VERIFACTU";
  return null;
}

export async function getVerifactuSettings(client: DbClient, companyId: string): Promise<VerifactuSettings> {
  const [row] = await client
    .select({
      mode: companySettings.verifactuMode,
      since: companySettings.verifactuSince,
      vatNumber: company.vatNumber,
      name: company.name,
      legalName: company.legalName,
      countryCode: company.countryCode,
    })
    .from(company)
    .leftJoin(companySettings, eq(companySettings.companyId, company.id))
    .where(eq(company.id, companyId))
    .limit(1);
  const applies = getCountryFiscalProfile(row?.countryCode).features.eInvoicing === "verifactu";
  return {
    applies,
    mode: applies ? normalizeVerifactuModeSetting(row?.mode) : "pending",
    since: row?.since ?? null,
    issuerTaxId: row?.vatNumber ? normalizeIssuerNif(row.vatNumber) : null,
    issuerName: row?.legalName?.trim() || row?.name || "",
  };
}

/** Margen máximo para programar el inicio: más allá es casi seguro un error al teclear el año. */
export const MAX_SINCE_AHEAD_DAYS = 366;
/** Entrada en vigor de la Orden HAC/1177/2024: la AEAT no admite facturas con fecha anterior. */
const EARLIEST_SINCE = new Date("2024-10-28T00:00:00Z");

/**
 * Valida la fecha de inicio. Es el instante a partir del cual las facturas que SE EMITAN llevan
 * registro (cuenta el momento real de la emisión, no la fecha que figure en la factura).
 */
export function assertValidVerifactuSince(since: Date | null, now = new Date()) {
  if (!since) return;
  if (Number.isNaN(since.getTime())) throw new HttpError(400, "La fecha de inicio no es válida.");
  if (since.getTime() < EARLIEST_SINCE.getTime()) {
    throw new HttpError(422, "La fecha de inicio no puede ser anterior al 28-10-2024 (entrada en vigor de VERI*FACTU). Déjala vacía para empezar ya.");
  }
  if (since.getTime() > now.getTime() + MAX_SINCE_AHEAD_DAYS * 86_400_000) {
    throw new HttpError(422, "La fecha de inicio no puede estar a más de un año vista: revisa el año. Mientras llegue esa fecha tus facturas se emiten sin registro.");
  }
}

export type VerifactuSettingsInput = {
  mode: VerifactuModeSetting;
  since: Date | null;
};

/**
 * Activa VERI*FACTU. Exige un NIF español válido de la empresa (es el IDEmisorFactura de todos los
 * registros) y que el envío a la AEAT esté operativo para ella: no se puede anunciar una factura
 * como verificable si no se remite. Una vez activado no se desactiva ni se cambia de modalidad, y
 * la fecha de inicio queda fijada con el primer registro. Deja constancia en auditoría y eventos.
 */
export async function updateVerifactuSettings(
  actor: { tenantId: string; companyId: string; actorUserId: string },
  input: VerifactuSettingsInput,
) {
  return db.transaction(async (tx) => {
    const current = await getVerifactuSettings(tx, actor.companyId);
    if (!current.applies) {
      throw new HttpError(422, "VERI*FACTU es el sistema de facturación verificable de España: no aplica al país de esta empresa.");
    }
    if (input.mode !== "pending" && !isValidIssuerNifFormat(current.issuerTaxId)) {
      throw new HttpError(
        422,
        "Para activar VeriFactu la empresa necesita un NIF válido. Complétalo en Configuración › Empresa y vuelve a intentarlo.",
      );
    }
    if (current.mode !== "pending" && input.mode === "pending") {
      throw new HttpError(409, "Una vez activado, el sistema debe seguir generando registros de facturación: no se puede desactivar.");
    }
    if (input.mode === "non_verifactu" && current.mode !== "non_verifactu") {
      throw new HttpError(422, "La modalidad NO VERI*FACTU ya no está disponible: este sistema solo funciona como VERI*FACTU.");
    }
    if (current.mode === "verifactu" && input.mode !== "verifactu") {
      throw new HttpError(409, "La opción por VERI*FACTU no se puede cambiar una vez activada.");
    }
    if (input.mode === "verifactu" && current.mode !== "verifactu") {
      const readiness = await getVerifactuReadiness(tx, actor.companyId);
      if (!readiness.operational) {
        throw new HttpError(409, `Todavía no se puede activar VERI*FACTU porque el envío a la AEAT no está operativo: ${readiness.reason}`);
      }
    }
    const sinceChanged = (current.since?.getTime() ?? null) !== (input.since?.getTime() ?? null);
    if (sinceChanged) {
      // Con registros generados el inicio ya ocurrió: moverlo dejaría facturas sin registro o huecos sin explicar.
      const [existing] = await tx.select({ id: verifactuRecord.id }).from(verifactuRecord).where(eq(verifactuRecord.companyId, actor.companyId)).limit(1);
      if (existing) throw new HttpError(409, "La fecha de inicio no se puede cambiar: ya hay registros de facturación generados.");
      assertValidVerifactuSince(input.since);
    }
    const values = { verifactuMode: input.mode, verifactuSince: input.since, updatedAt: new Date() };
    const [existing] = await tx
      .select({ id: companySettings.id })
      .from(companySettings)
      .where(eq(companySettings.companyId, actor.companyId))
      .limit(1);
    if (existing) {
      await tx.update(companySettings).set(values).where(eq(companySettings.id, existing.id));
    } else {
      await tx.insert(companySettings).values({ companyId: actor.companyId, verifactuMode: input.mode, verifactuSince: input.since });
    }
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "verifactu.settings",
      entityName: "companySettings",
      entityId: actor.companyId,
      payload: { from: current.mode, to: input.mode, since: input.since?.toISOString() ?? null },
    }, tx);
    if (current.mode !== input.mode && input.mode !== "pending") {
      await appendEvent(tx, {
        companyId: actor.companyId,
        eventType: current.mode === "pending" ? "SYSTEM_START" : "MODE_CHANGED",
        description: current.mode === "pending"
          ? "Inicio del sistema de registro de facturación en modo VERI*FACTU."
          : `Cambio de modo: ${current.mode} → ${input.mode}.`,
        payload: { from: current.mode, to: input.mode, since: input.since?.toISOString() ?? null },
        actorUserId: actor.actorUserId,
      });
    }
    return { mode: input.mode, since: input.since };
  });
}

import { eq } from "drizzle-orm";

import { company, companySettings } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { appendEvent, type VerifactuMode } from "@/server/verifactu/chain";
import { isValidIssuerNifFormat, normalizeIssuerNif } from "@/server/verifactu/format";

export type VerifactuModeSetting = "pending" | "verifactu" | "non_verifactu";

export type VerifactuSettings = {
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
    })
    .from(company)
    .leftJoin(companySettings, eq(companySettings.companyId, company.id))
    .where(eq(company.id, companyId))
    .limit(1);
  return {
    mode: normalizeVerifactuModeSetting(row?.mode),
    since: row?.since ?? null,
    issuerTaxId: row?.vatNumber ? normalizeIssuerNif(row.vatNumber) : null,
    issuerName: row?.legalName?.trim() || row?.name || "",
  };
}

export type VerifactuSettingsInput = {
  mode: VerifactuModeSetting;
  since: Date | null;
};

/**
 * Activa o cambia el modo VERI*FACTU. Exige un NIF español válido de la empresa (es el
 * IDEmisorFactura de todos los registros) y deja constancia en auditoría y en el registro de eventos.
 */
export async function updateVerifactuSettings(
  actor: { tenantId: string; companyId: string; actorUserId: string },
  input: VerifactuSettingsInput,
) {
  return db.transaction(async (tx) => {
    const current = await getVerifactuSettings(tx, actor.companyId);
    if (input.mode !== "pending" && !isValidIssuerNifFormat(current.issuerTaxId)) {
      throw new HttpError(
        422,
        "Para activar VeriFactu la empresa necesita un NIF válido. Complétalo en Configuración › Empresa y vuelve a intentarlo.",
      );
    }
    if (current.mode !== "pending" && input.mode === "pending") {
      throw new HttpError(
        409,
        "Una vez activado, el sistema debe seguir generando registros de facturación. Puedes cambiar entre VERI*FACTU y NO VERI*FACTU, pero no desactivarlo.",
      );
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
          ? `Inicio del sistema de registro de facturación en modo ${input.mode === "verifactu" ? "VERI*FACTU" : "NO VERI*FACTU"}.`
          : `Cambio de modo: ${current.mode} → ${input.mode}.`,
        payload: { from: current.mode, to: input.mode, since: input.since?.toISOString() ?? null },
        actorUserId: actor.actorUserId,
      });
    }
    return { mode: input.mode, since: input.since };
  });
}

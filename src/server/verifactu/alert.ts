import { cache } from "react";

import { and, eq, inArray, sql } from "drizzle-orm";

import { verifactuRecord } from "@/db/schema";
import { db } from "@/lib/db";
import { certificateValidity, getCompanyCertificateInfo, getSystemCertificateInfo } from "@/server/verifactu/certificates";
import { getVerifactuTransportConfig, readVerifactuEnvironment } from "@/server/verifactu/config";
import { PENDING_OVERDUE_MS } from "@/server/verifactu/service";
import { getVerifactuSettings, type VerifactuModeSetting } from "@/server/verifactu/settings";

/*
 * Aviso global de VERI*FACTU: la versión ligera de `getVerifactuHealth` para pintar en todas las
 * pantallas. Solo mira lo grave —registros sin remitir desde hace más de una hora, rechazados sin
 * corregir y certificado caducado— y cuesta poco: una empresa sin VERI*FACTU activo se resuelve con
 * la lectura de sus ajustes; el resto, con una consulta agregada y la del certificado. Memoizado
 * por petición con React `cache()`; el navegador lo guarda además unos minutos.
 */

export type VerifactuAlertInput = {
  mode: VerifactuModeSetting;
  overduePending: number;
  rejected: number;
  /** Certificado con el que se remite, caducado: el de la empresa o el del sistema. */
  expiredCertificate: "company" | "system" | null;
};

export type VerifactuAlert = {
  /** Frases cortas, una por problema, listas para enseñar. */
  problems: string[];
  href: string;
};

const plural = (total: number, one: string, many: string) => `${total.toLocaleString("es-ES")} ${total === 1 ? one : many}`;

/** Problemas graves a partir de los datos ya leídos (código puro). null = nada que avisar. */
export function buildVerifactuAlert(input: VerifactuAlertInput): VerifactuAlert | null {
  if (input.mode === "pending") return null;
  const problems: string[] = [];
  if (input.expiredCertificate) {
    problems.push(input.expiredCertificate === "system" ? "el certificado electrónico del sistema está caducado" : "tu certificado electrónico está caducado");
  }
  if (input.rejected > 0) problems.push(`${plural(input.rejected, "factura rechazada", "facturas rechazadas")} por la AEAT`);
  if (input.overduePending > 0) problems.push(`${plural(input.overduePending, "factura lleva", "facturas llevan")} más de una hora sin enviarse a la AEAT`);
  return problems.length > 0 ? { problems, href: "/fiscal/verifactu" } : null;
}

async function loadVerifactuAlert(companyId: string): Promise<VerifactuAlert | null> {
  const settings = await getVerifactuSettings(db, companyId);
  // Sin VERI*FACTU activo no hay registros que vigilar: ni una consulta más.
  if (settings.mode === "pending") return null;
  const environment = readVerifactuEnvironment().environment;
  if (!environment) return null;
  const now = new Date();
  const overdueBefore = new Date(now.getTime() - PENDING_OVERDUE_MS);
  const sending = settings.mode === "verifactu" && getVerifactuTransportConfig().kind === "aeat";
  const [[counts], ownCertificate] = await Promise.all([
    db
      .select({
        overdue: sql<number>`count(*) filter (where ${verifactuRecord.status} = 'PENDING_SEND' and ${verifactuRecord.mode} = 'VERIFACTU' and ${verifactuRecord.generatedAt} < ${overdueBefore})`.mapWith(Number),
        // Rechazados que siguen siendo el último registro de su factura (los ya subsanados no cuentan).
        rejected: sql<number>`count(*) filter (where ${verifactuRecord.status} = 'REJECTED' and not exists (select 1 from "verifactu_record" as later where later."invoiceId" = ${verifactuRecord.invoiceId} and later."generatedAt" > ${verifactuRecord.generatedAt}))`.mapWith(Number),
      })
      .from(verifactuRecord)
      .where(and(eq(verifactuRecord.companyId, companyId), eq(verifactuRecord.environment, environment), inArray(verifactuRecord.status, ["PENDING_SEND", "REJECTED"]))),
    sending ? getCompanyCertificateInfo(db, companyId) : Promise.resolve(null),
  ]);
  let expiredCertificate: VerifactuAlertInput["expiredCertificate"] = null;
  if (sending) {
    if (ownCertificate) {
      if (certificateValidity(ownCertificate.validTo, now).expired) expiredCertificate = "company";
    } else {
      const system = await getSystemCertificateInfo();
      if (system?.validTo && certificateValidity(system.validTo, now).expired) expiredCertificate = "system";
    }
  }
  return buildVerifactuAlert({ mode: settings.mode, overduePending: counts?.overdue ?? 0, rejected: counts?.rejected ?? 0, expiredCertificate });
}

/** Aviso global de la empresa (null si todo va bien). Una sola lectura por petición. */
export const getVerifactuAlert = cache(loadVerifactuAlert);

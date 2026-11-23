import { createSecureContext } from "node:tls";

import { eq } from "drizzle-orm";

import { verifactuCertificate } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { openSecret, sealSecret } from "@/lib/secret-box";
import { recordAudit } from "@/server/audit";
import { getVerifactuTransportConfig } from "@/server/verifactu/config";
import type { VerifactuCredentials } from "@/server/verifactu/transport";

/**
 * Certificado electrónico de cada empresa para remitir sus registros a la AEAT (mTLS).
 *
 * El obligado tributario remite con su propio certificado (o el de su representante). El
 * certificado del sistema (VERIFACTU_CERT_PATH) solo sirve para las empresas sin certificado
 * propio y exige que su titular sea colaborador social o apoderado de cada una ante la AEAT.
 */

const PURPOSE = "verifactu-certificate";
export const MAX_CERTIFICATE_BYTES = 64 * 1024;

type Env = Record<string, string | undefined>;

function encryptionSecret(env: Env = process.env) {
  const secret = env.INTEGRATIONS_ENCRYPTION_KEY?.trim() || env.JWT_SECRET?.trim();
  if (!secret) throw new Error("Falta JWT_SECRET para cifrar el certificado electrónico.");
  return secret;
}

/** Comprueba que el fichero es un PKCS#12 que se abre con esa contraseña (clave privada incluida). */
export function assertUsablePfx(pfx: Buffer, passphrase: string) {
  try {
    createSecureContext({ pfx, passphrase });
  } catch {
    throw new HttpError(422, "No se pudo abrir el certificado: comprueba que es un fichero .p12 o .pfx y que la contraseña es correcta.");
  }
}

export type CompanyCertificateInfo = { fileName: string | null; uploadedAt: Date };

export async function getCompanyCertificateInfo(client: DbClient, companyId: string): Promise<CompanyCertificateInfo | null> {
  const [row] = await client
    .select({ fileName: verifactuCertificate.fileName, uploadedAt: verifactuCertificate.createdAt })
    .from(verifactuCertificate)
    .where(eq(verifactuCertificate.companyId, companyId))
    .limit(1);
  return row ?? null;
}

/** Credenciales mTLS de la empresa; null si no ha subido certificado (se usará el del sistema, si hay). */
export async function loadCompanyCredentials(client: DbClient, companyId: string): Promise<VerifactuCredentials | null> {
  const [row] = await client
    .select({ pfxEncrypted: verifactuCertificate.pfxEncrypted, passphraseEncrypted: verifactuCertificate.passphraseEncrypted })
    .from(verifactuCertificate)
    .where(eq(verifactuCertificate.companyId, companyId))
    .limit(1);
  if (!row) return null;
  const secret = encryptionSecret();
  return {
    pfx: Buffer.from(openSecret(row.pfxEncrypted, PURPOSE, secret), "base64"),
    passphrase: openSecret(row.passphraseEncrypted, PURPOSE, secret),
  };
}

type Actor = { tenantId: string; companyId: string; actorUserId: string };

export async function saveCompanyCertificate(actor: Actor, input: { pfx: Buffer; passphrase: string; fileName: string | null }) {
  if (input.pfx.length === 0) throw new HttpError(400, "Selecciona el fichero del certificado (.p12 o .pfx).");
  if (input.pfx.length > MAX_CERTIFICATE_BYTES) throw new HttpError(413, "El fichero del certificado es demasiado grande.");
  assertUsablePfx(input.pfx, input.passphrase);
  const secret = encryptionSecret();
  const values = {
    pfxEncrypted: sealSecret(input.pfx.toString("base64"), PURPOSE, secret),
    passphraseEncrypted: sealSecret(input.passphrase, PURPOSE, secret),
    fileName: input.fileName?.slice(0, 200) ?? null,
    uploadedByUserId: actor.actorUserId,
    createdAt: new Date(),
  };
  await db.transaction(async (tx) => {
    await tx
      .insert(verifactuCertificate)
      .values({ companyId: actor.companyId, ...values })
      .onConflictDoUpdate({ target: verifactuCertificate.companyId, set: values });
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "verifactu.certificate.save",
      entityName: "verifactuCertificate",
      entityId: actor.companyId,
      payload: { fileName: values.fileName },
    }, tx);
  });
}

export async function deleteCompanyCertificate(actor: Actor) {
  await db.transaction(async (tx) => {
    await tx.delete(verifactuCertificate).where(eq(verifactuCertificate.companyId, actor.companyId));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "verifactu.certificate.delete",
      entityName: "verifactuCertificate",
      entityId: actor.companyId,
      payload: {},
    }, tx);
  });
}

export type VerifactuReadiness = {
  /** El envío a la AEAT funciona para esta empresa: transporte activo y certificado disponible. */
  operational: boolean;
  reason: string | null;
  certificate: "company" | "system" | null;
};

/**
 * ¿Puede esta empresa remitir a la AEAT ahora mismo? De ello dependen la activación del modo y la
 * leyenda «VERI*FACTU» de las facturas: no se puede anunciar una factura como verificable si el
 * sistema no la está remitiendo.
 */
export async function getVerifactuReadiness(client: DbClient, companyId: string, env: Env = process.env): Promise<VerifactuReadiness> {
  const transport = getVerifactuTransportConfig(env);
  if (transport.kind === "disabled") return { operational: false, reason: transport.reason, certificate: null };
  const own = await getCompanyCertificateInfo(client, companyId);
  if (own) return { operational: true, reason: null, certificate: "company" };
  if (transport.certPath) return { operational: true, reason: null, certificate: "system" };
  return { operational: false, reason: "La empresa no ha subido su certificado electrónico.", certificate: null };
}

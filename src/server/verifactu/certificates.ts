import { X509Certificate } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createSecureContext } from "node:tls";

import { eq } from "drizzle-orm";

import { company, verifactuCertificate } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { openSecret, sealSecret } from "@/lib/secret-box";
import { recordAudit } from "@/server/audit";
import { getVerifactuTransportConfig } from "@/server/verifactu/config";
import { normalizeIssuerNif } from "@/server/verifactu/format";
import type { VerifactuCredentials } from "@/server/verifactu/transport";

/**
 * Certificado electrónico de cada empresa para remitir sus registros a la AEAT (mTLS).
 *
 * El obligado tributario remite con su propio certificado (o el de su representante). El
 * certificado del sistema (VERIFACTU_CERT_PATH) solo sirve para las empresas sin certificado
 * propio y exige que su titular sea colaborador social o apoderado de cada una ante la AEAT.
 *
 * Al subirlo se lee el X.509: se guardan titular y caducidad, se rechaza si está caducado, se
 * avisa si el NIF del titular no es el de la empresa y se anota si es de sello electrónico (la
 * AEAT tiene un punto de acceso propio para ellos).
 */

const PURPOSE = "verifactu-certificate";
export const MAX_CERTIFICATE_BYTES = 64 * 1024;
/** Días de antelación con los que se avisa de la caducidad. */
export const CERTIFICATE_EXPIRY_WARNING_DAYS = 30;

type Env = Record<string, string | undefined>;

function encryptionSecret(env: Env = process.env) {
  const secret = env.INTEGRATIONS_ENCRYPTION_KEY?.trim() || env.JWT_SECRET?.trim();
  if (!secret) throw new Error("Falta JWT_SECRET para cifrar el certificado electrónico.");
  return secret;
}

export type CertificateDetails = {
  /** Titular (DN del X.509 en una línea); null si no se pudo leer el certificado del fichero. */
  subject: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  /** NIF que aparecen en el titular (persona, entidad representada, sello). */
  nifs: string[];
  /** El titular indica que es un certificado de sello electrónico. */
  looksLikeSeal: boolean;
};

const NIF_IN_SUBJECT = /(?<![0-9A-Z])([0-9A-Z][0-9]{7}[0-9A-Z])(?![0-9A-Z])/g;

/** NIF presentes en el titular: `serialNumber=IDCES-…`, `organizationIdentifier=VATES-…`, «(R: B…)», etc. */
export function certificateSubjectNifs(subject: string): string[] {
  const found = new Set<string>();
  for (const match of subject.toUpperCase().matchAll(NIF_IN_SUBJECT)) {
    // Un NIF tiene siempre algún dígito y alguna letra: descarta palabras y números de 9 caracteres.
    if (/[A-Z]/.test(match[1])) found.add(match[1]);
  }
  return [...found];
}

/** Los certificados de sello llevan «SELLO ELECTRONICO» (o similar) en el titular. */
export function subjectLooksLikeSeal(subject: string) {
  return /\b(sello|seal)\b/i.test(subject);
}

export function describeX509(certificate: X509Certificate): CertificateDetails {
  const subject = certificate.subject.split("\n").map((part) => part.trim()).filter(Boolean).join(", ");
  const validFrom = new Date(certificate.validFrom);
  const validTo = new Date(certificate.validTo);
  return {
    subject: subject.slice(0, 500),
    validFrom: Number.isNaN(validFrom.getTime()) ? null : validFrom,
    validTo: Number.isNaN(validTo.getTime()) ? null : validTo,
    nifs: certificateSubjectNifs(subject),
    looksLikeSeal: subjectLooksLikeSeal(subject),
  };
}

const UNREADABLE: CertificateDetails = { subject: null, validFrom: null, validTo: null, nifs: [], looksLikeSeal: false };

/**
 * Abre el PKCS#12 con su contraseña (clave privada incluida) y lee su certificado.
 * Falla (422) si no se puede abrir. Si se abre pero no se puede leer el X.509, devuelve los datos
 * vacíos: quien llama decide (al subirlo se avisa de que no se podrá vigilar la caducidad).
 */
export function readPfxCertificate(pfx: Buffer, passphrase: string): CertificateDetails {
  let context: ReturnType<typeof createSecureContext>;
  try {
    context = createSecureContext({ pfx, passphrase });
  } catch {
    throw new HttpError(422, "No se pudo abrir el certificado: comprueba que es un fichero .p12 o .pfx y que la contraseña es correcta.");
  }
  try {
    // El contexto TLS ya ha descifrado el PKCS#12: se le pide el certificado de cliente en DER.
    const der = (context.context as { getCertificate?: () => Buffer | undefined }).getCertificate?.();
    return der ? describeX509(new X509Certificate(der)) : UNREADABLE;
  } catch {
    return UNREADABLE;
  }
}

/** Comprueba que el fichero es un PKCS#12 que se abre con esa contraseña (clave privada incluida). */
export function assertUsablePfx(pfx: Buffer, passphrase: string) {
  readPfxCertificate(pfx, passphrase);
}

export type CertificateValidity = { expired: boolean; expiringSoon: boolean; daysLeft: number | null };

/** Estado de caducidad. Sin fecha conocida (certificados subidos antes de este control) no se puede afirmar nada. */
export function certificateValidity(validTo: Date | null | undefined, now = new Date()): CertificateValidity {
  if (!validTo) return { expired: false, expiringSoon: false, daysLeft: null };
  const daysLeft = Math.floor((validTo.getTime() - now.getTime()) / 86_400_000);
  const expired = validTo.getTime() <= now.getTime();
  return { expired, expiringSoon: !expired && daysLeft <= CERTIFICATE_EXPIRY_WARNING_DAYS, daysLeft };
}

const shortDate = (date: Date) => new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" }).format(date);

/**
 * Revisión de un certificado antes de guardarlo: caducado o aún no vigente → error; titular que no
 * es la empresa o caducidad próxima → avisos (se guarda igualmente: puede ser el de un representante).
 */
export function reviewCertificate(details: CertificateDetails, companyTaxId: string | null, now = new Date()): string[] {
  const warnings: string[] = [];
  if (!details.subject) {
    warnings.push("No se pudieron leer el titular ni la caducidad del certificado: se ha guardado, pero no podremos avisarte antes de que caduque.");
    return warnings;
  }
  const validity = certificateValidity(details.validTo, now);
  if (validity.expired && details.validTo) {
    throw new HttpError(422, `Este certificado caducó el ${shortDate(details.validTo)}: la AEAT no lo admite. Renuévalo y sube el nuevo.`);
  }
  if (details.validFrom && details.validFrom.getTime() > now.getTime()) {
    throw new HttpError(422, `Este certificado todavía no es válido (lo será a partir del ${shortDate(details.validFrom)}).`);
  }
  if (validity.expiringSoon && details.validTo) {
    warnings.push(`El certificado caduca el ${shortDate(details.validTo)}: renuévalo antes para no interrumpir los envíos a la AEAT.`);
  }
  const nif = normalizeIssuerNif(companyTaxId);
  if (nif && !details.nifs.includes(nif)) {
    warnings.push(
      `El titular del certificado no incluye el NIF de la empresa (${nif}). Solo servirá si su titular es representante o apoderado de la empresa ante la AEAT `
        + "para este trámite; si no, la AEAT rechazará los envíos.",
    );
  }
  return warnings;
}

export type CompanyCertificateInfo = {
  fileName: string | null;
  uploadedAt: Date;
  subject: string | null;
  validTo: Date | null;
  isSeal: boolean;
};

export async function getCompanyCertificateInfo(client: DbClient, companyId: string): Promise<CompanyCertificateInfo | null> {
  const [row] = await client
    .select({
      fileName: verifactuCertificate.fileName,
      uploadedAt: verifactuCertificate.createdAt,
      subject: verifactuCertificate.subject,
      validTo: verifactuCertificate.validTo,
      isSeal: verifactuCertificate.isSeal,
    })
    .from(verifactuCertificate)
    .where(eq(verifactuCertificate.companyId, companyId))
    .limit(1);
  return row ?? null;
}

/** Credenciales mTLS de la empresa; null si no ha subido certificado (se usará el del sistema, si hay). */
export async function loadCompanyCredentials(client: DbClient, companyId: string): Promise<VerifactuCredentials | null> {
  const [row] = await client
    .select({
      pfxEncrypted: verifactuCertificate.pfxEncrypted,
      passphraseEncrypted: verifactuCertificate.passphraseEncrypted,
      isSeal: verifactuCertificate.isSeal,
      validTo: verifactuCertificate.validTo,
    })
    .from(verifactuCertificate)
    .where(eq(verifactuCertificate.companyId, companyId))
    .limit(1);
  if (!row) return null;
  const secret = encryptionSecret();
  const pfx = Buffer.from(openSecret(row.pfxEncrypted, PURPOSE, secret), "base64");
  const passphrase = openSecret(row.passphraseEncrypted, PURPOSE, secret);
  let { isSeal, validTo } = row;
  if (!validTo) {
    // Certificado subido antes de que se leyera el X.509: se completa ahora (titular, caducidad y
    // sello) para que el control de caducidad y el punto de acceso de sello valgan también para él.
    try {
      const details = readPfxCertificate(pfx, passphrase);
      if (details.validTo) {
        validTo = details.validTo;
        isSeal = isSeal || details.looksLikeSeal;
        await client
          .update(verifactuCertificate)
          .set({ subject: details.subject, validTo, isSeal })
          .where(eq(verifactuCertificate.companyId, companyId));
      }
    } catch {
      // Si no se puede leer, se sigue como hasta ahora: sin fecha conocida no se bloquea el envío.
    }
  }
  return { pfx, passphrase, seal: isSeal, validTo };
}

type Actor = { tenantId: string; companyId: string; actorUserId: string };

export type SavedCertificate = { subject: string | null; validTo: Date | null; isSeal: boolean; warnings: string[] };

/**
 * Guarda (o sustituye) el certificado de la empresa. `seal` marca expresamente que es de sello
 * electrónico; si no se indica, se deduce del titular.
 */
export async function saveCompanyCertificate(
  actor: Actor,
  input: { pfx: Buffer; passphrase: string; fileName: string | null; seal?: boolean | null },
  now = new Date(),
): Promise<SavedCertificate> {
  if (input.pfx.length === 0) throw new HttpError(400, "Selecciona el fichero del certificado (.p12 o .pfx).");
  if (input.pfx.length > MAX_CERTIFICATE_BYTES) throw new HttpError(413, "El fichero del certificado es demasiado grande.");
  const details = readPfxCertificate(input.pfx, input.passphrase);
  const [owner] = await db.select({ vatNumber: company.vatNumber }).from(company).where(eq(company.id, actor.companyId)).limit(1);
  const warnings = reviewCertificate(details, owner?.vatNumber ?? null, now);
  const isSeal = input.seal ?? details.looksLikeSeal;
  const secret = encryptionSecret();
  const values = {
    pfxEncrypted: sealSecret(input.pfx.toString("base64"), PURPOSE, secret),
    passphraseEncrypted: sealSecret(input.passphrase, PURPOSE, secret),
    fileName: input.fileName?.slice(0, 200) ?? null,
    subject: details.subject,
    validTo: details.validTo,
    isSeal,
    uploadedByUserId: actor.actorUserId,
    createdAt: now,
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
      payload: { fileName: values.fileName, subject: details.subject, validTo: details.validTo?.toISOString() ?? null, isSeal, warnings },
    }, tx);
  });
  return { subject: details.subject, validTo: details.validTo, isSeal, warnings };
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

export type SystemCertificateInfo = {
  /** Titular; null si el fichero no se puede abrir o leer (ruta o contraseña incorrectas). */
  subject: string | null;
  validTo: Date | null;
  /** El fichero existe y se abre con la contraseña configurada. */
  readable: boolean;
};

/** Última lectura: fichero (ruta, fecha, tamaño), contraseña con la que se abrió y resultado. */
let systemCertificateCache: { key: string; password: string; info: SystemCertificateInfo } | null = null;

/**
 * Certificado del sistema (VERIFACTU_CERT_PATH): titular y caducidad, con el mismo control que el
 * de cada empresa. Se lee una vez por versión del fichero (ruta, fecha, tamaño y contraseña): en cada llamada
 * solo se consulta el fichero con `stat`. Devuelve null si el despliegue no tiene certificado del
 * sistema.
 */
export async function getSystemCertificateInfo(env: Env = process.env): Promise<SystemCertificateInfo | null> {
  const transport = getVerifactuTransportConfig(env);
  if (transport.kind !== "aeat" || !transport.certPath) return null;
  const unreadable: SystemCertificateInfo = { subject: null, validTo: null, readable: false };
  let key: string;
  try {
    const info = await stat(transport.certPath);
    key = `${transport.certPath}:${info.mtimeMs}:${info.size}`;
  } catch {
    return unreadable;
  }
  if (systemCertificateCache?.key === key && systemCertificateCache.password === transport.certPassword) return systemCertificateCache.info;
  let result = unreadable;
  try {
    const details = readPfxCertificate(await readFile(transport.certPath), transport.certPassword);
    result = { subject: details.subject, validTo: details.validTo, readable: true };
  } catch {
    // Ruta o contraseña incorrectas: se informa como ilegible; el envío fallará con su propio error.
  }
  systemCertificateCache = { key, password: transport.certPassword, info: result };
  return result;
}

export type VerifactuReadiness = {
  /** El envío a la AEAT funciona para esta empresa: transporte activo y certificado vigente disponible. */
  operational: boolean;
  reason: string | null;
  certificate: "company" | "system" | null;
  /** Por qué no está operativo: el transporte (lo arregla el administrador) o el certificado (la empresa). */
  cause?: "transport" | "certificate-missing" | "certificate-expired" | null;
};

/**
 * ¿Puede esta empresa remitir a la AEAT ahora mismo? De ello dependen la activación del modo y la
 * leyenda «VERI*FACTU» de las facturas: no se puede anunciar una factura como verificable si el
 * sistema no la está remitiendo. Un certificado propio caducado deja el envío fuera de servicio.
 */
export async function getVerifactuReadiness(client: DbClient, companyId: string, env: Env = process.env, now = new Date()): Promise<VerifactuReadiness> {
  const transport = getVerifactuTransportConfig(env);
  if (transport.kind === "disabled") return { operational: false, reason: transport.reason, certificate: null, cause: "transport" };
  const own = await getCompanyCertificateInfo(client, companyId);
  if (own) {
    if (certificateValidity(own.validTo, now).expired && own.validTo) {
      return { operational: false, reason: `El certificado electrónico de la empresa caducó el ${shortDate(own.validTo)}: sube uno vigente.`, certificate: "company", cause: "certificate-expired" };
    }
    return { operational: true, reason: null, certificate: "company" };
  }
  if (transport.certPath) {
    // Mismo control que el de empresa: con el certificado del sistema caducado no se remite nada.
    const system = await getSystemCertificateInfo(env);
    if (system?.validTo && certificateValidity(system.validTo, now).expired) {
      return {
        operational: false,
        reason: `El certificado electrónico del sistema caducó el ${shortDate(system.validTo)}. Debe renovarlo el administrador; mientras tanto puedes subir el certificado de tu empresa.`,
        certificate: "system",
        cause: "certificate-expired",
      };
    }
    return { operational: true, reason: null, certificate: "system" };
  }
  return { operational: false, reason: "La empresa no ha subido su certificado electrónico.", certificate: null, cause: "certificate-missing" };
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/*
 * Cifrado en reposo (AES-256-GCM) de secretos guardados en la base de datos (p. ej. la contraseña
 * del buzón de facturas). Formato "v1.<iv>.<tag>.<datos>" en base64url. La clave se deriva con
 * SHA-256 del secreto de la aplicación y de un `purpose`, así cada uso tiene su propia clave.
 */

const VERSION = "v1";

function keyFor(purpose: string, secret: string) {
  return createHash("sha256").update(`${purpose}:${secret}`).digest();
}

export function sealSecret(plain: string, purpose: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(purpose, secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function openSecret(payload: string, purpose: string, secret: string) {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error("Secreto cifrado con un formato desconocido.");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(purpose, secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

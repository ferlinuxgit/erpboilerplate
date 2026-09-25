import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/*
 * Cifrado en reposo (AES-256-GCM) de los identificadores del proveedor PSD2 (requisition,
 * acuerdo y cuentas): con ellos y nuestras credenciales se leen los movimientos del banco.
 * Formato: "v1.<iv>.<tag>.<datos>" en base64url. La clave se deriva (SHA-256) del secreto
 * configurado, así que cambiarlo obliga a reconectar los bancos.
 */

const VERSION = "v1";

function keyFrom(secret: string) {
  return createHash("sha256").update(`bank-connections:${secret}`).digest();
}

export function encryptSecret(plain: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, secret: string) {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error("Identificador cifrado con un formato desconocido.");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

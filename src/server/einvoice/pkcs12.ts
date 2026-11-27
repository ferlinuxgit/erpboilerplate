import { createPrivateKey, createPublicKey, X509Certificate, type KeyObject } from "node:crypto";
import { createSecureContext } from "node:tls";

/**
 * Extrae del PKCS#12 (.p12/.pfx) de la empresa lo que hace falta para FIRMAR: la clave privada y
 * el certificado del titular. `node:crypto` no tiene una función para abrir un PKCS#12 y sacar la
 * clave (solo sabe usarlo para TLS), así que aquí se recorre su estructura ASN.1 hasta la bolsa de
 * la clave y se entrega a OpenSSL, que es quien la descifra con la contraseña:
 *
 *   PFX → authSafe (datos) → ContentInfo «data» → SafeBag «pkcs8ShroudedKeyBag» (o «keyBag»)
 *
 * Restricciones:
 * - La clave debe estar en un bloque «data» del PKCS#12, que es donde la ponen OpenSSL, Windows,
 *   Firefox, Java y la FNMT. Un fichero que meta la clave dentro de un bloque cifrado
 *   («encryptedData») no se admite: se explica y no se firma.
 * - El cifrado de la bolsa lo resuelve OpenSSL (PBES2/AES, y el antiguo 3DES de los .p12 clásicos).
 * - El certificado se obtiene como ya hace VERI*FACTU (`readPfxCertificate`): a través del contexto
 *   TLS, que devuelve el certificado del titular en DER. Se comprueba que casa con la clave.
 */

export type SigningMaterial = { privateKey: KeyObject; certificateDer: Buffer; certificate: X509Certificate };

export class Pkcs12Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Pkcs12Error";
  }
}

type Tlv = { tag: number; constructed: boolean; start: number; contentStart: number; contentEnd: number; end: number };

/** Lee un elemento BER/DER (longitud definida o indefinida) a partir de `offset`. */
function readTlv(buffer: Buffer, offset: number, limit = buffer.length): Tlv {
  if (offset + 2 > limit) throw new Pkcs12Error("Estructura ASN.1 truncada.");
  const first = buffer[offset];
  if ((first & 0x1f) === 0x1f) throw new Pkcs12Error("Etiqueta ASN.1 no admitida.");
  const constructed = (first & 0x20) !== 0;
  const lengthByte = buffer[offset + 1];
  let contentStart = offset + 2;
  if (lengthByte === 0x80) {
    // Longitud indefinida (BER): los hijos se suceden hasta el fin de contenido 00 00.
    let cursor = contentStart;
    for (;;) {
      if (cursor + 2 > limit) throw new Pkcs12Error("Estructura ASN.1 truncada.");
      if (buffer[cursor] === 0 && buffer[cursor + 1] === 0) return { tag: first, constructed, start: offset, contentStart, contentEnd: cursor, end: cursor + 2 };
      cursor = readTlv(buffer, cursor, limit).end;
    }
  }
  let length = lengthByte;
  if (lengthByte & 0x80) {
    const count = lengthByte & 0x7f;
    if (count === 0 || count > 4 || contentStart + count > limit) throw new Pkcs12Error("Longitud ASN.1 no admitida.");
    length = 0;
    for (let index = 0; index < count; index += 1) length = length * 256 + buffer[contentStart + index];
    contentStart += count;
  }
  const end = contentStart + length;
  if (end > limit) throw new Pkcs12Error("Estructura ASN.1 truncada.");
  return { tag: first, constructed, start: offset, contentStart, contentEnd: end, end };
}

function children(buffer: Buffer, parent: Tlv): Tlv[] {
  const result: Tlv[] = [];
  let cursor = parent.contentStart;
  while (cursor < parent.contentEnd) {
    const child = readTlv(buffer, cursor, parent.contentEnd);
    result.push(child);
    cursor = child.end;
  }
  return result;
}

/** Contenido de un OCTET STRING, primitivo o troceado (BER construido). */
function octets(buffer: Buffer, node: Tlv): Buffer {
  if (!node.constructed) return buffer.subarray(node.contentStart, node.contentEnd);
  return Buffer.concat(children(buffer, node).map((child) => octets(buffer, child)));
}

const oidHex = (buffer: Buffer, node: Tlv) => buffer.subarray(node.contentStart, node.contentEnd).toString("hex");

const OID_DATA = "2a864886f70d010701"; // 1.2.840.113549.1.7.1
const OID_ENCRYPTED_DATA = "2a864886f70d010706"; // 1.2.840.113549.1.7.6
const OID_KEY_BAG = "2a864886f70d010c0a0101"; // 1.2.840.113549.1.12.10.1.1
const OID_SHROUDED_KEY_BAG = "2a864886f70d010c0a0102"; // 1.2.840.113549.1.12.10.1.2

type KeyBag = { der: Buffer; encrypted: boolean };

/** Bolsas de clave privada del PKCS#12 (sin descifrar). */
export function findKeyBags(pfx: Buffer): { bags: KeyBag[]; hasEncryptedBlocks: boolean } {
  const top = readTlv(pfx, 0);
  const [, authSafe] = children(pfx, top);
  if (!authSafe) throw new Pkcs12Error("El fichero no es un PKCS#12.");
  const [contentType, content] = children(pfx, authSafe);
  if (!contentType || !content || oidHex(pfx, contentType) !== OID_DATA) throw new Pkcs12Error("El PKCS#12 usa un contenedor no admitido (se esperaba «data»).");
  const safe = octets(pfx, children(pfx, content)[0]);
  const bags: KeyBag[] = [];
  let hasEncryptedBlocks = false;
  for (const info of children(safe, readTlv(safe, 0))) {
    const [type, value] = children(safe, info);
    if (!type || !value) continue;
    const typeOid = oidHex(safe, type);
    if (typeOid === OID_ENCRYPTED_DATA) {
      hasEncryptedBlocks = true;
      continue;
    }
    if (typeOid !== OID_DATA) continue;
    const contents = octets(safe, children(safe, value)[0]);
    for (const bag of children(contents, readTlv(contents, 0))) {
      const [bagId, bagValue] = children(contents, bag);
      if (!bagId || !bagValue) continue;
      const bagOid = oidHex(contents, bagId);
      if (bagOid !== OID_KEY_BAG && bagOid !== OID_SHROUDED_KEY_BAG) continue;
      const inner = children(contents, bagValue)[0];
      if (inner) bags.push({ der: Buffer.from(contents.subarray(inner.start, inner.end)), encrypted: bagOid === OID_SHROUDED_KEY_BAG });
    }
  }
  return { bags, hasEncryptedBlocks };
}

function publicKeyDer(key: KeyObject) {
  return createPublicKey(key).export({ type: "spki", format: "der" });
}

/**
 * Clave privada y certificado del titular. Lanza `Pkcs12Error` con un mensaje para el usuario si el
 * fichero no se puede abrir, la contraseña no vale o la clave no está donde se espera.
 */
export function extractSigningMaterial(pfx: Buffer, passphrase: string): SigningMaterial {
  let certificateDer: Buffer | undefined;
  try {
    const context = createSecureContext({ pfx, passphrase });
    certificateDer = (context.context as { getCertificate?: () => Buffer | undefined }).getCertificate?.();
  } catch {
    throw new Pkcs12Error("No se pudo abrir el certificado: comprueba que es un fichero .p12 o .pfx y que la contraseña es correcta.");
  }
  if (!certificateDer) throw new Pkcs12Error("El fichero no contiene el certificado del titular.");
  const certificate = new X509Certificate(certificateDer);

  let found: ReturnType<typeof findKeyBags>;
  try {
    found = findKeyBags(pfx);
  } catch (error) {
    throw error instanceof Pkcs12Error ? error : new Pkcs12Error("No se pudo leer la estructura del certificado.");
  }
  const expected = certificate.publicKey.export({ type: "spki", format: "der" });
  for (const bag of found.bags) {
    try {
      const privateKey = bag.encrypted
        ? createPrivateKey({ key: bag.der, format: "der", type: "pkcs8", passphrase })
        : createPrivateKey({ key: bag.der, format: "der", type: "pkcs8" });
      if (publicKeyDer(privateKey).equals(expected)) return { privateKey, certificateDer: Buffer.from(certificateDer), certificate };
    } catch {
      // Otra bolsa puede ser la buena; si ninguna lo es, se explica abajo.
    }
  }
  throw new Pkcs12Error(
    found.bags.length === 0
      ? "No se encontró la clave privada en el certificado con el formato esperado, así que no se puede firmar con él. Descarga la factura sin firmar y fírmala con AutoFirma."
      : "No se pudo descifrar la clave privada del certificado (algoritmo de cifrado no admitido), así que no se puede firmar con él. Descarga la factura sin firmar y fírmala con AutoFirma.",
  );
}

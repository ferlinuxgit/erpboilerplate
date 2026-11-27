/**
 * Constructor mínimo de XML determinista para las facturas electrónicas (Facturae y UBL).
 *
 * El texto que produce `serializeXml` está YA en forma canónica (Canonical XML 1.0, sin comentarios)
 * siempre que se respeten estas restricciones, que este módulo impone por construcción:
 *
 * - Sin espacios, saltos de línea ni comentarios entre nodos: todo el texto es contenido real.
 * - Los elementos vacíos se escriben como pareja `<a></a>`, nunca `<a/>`.
 * - En cada elemento van primero las declaraciones de espacio de nombres (ordenadas por prefijo; el
 *   espacio por defecto, el primero) y después los atributos ordenados por nombre. Solo se usan
 *   atributos sin prefijo, así que el orden por nombre coincide con el canónico.
 * - Un espacio de nombres se declara una sola vez, en el elemento más alto que lo usa, y no se vuelve
 *   a declarar en sus descendientes (la forma canónica omite las declaraciones redundantes).
 * - Escapado canónico: en texto `&`, `<`, `>` y el retorno de carro; en atributos `&`, `<`, `"`,
 *   tabulador, salto de línea y retorno de carro.
 * - Sin DTD, entidades, instrucciones de proceso ni secciones CDATA.
 *
 * Gracias a eso la firma XAdES (`xades.ts`) puede calcular las huellas sobre el propio texto sin una
 * librería general de canonicalización. La declaración `<?xml …?>` se añade aparte: no forma parte
 * de la forma canónica.
 */

export type XmlNode = {
  name: string;
  attributes?: Record<string, string | null | undefined>;
  children?: Array<XmlNode | null | undefined | false>;
  text?: string | null;
};

/** Caracteres que XML 1.0 no admite (controles salvo tabulador, salto de línea y retorno de carro). */
const INVALID_XML_CHARS = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;

export function sanitizeXmlText(value: string) {
  return value.replace(INVALID_XML_CHARS, "");
}

export function escapeXmlText(value: string) {
  return sanitizeXmlText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#xD;");
}

export function escapeXmlAttribute(value: string) {
  return sanitizeXmlText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;")
    .replace(/\n/g, "&#xA;")
    .replace(/\r/g, "&#xD;");
}

/** Elemento con hijos. Los hijos nulos o `false` se descartan (campos opcionales). */
export function el(name: string, children: Array<XmlNode | null | undefined | false>, attributes?: XmlNode["attributes"]): XmlNode {
  return { name, children, attributes };
}

/** Elemento de texto. Con valor nulo o vacío devuelve null: el elemento opcional no se emite. */
export function txt(name: string, value: string | number | null | undefined, attributes?: XmlNode["attributes"]): XmlNode | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (text.trim() === "") return null;
  return { name, text, attributes };
}

function attributeOrder(a: string, b: string) {
  const rank = (name: string) => (name === "xmlns" ? 0 : name.startsWith("xmlns:") ? 1 : 2);
  const difference = rank(a) - rank(b);
  if (difference !== 0) return difference;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function serializeXml(node: XmlNode): string {
  const attributes = Object.entries(node.attributes ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== undefined)
    .sort(([a], [b]) => attributeOrder(a, b))
    .map(([name, value]) => ` ${name}="${escapeXmlAttribute(value)}"`)
    .join("");
  const content = node.text !== null && node.text !== undefined
    ? escapeXmlText(node.text)
    : (node.children ?? []).filter((child): child is XmlNode => Boolean(child)).map(serializeXml).join("");
  return `<${node.name}${attributes}>${content}</${node.name}>`;
}

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/** Documento completo: declaración + raíz, sin salto de línea entre ambas. */
export function xmlDocument(root: XmlNode) {
  return `${XML_DECLARATION}${serializeXml(root)}`;
}

/** Recorta un texto a la longitud máxima del esquema (por caracteres, sin partir pares suplentes). */
export function clip(value: string | null | undefined, max: number): string | null {
  const text = sanitizeXmlText(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("").trim() : text;
}

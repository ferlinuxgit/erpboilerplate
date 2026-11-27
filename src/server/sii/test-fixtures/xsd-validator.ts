/**
 * Validador XSD mínimo SOLO PARA TESTS: comprueba un XML contra los esquemas oficiales del SII
 * guardados en esta carpeta (descargados de la AEAT, versión 1.1 «bis»). No hay ninguna librería
 * de validación XSD en el proyecto, así que cubre exactamente el subconjunto que usan estos
 * esquemas: secuencias y elecciones (anidadas), minOccurs / maxOccurs, extensión de tipos
 * complejos, y tipos simples por restricción (enumeration, pattern, length, minLength, maxLength).
 * No sustituye a un validador completo, pero detecta lo que la AEAT rechazaría por esquema:
 * elementos fuera de orden, obligatorios ausentes, valores fuera de lista o de formato.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { XMLParser } from "fast-xml-parser";

type Raw = Record<string, unknown>;
type XmlElement = { ns: string; local: string; children: XmlElement[]; text: string; attrs: Record<string, string> };

const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", trimValues: false, parseTagValue: false, parseAttributeValue: false, processEntities: true });

function toElements(nodes: Raw[], scope: Record<string, string>): XmlElement[] {
  const elements: XmlElement[] = [];
  for (const node of nodes) {
    const tag = Object.keys(node).find((key) => key !== ":@" && key !== "#text" && !key.startsWith("?") && key !== "#comment");
    if (!tag) continue;
    const attrs = ((node[":@"] as Record<string, string> | undefined) ?? {});
    const inner = { ...scope };
    for (const [name, value] of Object.entries(attrs)) {
      if (name === "xmlns") inner[""] = value;
      else if (name.startsWith("xmlns:")) inner[name.slice(6)] = value;
    }
    const [prefix, local] = tag.includes(":") ? tag.split(":") : ["", tag];
    const childNodes = (node[tag] as Raw[]) ?? [];
    const text = childNodes.filter((child) => "#text" in child).map((child) => String(child["#text"])).join("");
    elements.push({ ns: inner[prefix] ?? "", local, children: toElements(childNodes, inner), text, attrs: { ...attrs, __scope: JSON.stringify(inner) } });
  }
  return elements;
}

export function parseXml(xml: string): XmlElement {
  const [root] = toElements(parser.parse(xml) as Raw[], {});
  if (!root) throw new Error("XML sin elemento raíz");
  return root;
}

const XS = "http://www.w3.org/2001/XMLSchema";

type Particle =
  | { kind: "element"; ns: string; name: string; min: number; max: number; type: TypeRef }
  | { kind: "sequence" | "choice"; min: number; max: number; items: Particle[] };
type TypeRef = { named: string } | { inline: XmlElement; ns: string };

type Schema = { ns: string; root: XmlElement };

export class XsdValidator {
  private readonly types = new Map<string, { node: XmlElement; ns: string }>();
  private readonly elements = new Map<string, { node: XmlElement; ns: string }>();

  constructor(files: string[]) {
    for (const file of files) this.load({ root: parseXml(readFileSync(file, "utf8")), ns: "" });
  }

  private load(schema: Schema) {
    const ns = schema.root.attrs.targetNamespace ?? "";
    for (const child of schema.root.children) {
      if (child.ns !== XS) continue;
      if (child.local === "complexType" || child.local === "simpleType") this.types.set(`{${ns}}${child.attrs.name}`, { node: child, ns });
      if (child.local === "element") this.elements.set(`{${ns}}${child.attrs.name}`, { node: child, ns });
    }
  }

  private qname(value: string, node: XmlElement) {
    const scope = JSON.parse(node.attrs.__scope) as Record<string, string>;
    const [prefix, local] = value.includes(":") ? value.split(":") : ["", value];
    return `{${scope[prefix] ?? ""}}${local}`;
  }

  private typeRefOf(node: XmlElement, ns: string): TypeRef {
    if (node.attrs.type) return { named: this.qname(node.attrs.type, node) };
    const inline = node.children.find((child) => child.local === "complexType" || child.local === "simpleType");
    if (!inline) return { named: `{${XS}}anyType` };
    return { inline, ns };
  }

  private occurs(node: XmlElement) {
    const max = node.attrs.maxOccurs;
    return { min: node.attrs.minOccurs === undefined ? 1 : Number(node.attrs.minOccurs), max: max === "unbounded" ? Infinity : max === undefined ? 1 : Number(max) };
  }

  private particle(node: XmlElement, ns: string): Particle | null {
    if (node.local === "element") return { kind: "element", ns, name: node.attrs.name, ...this.occurs(node), type: this.typeRefOf(node, ns) };
    if (node.local === "sequence" || node.local === "choice") {
      const items = node.children.map((child) => this.particle(child, ns)).filter((item): item is Particle => item !== null);
      return { kind: node.local, ...this.occurs(node), items };
    }
    return null;
  }

  /** Partículas de un tipo complejo, con las del tipo base delante si es una extensión. */
  private contentOf(node: XmlElement, ns: string): Particle[] {
    const complexContent = node.children.find((child) => child.local === "complexContent");
    if (complexContent) {
      const extension = complexContent.children.find((child) => child.local === "extension");
      if (!extension) throw new Error("complexContent sin extension no soportado");
      const base = this.types.get(this.qname(extension.attrs.base, extension));
      if (!base) throw new Error(`Tipo base desconocido: ${extension.attrs.base}`);
      return [...this.contentOf(base.node, base.ns), ...this.contentOf(extension, ns)];
    }
    return node.children.map((child) => this.particle(child, ns)).filter((item): item is Particle => item !== null);
  }

  private validateSimple(node: XmlElement, value: string, where: string, errors: string[]) {
    const restriction = node.children.find((child) => child.local === "restriction");
    if (!restriction) return;
    const facets = (name: string) => restriction.children.filter((child) => child.local === name).map((child) => child.attrs.value);
    const enumeration = facets("enumeration");
    if (enumeration.length > 0 && !enumeration.includes(value)) errors.push(`${where}: «${value}» no está en la lista admitida`);
    for (const pattern of facets("pattern")) {
      if (!new RegExp(`^(?:${pattern})$`).test(value)) errors.push(`${where}: «${value}» no cumple el patrón ${pattern}`);
    }
    const [length] = facets("length");
    if (length !== undefined && value.length !== Number(length)) errors.push(`${where}: longitud distinta de ${length}`);
    const [minLength] = facets("minLength");
    if (minLength !== undefined && value.length < Number(minLength)) errors.push(`${where}: longitud menor que ${minLength}`);
    const [maxLength] = facets("maxLength");
    if (maxLength !== undefined && value.length > Number(maxLength)) errors.push(`${where}: longitud mayor que ${maxLength}`);
    if (restriction.attrs.base && this.qname(restriction.attrs.base, restriction) === `{${XS}}integer` && !/^[+-]?\d+$/.test(value)) errors.push(`${where}: no es un entero`);
  }

  private validateType(ref: TypeRef, element: XmlElement, where: string, errors: string[]) {
    let node: XmlElement;
    let ns: string;
    if ("named" in ref) {
      if (ref.named.startsWith(`{${XS}}`)) {
        if (element.children.length > 0) errors.push(`${where}: no admite elementos hijos`);
        return;
      }
      const found = this.types.get(ref.named);
      if (!found) {
        errors.push(`${where}: tipo desconocido ${ref.named}`);
        return;
      }
      ({ node, ns } = found);
    } else {
      node = ref.inline;
      ns = ref.ns;
    }
    if (node.local === "simpleType") {
      if (element.children.length > 0) errors.push(`${where}: no admite elementos hijos`);
      this.validateSimple(node, element.text, where, errors);
      return;
    }
    const index = this.matchAll(this.contentOf(node, ns), element.children, 0, where, errors);
    if (index < element.children.length) errors.push(`${where}: elemento inesperado <${element.children[index].local}> (o fuera de orden)`);
  }

  private matchAll(particles: Particle[], children: XmlElement[], start: number, where: string, errors: string[]) {
    let index = start;
    for (const particle of particles) index = this.match(particle, children, index, where, errors);
    return index;
  }

  /** ¿Puede esta partícula empezar con el hijo en `index`? (los esquemas del SII son deterministas). */
  private canStart(particle: Particle, child: XmlElement | undefined): boolean {
    if (!child) return false;
    if (particle.kind === "element") return child.local === particle.name && child.ns === particle.ns;
    if (particle.kind === "choice") return particle.items.some((item) => this.canStart(item, child));
    for (const item of particle.items) {
      if (this.canStart(item, child)) return true;
      if (item.min > 0) return false;
    }
    return false;
  }

  private match(particle: Particle, children: XmlElement[], start: number, where: string, errors: string[]): number {
    let index = start;
    let count = 0;
    while (count < particle.max && this.canStart(particle, children[index])) {
      if (particle.kind === "element") {
        this.validateType(particle.type, children[index], `${where}/${particle.name}`, errors);
        index += 1;
      } else if (particle.kind === "sequence") {
        index = this.matchAll(particle.items, children, index, where, errors);
      } else {
        const option = particle.items.find((item) => this.canStart(item, children[index]))!;
        index = this.match(option, children, index, where, errors);
      }
      count += 1;
    }
    if (count < particle.min) {
      const expected = particle.kind === "element" ? `<${particle.name}>` : particle.kind === "choice" ? `uno de: ${particle.items.map((item) => (item.kind === "element" ? item.name : item.kind)).join(", ")}` : "una secuencia obligatoria";
      errors.push(`${where}: falta ${expected}`);
    }
    return index;
  }

  /** Errores de esquema del documento (lista vacía = válido). */
  validate(xml: string): string[] {
    const root = parseXml(xml);
    const declaration = this.elements.get(`{${root.ns}}${root.local}`);
    if (!declaration) return [`Elemento raíz no declarado: {${root.ns}}${root.local}`];
    const errors: string[] = [];
    this.validateType(this.typeRefOf(declaration.node, declaration.ns), root, root.local, errors);
    return errors;
  }
}

/** Validador con los esquemas oficiales del SII v1.1 de esta carpeta. */
export function siiXsdValidator() {
  const dir = path.join(process.cwd(), "src/server/sii/test-fixtures");
  return new XsdValidator(["SuministroInformacion.xsd", "SuministroLR.xsd", "RespuestaSuministro.xsd"].map((file) => path.join(dir, file)));
}

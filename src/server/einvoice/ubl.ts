import { amountToCents } from "@/server/taxation/engine";
import {
  centsToFixed,
  computeEInvoiceTotals,
  decimalString,
  EInvoiceError,
  indirectTaxSystem,
  isOtherOutputTax,
  isSurchargeTax,
  isVatTax,
  isDisbursementLine,
  isGlobalDiscountLine,
  isWithholdingTax,
  lineTotalCostCents,
  partyCountry,
  partyTaxNumber,
  zeroTaxNature,
  type EInvoiceData,
  type EInvoiceParty,
} from "@/server/einvoice/model";
import { clip, el, txt, xmlDocument, type XmlNode } from "@/server/einvoice/xml";

/**
 * Generador PURO de factura UBL 2.1 conforme al NÚCLEO de la norma europea EN 16931-1:2017
 * (identificador de especificación `urn:cen.eu:en16931:2017`).
 *
 * Contexto normativo (consultado en el BOE el 27-11-2026):
 * - Ley 18/2022 «Crea y Crece» y Real Decreto 238/2026 (BOE-A-2026-7295): factura electrónica
 *   obligatoria entre empresarios y profesionales, con el modelo semántico EN 16931 y sintaxis CII,
 *   UBL, EDIFACT o Facturae (art. 7). La solución pública de la AEAT solo admite UBL (art. 11.2).
 * - Orden HAC/1028/2026 (BOE-A-2026-20587), anexo I: perfil de la solución pública,
 *   `urn:cen.eu:en16931:2026#conformant#urn:aeat.es:spfe:1.0.0:extended`, con campos propios
 *   (BT-ES-…) y especificaciones técnicas que remite a la sede de la AEAT.
 *
 * DOS PERFILES (parámetro `profile`):
 *
 * 1. «EN16931» (por defecto): el NÚCLEO EN 16931:2017 en UBL 2.1, para intercambio entre empresas
 *    y plataformas privadas. Limitaciones:
 *    - El recargo de equivalencia y los impuestos distintos del IVA/IGIC/IPSI no existen en el
 *      núcleo de 2017: con ellos NO se genera este perfil.
 *    - La retención de IRPF tampoco: se informa en `cac:WithholdingTaxTotal` y se resta del
 *      importe a pagar; un validador estricto de 2017 puede señalar BR-CO-16. Se avisa.
 *    - Rectificativas: tipo 384 con importes por diferencias y referencia a la original (BG-3).
 *
 * 2. «SPFE»: el perfil de la SOLUCIÓN PÚBLICA de la AEAT (anexo I de la Orden HAC/1028/2026),
 *    en UBL 2.5. Fuentes contrastadas el 27-11-2026, además del BOE (documentación técnica de
 *    sede.agenciatributaria.gob.es › IVA › Factura electrónica › Información técnica, que enlaza
 *    con el Portal de Desarrolladores, «Solución Pública de Facturación Electrónica (SPFE)»):
 *    - «Reglas de negocio anexo I OM SPFE» v0.1 de 19-11-2026 (reglas BR-ES-…),
 *    - `bt_invoice.properties` / `bg_invoice.properties` (ruta UBL de cada término BT/BG),
 *    - `errores_negocio.properties` (reglas SPFE-CORE y SPFE-LIST),
 *    - los ejemplos `factura.xml` y `SendInvoicesSOAP.zip`,
 *    - «Descripción de validaciones de factura electrónica en SPFE» v0.1.1 de 24-11-2026.
 *    Qué añade respecto del núcleo: `ProfileID`, indicador de copia (BT-ES-1), NIF con esquema
 *    «LOC»/«FC» (BT-32/BT-47) repetido en `PartyLegalEntity`, fecha de operación en
 *    `TaxPointDate` (BT-7), notas en `cac:Annotation` (BG-1, «REG» para las menciones legales), QR
 *    en `cbc:UUID` (BT-ES-25), tipo y modalidad de rectificativa (BT-ES-27/28), clave de régimen
 *    por línea (BG-32 «REGI», BT-ES-24), recargo de equivalencia con la categoría «N» y dos
 *    desgloses (BR-ES-N-2/5) y retenciones (BG-ES-4 y BG-34 «RETE»).
 *    SIN VERIFICAR (no hay acceso al entorno de pruebas de la AEAT, que exige certificado):
 *    - No se ha pasado ninguna factura por el servicio de validación de preproducción; lo único
 *      comprobado es la validez frente al XSD de UBL 2.5 de OASIS y las reglas que este módulo
 *      aplica. Las reglas Schematron de la EN 16931-1:2026 no se han ejecutado.
 *    - `ProfileID`: el BOE dice `urn:aeat:names:specification:ubl:schema:profile:B2B`; el anexo
 *      publicado en la sede y los tres ejemplos de la AEAT, `urn:aeat:names:specification:schema:
 *      profile:B2B`. Se usa el de los ejemplos, que es lo que valida el sistema.
 *    - Signo de la retención en BT-179: la regla BR-CO-16 que publica la AEAT (a pagar = total
 *      con IVA − pagado + BT-179 + redondeo) obliga a que vaya en negativo para que cuadre el
 *      importe a pagar; no hay ejemplo oficial con retención que lo confirme.
 *    - Identificadores con calificador (`urn:aeat:names:specification:schema:add:RETE`,
 *      `…:schema:RECT:TIPO`…): construidos como en los ejemplos oficiales del QR y de «REGI»
 *      (calificador de la lista + código); solo esos dos aparecen en un ejemplo.
 *    - Concepto de la retención (lista L5): la aplicación no lo guarda; se deduce del nombre del
 *      impuesto y se avisa. Códigos VATEX-ES de las exenciones: no se emiten (la lista no está en
 *      la documentación consultada), solo el texto de la exención.
 *    - Quedan fuera (se explica y no se genera): impuestos especiales y otros cargos (BG-28, L9),
 *      suplidos (BG-34 «SUPL»), terceros (BG-ES-1), referencia catastral, facturas recapitulativas,
 *      destinatarios sin NIF español y operaciones intracomunitarias (la categoría «K» no se admite).
 *
 * Líneas especiales (ambos perfiles):
 * - Descuento global (`isGlobalDiscount`): descuento de documento (BG-20, `cac:AllowanceCharge` con
 *   `ChargeIndicator` false, su categoría y tipo), no una línea de precio negativo; resta de la base
 *   del desglose y figura en BT-107 (`AllowanceTotalAmount`).
 * - Anticipo descontado (`advanceInvoiceId`): la factura de anticipo ya llevó su IVA, así que la
 *   final minora la base con una línea negativa con su categoría. No se usa BT-113
 *   (`PrepaidAmount`), que resta del importe a pagar sin tocar la base ni las cuotas.
 * - Suplidos (`isDisbursement`): el núcleo EN 16931:2017 no tiene dónde expresar un importe a pagar
 *   fuera de la base (BR-CO-16 obliga a que lo pagadero sea el total con IVA menos lo anticipado),
 *   así que con suplidos NO se genera ese perfil. El perfil de la AEAT sí los prevé: BG-34 «Cargos
 *   en nombre de un tercero», `cac:CollectionInvoiceLine` con BT-ES-10 «SUPL», importe (BT-179) y
 *   descripción (BT-180), sumados al importe a pagar.
 *
 * Redondeos: los mismos del motor fiscal (céntimos); bases por línea, cuotas por tipo.
 */

export const UBL_CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017";
/** BT-24 del anexo I de la Orden HAC/1028/2026. */
export const UBL_SPFE_CUSTOMIZATION_ID = "urn:cen.eu:en16931:2026#conformant#urn:aeat.es:spfe:1.0.0:extended";
/** BT-23, tal como aparece en los ejemplos y en el anexo publicados por la AEAT (ver cabecera). */
export const UBL_SPFE_PROFILE_ID = "urn:aeat:names:specification:schema:profile:B2B";
/** Calificadores de las listas L10, L8 y L7 del anexo I. */
const SPFE_DOCUMENT = "urn:aeat:names:specification:schema:";
const SPFE_LINE = "urn:aeat:names:specification:schema:lin:";
const SPFE_ADDITIONAL = "urn:aeat:names:specification:schema:add:";

export type UblProfile = "EN16931" | "SPFE";

/** Lista L2.A: tipo de factura rectificativa. */
const SPFE_CORRECTIVE_TYPES: Record<string, string> = {
  R1: "Factura rectificativa (error fundado en derecho y artículo 80 Uno, Dos y Seis LIVA)",
  R2: "Factura rectificativa (artículo 80.3 LIVA)",
  R3: "Factura rectificativa (artículo 80.4 LIVA)",
  R4: "Factura rectificativa (resto)",
};

/**
 * Tipos de recargo de equivalencia admitidos para cada tipo de IVA (regla BR-ES-N-5 de las reglas
 * de negocio del anexo I).
 */
const SURCHARGE_RATES: Record<string, number[]> = { "21": [5.2, 1.75], "10": [1.4], "4": [0.5], "5": [0.62], "2": [0.26], "7.5": [1], "0": [0] };

/** Lista L5 (concepto de la retención), deducida del nombre del impuesto: la aplicación no la guarda. */
function withholdingConcept(name: string | null | undefined): string {
  const text = (name ?? "").toLowerCase();
  if (/alquiler|arrend/.test(text)) return "06";
  if (/irpf|profesional/.test(text)) return "01";
  return "11";
}

const SPANISH_NIF = /^[0-9A-Z][0-9]{7}[0-9A-Z]$/;

/** IBAN: forma y dígitos de control (ISO 13616, módulo 97). */
export function isValidIban(value: string): boolean {
  const iban = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const digits = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}
const NS_INVOICE = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
const NS_CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
const NS_CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";

/** Medios de pago UNTDID 4461: 10 efectivo, 30 transferencia, 48 tarjeta, 49 adeudo domiciliado. */
const PAYMENT_MEANS: Record<string, string> = { CASH: "10", BANK_TRANSFER: "30", CARD: "48", DIRECT_DEBIT: "49" };

export type UblResult = { xml: string; warnings: string[]; fileName: string };

type Category = { id: string; rate: number; reasonCode: string | null; reason: string | null; surcharge?: boolean };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Identificador de IVA con prefijo de país (BT-31 / BT-48). */
function vatIdentifier(party: EInvoiceParty): string | null {
  const number = partyTaxNumber(party);
  if (!number) return null;
  const country = partyCountry(party);
  // Grecia usa el prefijo «EL» en el NIF-IVA.
  const prefix = country === "GR" ? "EL" : country;
  return /^[A-Z]{2}/.test(number) && number.startsWith(prefix) ? number : country === "ES" ? `ES${number}` : number;
}

/** Parte según el anexo I: NIF español con esquema «LOC»/«FC» (BT-32, BT-47) repetido en BT-30. */
function spfePartyNode(party: EInvoiceParty, who: string, problems: string[]): XmlNode {
  const country = partyCountry(party);
  const legalName = (party.legalName?.trim() || party.name || "").trim();
  const nif = partyTaxNumber(party);
  if (!legalName) problems.push(`Falta el nombre o la razón social ${who}.`);
  // Reglas SPFE-IDEN: en emisor y destinatario no se admite otro identificador que el NIF.
  if (country !== "ES" || !SPANISH_NIF.test(nif)) problems.push(`La solución pública de la AEAT solo admite NIF español: revisa el NIF y el país ${who}.`);
  // BR-ES-8 a BR-ES-11: dirección siempre; municipio, código postal y provincia si es España.
  if (!party.address?.trim()) problems.push(`Falta la dirección ${who}.`);
  if (!party.city?.trim()) problems.push(`Falta la población ${who}.`);
  if (!party.postalCode?.trim()) problems.push(`Falta el código postal ${who}.`);
  if (!party.province?.trim()) problems.push(`Falta la provincia ${who}.`);
  const phone = (party.phone ?? "").replace(/[\s().-]/g, "");
  const validPhone = /^\+?[0-9]{9,15}$/.test(phone) ? phone : null;
  const email = (party.email ?? "").trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  const name = clip(legalName, 200) ?? "-";
  return el("cac:Party", [
    el("cac:PostalAddress", [
      txt("cbc:StreetName", clip(party.address, 200)),
      txt("cbc:AdditionalStreetName", clip(party.addressLine2, 200)),
      txt("cbc:CityName", clip(party.city, 100)),
      txt("cbc:PostalZone", clip(party.postalCode, 20)),
      txt("cbc:CountrySubentity", clip(party.province, 100)),
      el("cac:Country", [txt("cbc:IdentificationCode", country)]),
    ]),
    el("cac:PartyTaxScheme", [txt("cbc:CompanyID", nif, { schemeID: "FC" }), el("cac:TaxScheme", [txt("cbc:ID", "LOC")])]),
    // SPFE-CORE-28/29: el NIF de BT-30/BT-47 debe ser el mismo que el del esquema fiscal.
    el("cac:PartyLegalEntity", [txt("cbc:RegistrationName", name), txt("cbc:CompanyID", nif)]),
    // SPFE-CORE-34/36: el nombre del contacto debe coincidir con el de la parte.
    validPhone || validEmail ? el("cac:Contact", [txt("cbc:Name", name), txt("cbc:Telephone", validPhone), txt("cbc:ElectronicMail", validEmail)]) : null,
  ]);
}

function partyNode(party: EInvoiceParty, who: string, problems: string[]): XmlNode {
  const country = partyCountry(party);
  const legalName = (party.legalName?.trim() || party.name || "").trim();
  const vatId = vatIdentifier(party);
  if (!legalName) problems.push(`Falta el nombre o la razón social ${who}.`);
  if (!vatId) problems.push(`Falta el NIF ${who}.`);
  if (!party.city?.trim()) problems.push(`Falta la población ${who}.`);
  return el("cac:Party", [
    party.legalName?.trim() && party.name?.trim() && party.name.trim() !== party.legalName.trim() ? el("cac:PartyName", [txt("cbc:Name", clip(party.name, 200))]) : null,
    el("cac:PostalAddress", [
      txt("cbc:StreetName", clip(party.address, 200)),
      txt("cbc:AdditionalStreetName", clip(party.addressLine2, 200)),
      txt("cbc:CityName", clip(party.city, 100)),
      txt("cbc:PostalZone", clip(party.postalCode, 20)),
      txt("cbc:CountrySubentity", clip(party.province, 100)),
      el("cac:Country", [txt("cbc:IdentificationCode", country)]),
    ]),
    vatId ? el("cac:PartyTaxScheme", [txt("cbc:CompanyID", vatId), el("cac:TaxScheme", [txt("cbc:ID", "VAT")])]) : null,
    el("cac:PartyLegalEntity", [txt("cbc:RegistrationName", clip(legalName, 200) ?? "-")]),
    party.phone?.trim() || party.email?.trim()
      ? el("cac:Contact", [txt("cbc:Telephone", clip(party.phone, 50)), txt("cbc:ElectronicMail", clip(party.email, 100))])
      : null,
  ]);
}

export function buildUblTree(data: EInvoiceData, profile: UblProfile = "EN16931"): { root: XmlNode; warnings: string[] } {
  const spfe = profile === "SPFE";
  const problems: string[] = [];
  const warnings: string[] = [];
  const currency = data.currency.toUpperCase();
  const money = (name: string, cents: number) => txt(name, centsToFixed(cents), { currencyID: currency });

  if (!ISO_DATE.test(data.issueDate)) problems.push("La factura no tiene fecha de expedición.");
  if (data.lines.length === 0) problems.push("La factura no tiene líneas.");
  const withSurcharge = data.lines.filter((line) => !isDisbursementLine(line) && line.taxes.some(isSurchargeTax));
  if (withSurcharge.length > 0 && !spfe) {
    problems.push("La factura lleva recargo de equivalencia, que el núcleo EN 16931:2017 no sabe expresar. Usa Facturae o el perfil UBL de la solución pública de la AEAT.");
  }
  if (withSurcharge.length > 0 && spfe) {
    // BR-ES-IVA-CR-17 (art. 16.4 del Reglamento de facturación): una factura con recargo solo lleva operaciones con recargo.
    if (withSurcharge.length !== data.lines.filter((line) => !isDisbursementLine(line)).length) problems.push("La factura mezcla líneas con y sin recargo de equivalencia: la solución pública de la AEAT exige que todas lo lleven (regla BR-ES-IVA-CR-17).");
    for (const line of withSurcharge) {
      const vat = line.taxes.filter(isVatTax);
      const surcharges = line.taxes.filter(isSurchargeTax);
      const allowed = vat.length === 1 ? SURCHARGE_RATES[decimalString(vat[0].rate, 4)] : undefined;
      if (surcharges.length !== 1 || !allowed) problems.push("Cada línea con recargo de equivalencia debe llevar un único tipo de IVA vigente y un único recargo.");
      else if (!allowed.includes(surcharges[0].rate)) {
        problems.push(`El recargo de equivalencia del ${decimalString(surcharges[0].rate, 4)} % no corresponde al IVA del ${decimalString(vat[0].rate, 4)} % (regla BR-ES-N-5).`);
      }
    }
  }
  if (data.lines.some((line) => line.taxes.some(isOtherOutputTax))) {
    problems.push(spfe
      ? "La factura lleva impuestos distintos del IVA, IGIC o IPSI: el perfil de la AEAT los pide como cargos con su código (lista L9), que la aplicación no guarda. Usa Facturae."
      : "La factura lleva impuestos distintos del IVA, IGIC o IPSI, que el núcleo EN 16931:2017 no sabe expresar. Usa Facturae.");
  }
  const disbursements = data.lines.filter(isDisbursementLine);
  if (disbursements.length > 0 && !spfe) {
    problems.push("La factura lleva suplidos, que el núcleo EN 16931:2017 no sabe expresar (no son base imponible y suman al importe a pagar). Usa Facturae o el perfil UBL de la solución pública de la AEAT.");
  }
  const globalDiscounts = data.lines.filter(isGlobalDiscountLine);
  if (spfe && globalDiscounts.length > 0 && withSurcharge.length > 0) {
    problems.push("Descuento global con recargo de equivalencia: el perfil de la AEAT pediría el descuento en los dos desgloses «N» y la documentación no indica cómo. Usa Facturae.");
  }
  if (data.lines.some((line) => !isDisbursementLine(line) && line.taxes.filter(isVatTax).length > 1)) problems.push("Alguna línea tiene más de un tipo de IVA: EN 16931 solo admite uno por línea.");
  if (problems.length > 0) throw new EInvoiceError(problems);

  const totals = computeEInvoiceTotals(data);
  const system = indirectTaxSystem(data.issuerTerritory);
  const nature = zeroTaxNature(data.vatTreatment, data.vatExemptionCode);
  const legalLiterals = data.legalLiterals.map((literal) => literal.trim()).filter(Boolean);
  const exemptionText = clip(legalLiterals[legalLiterals.length - 1] ?? null, 500);

  /** Categoría UNTDID 5305 de una línea según su tipo y el tratamiento de la factura. */
  const categoryFor = (rate: number | null): Category => {
    if (rate !== null && rate > 0) return { id: system === "IGIC" ? "L" : system === "IPSI" ? "M" : "S", rate, reasonCode: null, reason: null };
    if (system !== "VAT" && nature === "ZERO_RATE") return { id: system === "IGIC" ? "L" : "M", rate: 0, reasonCode: null, reason: null };
    switch (nature) {
      case "EXEMPT": return { id: "E", rate: 0, reasonCode: null, reason: exemptionText ?? "Operación exenta" };
      case "INTRA_EU": return { id: "K", rate: 0, reasonCode: "VATEX-EU-IC", reason: exemptionText ?? "Entrega intracomunitaria exenta" };
      case "EXPORT": return { id: "G", rate: 0, reasonCode: "VATEX-EU-G", reason: exemptionText ?? "Exportación exenta" };
      case "REVERSE_CHARGE": return { id: "AE", rate: 0, reasonCode: "VATEX-EU-AE", reason: exemptionText ?? "Inversión del sujeto pasivo" };
      case "NOT_SUBJECT":
        // Servicios a empresas de la UE: no sujetos aquí, el destinatario autoliquida (inversión del sujeto pasivo).
        return (data.vatTreatment ?? "").toUpperCase() === "INTRA_EU_SERVICES"
          ? { id: "AE", rate: 0, reasonCode: "VATEX-EU-AE", reason: exemptionText ?? "Inversión del sujeto pasivo" }
          : { id: "O", rate: 0, reasonCode: "VATEX-EU-O", reason: exemptionText ?? "Operación no sujeta" };
      default: return { id: "Z", rate: 0, reasonCode: null, reason: null };
    }
  };

  /**
   * Ajustes del perfil de la AEAT sobre la categoría del núcleo: recargo de equivalencia con «N»
   * (BR-ES-N-…), sin «K» (no admitida) y código de exención solo donde se permite
   * (SPFE-LIST-09: categorías E, AE, O, D y F; para «O», VATEX-EU-O o VATEX-ES-N1/N2, BR-ES-O-1).
   */
  const spfeCategoryFor = (rate: number | null, surcharge: boolean): Category => {
    if (surcharge) return { id: "N", rate: rate ?? 0, reasonCode: null, reason: null };
    const category = categoryFor(rate);
    if (category.id === "E" || category.id === "G") return { ...category, reasonCode: null };
    const cause = (data.vatExemptionCode ?? "").toUpperCase();
    if (category.id === "O" && /^N[12]$/.test(cause)) return { ...category, reasonCode: `VATEX-ES-${cause}` };
    return category;
  };
  /** Clave de régimen de la línea (listas L3A, L3B y L3C) compatible con su categoría (tablas ES-4, ES-6 y ES-7). */
  const regimeKeyFor = (category: Category): string => {
    if (category.id === "G") return system === "IPSI" ? "01" : "02";
    if (system === "IPSI") return category.id === "E" ? "19" : "01";
    if (data.cashAccounting && ["S", "L", "Z", "E"].includes(category.id)) return "07";
    return "01";
  };
  if (spfe && nature === "INTRA_EU") {
    problems.push("Las entregas intracomunitarias quedan fuera de la solución pública de la AEAT (no admite la categoría «K» ni destinatarios sin NIF español). Usa el perfil EN 16931.");
  }

  const breakdown = new Map<string, { category: Category; baseCents: number }>();
  const withheld = new Map<string, { rate: number; concept: string; baseCents: number }>();
  const lineNodes: XmlNode[] = [];
  const allowanceNodes: XmlNode[] = [];
  let documentAllowanceCents = 0;
  const collectionNodes: XmlNode[] = [];
  data.lines.forEach((line, index) => {
    if (isDisbursementLine(line)) {
      // BG-34 «Cargos en nombre de un tercero» (solo perfil de la AEAT; el núcleo ya se ha rechazado).
      collectionNodes.push(el("cac:CollectionInvoiceLine", [
        txt("cbc:ID", `${SPFE_ADDITIONAL}SUPL`),
        money("cbc:TaxInclusiveLineExtensionAmount", amountToCents(totals.lines[index]?.disbursementAmount ?? 0)),
        el("cac:Item", [txt("cbc:Description", clip(line.description, 200) ?? "Suplido")]),
      ]));
      return;
    }
    const netCents = amountToCents(totals.lines[index]?.subtotal ?? 0);
    const vat = line.taxes.find(isVatTax);
    const surcharge = spfe ? line.taxes.find(isSurchargeTax) : undefined;
    const category = spfe ? spfeCategoryFor(vat ? vat.rate : null, Boolean(surcharge)) : categoryFor(vat ? vat.rate : null);
    const addToBreakdown = (entry: Category) => {
      const key = `${entry.id}|${entry.rate}${entry.surcharge ? "|RE" : ""}`;
      const current = breakdown.get(key);
      if (current) current.baseCents += netCents;
      else breakdown.set(key, { category: entry, baseCents: netCents });
    };
    addToBreakdown(category);
    // BR-ES-N-2: el recargo va en un segundo desglose «N», con su propio tipo y la misma base.
    if (surcharge) addToBreakdown({ id: "N", rate: surcharge.rate, reasonCode: null, reason: null, surcharge: true });
    for (const tax of line.taxes.filter(isWithholdingTax)) {
      const concept = withholdingConcept(tax.name);
      const key = `${tax.rate}|${spfe ? concept : ""}`;
      const current = withheld.get(key);
      if (current) current.baseCents += netCents;
      else withheld.set(key, { rate: tax.rate, concept, baseCents: netCents });
    }

    if (isGlobalDiscountLine(line)) {
      // BG-20: descuento de documento con la categoría de las líneas que descuenta.
      documentAllowanceCents += -netCents;
      allowanceNodes.push(el("cac:AllowanceCharge", [
        txt("cbc:ChargeIndicator", "false"),
        txt("cbc:AllowanceChargeReason", clip(line.description, 200) ?? "Descuento"),
        money("cbc:Amount", -netCents),
        el("cac:TaxCategory", [
          txt("cbc:ID", category.id),
          category.id === "O" ? null : txt("cbc:Percent", decimalString(category.rate, 4)),
          el("cac:TaxScheme", [txt("cbc:ID", "VAT")]),
        ]),
      ]));
      return;
    }
    // BR-27: el precio no puede ser negativo; el signo de una línea de abono va en la cantidad.
    const negativePrice = line.unitPrice < 0;
    const quantity = negativePrice ? -line.quantity : line.quantity;
    const unitPrice = negativePrice ? -line.unitPrice : line.unitPrice;
    const allowanceCents = lineTotalCostCents(line) - netCents;
    if (!line.description?.trim()) problems.push(`La línea ${index + 1} no tiene descripción.`);
    lineNodes.push(el("cac:InvoiceLine", [
      txt("cbc:ID", String(lineNodes.length + 1)),
      // C62 = «unidad» (UN/ECE Rec. 20): la aplicación no guarda la unidad de medida en la línea.
      txt("cbc:InvoicedQuantity", decimalString(quantity, 8), { unitCode: "C62" }),
      money("cbc:LineExtensionAmount", netCents),
      allowanceCents !== 0
        ? el("cac:AllowanceCharge", [
            // Línea de abono con descuento: el neto (negativo) se acerca a cero, así que es un «cargo».
            txt("cbc:ChargeIndicator", allowanceCents > 0 ? "false" : "true"),
            txt("cbc:AllowanceChargeReason", "Descuento"),
            money("cbc:Amount", Math.abs(allowanceCents)),
          ])
        : null,
      el("cac:Item", [
        txt("cbc:Name", clip(line.description, 200) ?? "-"),
        el("cac:ClassifiedTaxCategory", [
          txt("cbc:ID", category.id),
          category.id === "O" ? null : txt("cbc:Percent", decimalString(category.rate, 4)),
          el("cac:TaxScheme", [txt("cbc:ID", "VAT")]),
        ]),
        // BG-32 «Clave de régimen»: obligatoria en cada línea (SPFE-LIST-10); el calificador es el impuesto (BT-ES-24).
        spfe
          ? el("cac:AdditionalItemProperty", [
              txt("cbc:Name", `${SPFE_LINE}REGI`),
              txt("cbc:Value", regimeKeyFor(category)),
              txt("cbc:ValueQualifier", system === "VAT" ? "IVA" : system),
            ])
          : null,
      ]),
      el("cac:Price", [txt("cbc:PriceAmount", decimalString(unitPrice, 8, 2), { currencyID: currency })]),
    ]));
  });
  if (lineNodes.length === 0 && data.lines.length > 0) problems.push("La factura solo tiene suplidos o descuentos: UBL exige al menos una línea.");

  // Cuotas por categoría y tipo; el descuadre de céntimos frente al motor (que agrupa por tipo) va al grupo mayor.
  const groups = [...breakdown.values()].map((group) => ({ ...group, taxCents: amountToCents((group.baseCents * group.category.rate) / 10000) }));
  const difference = totals.taxCents - groups.reduce((sum, group) => sum + group.taxCents, 0);
  if (difference !== 0 && groups.length > 0) {
    groups.reduce((largest, group) => (Math.abs(group.taxCents) > Math.abs(largest.taxCents) ? group : largest)).taxCents += difference;
  }
  const withheldGroups = [...withheld.values()].map((group) => ({ ...group, taxCents: amountToCents((group.baseCents * group.rate) / 10000) }));
  const withheldDifference = totals.retentionCents - withheldGroups.reduce((sum, group) => sum + group.taxCents, 0);
  if (withheldDifference !== 0 && withheldGroups.length > 0) withheldGroups[0].taxCents += withheldDifference;
  if (totals.retentionCents !== 0 && !spfe) {
    warnings.push("La factura lleva retención: el núcleo EN 16931:2017 no la contempla. Va en «WithholdingTaxTotal» y restada del importe a pagar; un validador estricto de 2017 puede señalar la regla BR-CO-16.");
  }
  if (totals.retentionCents !== 0 && spfe) {
    const concepts = [...new Set(withheldGroups.map((group) => group.concept))].join(", ");
    warnings.push(`La factura lleva retención: se ha indicado el concepto ${concepts} de la lista L5 del anexo I (01 actividades profesionales, 06 arrendamientos, 11 otros), deducido del nombre del impuesto. Revísalo antes de remitir la factura.`);
  }
  if (groups.some((group) => group.category.id === "O") && !spfe) warnings.push("Operación no sujeta (categoría «O»): EN 16931 pide que la factura no lleve identificadores de IVA de las partes; revisa el fichero con tu cliente.");
  if (spfe) {
    // BR-ES-CO-1: la solución pública no admite facturas anteriores a la entrada en vigor de la orden.
    if (ISO_DATE.test(data.issueDate) && data.issueDate < "2026-10-06") warnings.push("La fecha de expedición es anterior al 6 de octubre de 2026 (entrada en vigor de la Orden HAC/1028/2026): la solución pública la rechazará (regla BR-ES-CO-1).");
    const usual = system === "IGIC" ? [0, 1, 3, 5, 7, 15, 20] : system === "IPSI" ? [0.5, 1, 2, 4, 8, 10] : data.isCreditNote ? [0, 4, 10, 21, 5, 2, 7.5] : [0, 4, 10, 21];
    const odd = groups.filter((group) => ["S", "L", "M", "N"].includes(group.category.id) && !group.category.surcharge && !usual.includes(group.category.rate));
    if (odd.length > 0) warnings.push(`La solución pública solo admite los tipos impositivos vigentes (reglas BR-ES-S-1, BR-ES-L-1, BR-ES-M-1 y BR-ES-N-3): revisa el ${odd.map((group) => `${decimalString(group.category.rate, 4)} %`).join(", ")}.`);
    if (groups.some((group) => group.category.id === "E")) warnings.push("Operación exenta: se indica el texto de la exención pero no un código VATEX-ES (la lista de códigos españoles no está en la documentación técnica consultada). La AEAT puede exigirlo.");
  }

  const supplier = spfe ? spfePartyNode(data.issuer, "de tu empresa", problems) : partyNode(data.issuer, "de tu empresa", problems);
  const customer = spfe ? spfePartyNode(data.customer, "del cliente", problems) : partyNode(data.customer, "del cliente", problems);

  let billingReference: XmlNode | null = null;
  if (data.isCreditNote) {
    if (!data.corrective?.originalNumber) problems.push("La factura rectificativa no tiene factura original asociada.");
    else {
      billingReference = el("cac:BillingReference", [el("cac:InvoiceDocumentReference", [
        txt("cbc:ID", data.corrective.originalNumber),
        data.corrective.originalIssueDate && ISO_DATE.test(data.corrective.originalIssueDate) ? txt("cbc:IssueDate", data.corrective.originalIssueDate) : null,
      ])]);
    }
  }
  // Tipo y modalidad de la rectificativa e importes rectificados (BG-24 del anexo I; reglas SPFE-CORE-51 y 52).
  const correctiveReferences: XmlNode[] = [];
  if (spfe && data.isCreditNote) {
    const reason = (data.corrective?.reason ?? "").toUpperCase();
    const substitution = (data.corrective?.type ?? "").toUpperCase() === "SUBSTITUTION";
    if (!SPFE_CORRECTIVE_TYPES[reason]) problems.push("La solución pública solo admite los tipos de rectificativa R1 a R4 (lista L2.A): indica la causa de la rectificación en la factura.");
    const reference = (code: string, typeCode: string, description: string) => el("cac:AdditionalDocumentReference", [
      txt("cbc:ID", `${SPFE_DOCUMENT}${code}`),
      txt("cbc:DocumentTypeCode", typeCode),
      txt("cbc:DocumentDescription", description),
    ]);
    correctiveReferences.push(reference("RECT:TIPO", reason, SPFE_CORRECTIVE_TYPES[reason] ?? "-"));
    correctiveReferences.push(reference("RECT:MODALIDAD", substitution ? "S" : "I", substitution ? "Rectificativa por sustitución" : "Rectificativa por diferencias"));
    if (substitution) {
      // BR-ES-CO-8: por sustitución se informan la base y la cuota de la factura rectificada.
      const base = data.corrective?.originalTaxableBase;
      const tax = data.corrective?.originalTaxAmount;
      if (typeof base !== "number" || typeof tax !== "number") problems.push("Rectificativa por sustitución: faltan la base y la cuota de la factura rectificada, que la solución pública exige (regla SPFE-CORE-52).");
      else if (withSurcharge.length > 0) problems.push("Rectificativa por sustitución con recargo de equivalencia: la aplicación no guarda por separado la cuota de recargo rectificada que exige la solución pública. Usa Facturae.");
      else {
        correctiveReferences.push(reference("RECT:IMPORTES", "Base", centsToFixed(amountToCents(base))));
        correctiveReferences.push(reference("RECT:IMPORTES", "Cuota", centsToFixed(amountToCents(tax))));
      }
    }
  }
  if (problems.length > 0) throw new EInvoiceError(problems);

  const payableCents = totals.totalCents;
  const dueDate = data.dueDate && ISO_DATE.test(data.dueDate) ? data.dueDate : null;
  const operationDate = data.operationDate && ISO_DATE.test(data.operationDate) && data.operationDate !== data.issueDate ? data.operationDate : null;
  const paymentCode = data.payment?.type ? PAYMENT_MEANS[data.payment.type] : undefined;
  const iban = (data.payment?.iban ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const notes = [
    ...legalLiterals,
    data.isCreditNote && data.corrective ? [data.corrective.reason ? `Rectificativa ${data.corrective.reason} por diferencias` : "Rectificativa por diferencias", data.corrective.description?.trim()].filter(Boolean).join(": ") : null,
    data.notes?.trim() || null,
  ].filter(Boolean).join(" | ");

  // Perfil de la AEAT. BR-ES-CO-2: la fecha de operación (BT-7, `TaxPointDate`) no puede ser posterior a la de expedición.
  const taxPointDate = spfe && operationDate && operationDate <= data.issueDate ? operationDate : null;
  if (spfe && operationDate && !taxPointDate) warnings.push("La fecha de operación es posterior a la de expedición: la solución pública solo lo admite con las claves de régimen 14 y 15, que la aplicación no usa. No se ha incluido.");
  // SPFE-CORE-18: con transferencia (30) o adeudo (49) la cuenta es obligatoria y debe ser un IBAN válido; con otros medios no puede ir.
  const needsAccount = paymentCode === "30" || paymentCode === "49";
  const spfePaymentMeans = spfe && Boolean(paymentCode) && !data.isCreditNote && (!needsAccount || isValidIban(iban));
  if (spfe && paymentCode && !data.isCreditNote && !spfePaymentMeans) warnings.push("No se ha incluido el medio de pago: la solución pública exige un IBAN válido de la cuenta de cobro con transferencia o domiciliación.");
  const annotations = spfe
    ? [
        // BG-1: una nota por anotación; «REG» (UNTDID 4451) para las menciones obligatorias (BT-21).
        ...legalLiterals.map((literal) => el("cac:Annotation", [txt("cbc:SubjectCode", "REG"), txt("cbc:AnnotationContent", clip(literal, 2000))])),
        data.isCreditNote && data.corrective?.description?.trim() ? el("cac:Annotation", [txt("cbc:AnnotationContent", clip(data.corrective.description, 2000))]) : null,
        data.notes?.trim() ? el("cac:Annotation", [txt("cbc:AnnotationContent", clip(data.notes, 2000))]) : null,
      ]
    : [];

  const root = el("Invoice", [
    txt("cbc:CustomizationID", spfe ? UBL_SPFE_CUSTOMIZATION_ID : UBL_CUSTOMIZATION_ID),
    spfe ? txt("cbc:ProfileID", UBL_SPFE_PROFILE_ID) : null,
    txt("cbc:ID", data.number),
    // BT-ES-1: este fichero es la factura original, no una copia fiel (SPFE-CORE-08: obligatorio).
    spfe ? txt("cbc:CopyIndicator", "false") : null,
    txt("cbc:IssueDate", data.issueDate),
    !data.isCreditNote && payableCents > 0 ? txt("cbc:DueDate", dueDate) : null,
    // UNTDID 1001: 380 factura; 384 factura rectificativa.
    txt("cbc:InvoiceTypeCode", data.isCreditNote ? "384" : "380"),
    spfe ? null : txt("cbc:Note", clip(notes, 2000)),
    txt("cbc:TaxPointDate", taxPointDate),
    txt("cbc:DocumentCurrencyCode", currency),
    billingReference,
    data.verifactuUrl && !spfe
      ? el("cac:AdditionalDocumentReference", [
          txt("cbc:ID", "QR"),
          txt("cbc:DocumentDescription", "VERIFACTU"),
          el("cac:Attachment", [el("cac:ExternalReference", [txt("cbc:URI", data.verifactuUrl)])]),
        ])
      : null,
    // BG-24 «QR fiscal»: la URL de cotejo va en `cbc:UUID` (BT-ES-25).
    data.verifactuUrl && spfe
      ? el("cac:AdditionalDocumentReference", [
          txt("cbc:ID", `${SPFE_DOCUMENT}QR`),
          txt("cbc:UUID", data.verifactuUrl),
          txt("cbc:DocumentDescription", "VERIFACTU"),
        ])
      : null,
    ...correctiveReferences,
    ...annotations,
    el("cac:AccountingSupplierParty", [supplier]),
    el("cac:AccountingCustomerParty", [customer]),
    operationDate && !spfe ? el("cac:Delivery", [txt("cbc:ActualDeliveryDate", operationDate)]) : null,
    spfePaymentMeans
      ? el("cac:PaymentMeans", [
          txt("cbc:PaymentMeansCode", paymentCode),
          needsAccount ? el("cac:PayeeFinancialAccount", [txt("cbc:ID", iban, { schemeID: "IBAN" })]) : null,
        ])
      : null,
    paymentCode && !data.isCreditNote && !spfe
      ? el("cac:PaymentMeans", [
          txt("cbc:PaymentMeansCode", paymentCode),
          paymentCode === "30" && iban ? el("cac:PayeeFinancialAccount", [txt("cbc:ID", iban)]) : null,
        ])
      : null,
    // BR-CO-25: con importe a pagar positivo debe constar el vencimiento o las condiciones de pago.
    !data.isCreditNote && payableCents > 0 && !dueDate ? el("cac:PaymentTerms", [txt("cbc:Note", "Pago al contado")]) : null,
    ...allowanceNodes,
    el("cac:TaxTotal", [
      money("cbc:TaxAmount", totals.taxCents),
      ...groups.map((group) => el("cac:TaxSubtotal", [
        money("cbc:TaxableAmount", group.baseCents),
        money("cbc:TaxAmount", group.taxCents),
        el("cac:TaxCategory", [
          txt("cbc:ID", group.category.id),
          group.category.id === "O" ? null : txt("cbc:Percent", decimalString(group.category.rate, 4)),
          txt("cbc:TaxExemptionReasonCode", group.category.reasonCode),
          txt("cbc:TaxExemptionReason", group.category.reason),
          el("cac:TaxScheme", [txt("cbc:ID", "VAT")]),
        ]),
      ])),
    ]),
    withheldGroups.length > 0
      ? el("cac:WithholdingTaxTotal", [
          money("cbc:TaxAmount", totals.retentionCents),
          ...withheldGroups.map((group) => el("cac:TaxSubtotal", [
            money("cbc:TaxableAmount", group.baseCents),
            money("cbc:TaxAmount", group.taxCents),
            // Como en el anexo I de la Orden HAC/1028/2026 (BG-ES-4): categoría «S» y esquema «WTH»; en su perfil, además, el concepto (BT-ES-21, lista L5).
            el("cac:TaxCategory", [txt("cbc:ID", "S"), txt("cbc:Percent", decimalString(group.rate, 4)), el("cac:TaxScheme", [txt("cbc:ID", "WTH"), spfe ? txt("cbc:TaxTypeCode", group.concept) : null])]),
          ])),
        ])
      : null,
    el("cac:LegalMonetaryTotal", [
      // BT-106 = suma de líneas; BT-109 = BT-106 − descuentos de documento (BT-107).
      money("cbc:LineExtensionAmount", totals.subtotalCents + documentAllowanceCents),
      money("cbc:TaxExclusiveAmount", totals.subtotalCents),
      money("cbc:TaxInclusiveAmount", totals.subtotalCents + totals.taxCents),
      allowanceNodes.length > 0 ? money("cbc:AllowanceTotalAmount", documentAllowanceCents) : null,
      money("cbc:PayableAmount", payableCents),
    ]),
    // BG-34 «Retenciones» (BT-ES-16 «RETE»): en negativo, para que el importe a pagar cumpla BR-CO-16 (ver cabecera).
    spfe && withheldGroups.length > 0
      ? el("cac:CollectionInvoiceLine", [
          txt("cbc:ID", `${SPFE_ADDITIONAL}RETE`),
          money("cbc:TaxInclusiveLineExtensionAmount", -totals.retentionCents),
          el("cac:Item", [txt("cbc:Description", "Retenciones practicadas en la factura")]),
        ])
      : null,
    ...collectionNodes,
    ...lineNodes,
  ], { xmlns: NS_INVOICE, "xmlns:cac": NS_CAC, "xmlns:cbc": NS_CBC });

  return { root, warnings };
}

export function buildUblXml(data: EInvoiceData, profile: UblProfile = "EN16931"): UblResult {
  const { root, warnings } = buildUblTree(data, profile);
  return { xml: xmlDocument(root), warnings, fileName: `${data.number.replace(/[^a-zA-Z0-9._-]+/g, "-")}-ubl${profile === "SPFE" ? "-aeat" : ""}.xml` };
}

export function ublProblems(data: EInvoiceData, profile: UblProfile = "EN16931"): string[] {
  try {
    buildUblTree(data, profile);
    return [];
  } catch (error) {
    if (error instanceof EInvoiceError) return error.problems;
    throw error;
  }
}

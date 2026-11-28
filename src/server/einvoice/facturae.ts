import { amountToCents } from "@/server/taxation/engine";
import {
  centsToFixed,
  computeEInvoiceTotals,
  countryAlpha3,
  decimalString,
  EInvoiceError,
  indirectTaxSystem,
  isNaturalPerson,
  isOtherOutputTax,
  isSurchargeTax,
  isVatTax,
  isDisbursementLine,
  isGlobalDiscountLine,
  isWithholdingTax,
  lineTotalCostCents,
  normalizeDir3,
  partyCountry,
  partyTaxNumber,
  residenceType,
  splitPersonName,
  splitSeriesAndNumber,
  zeroTaxNature,
  type EInvoiceData,
  type EInvoiceLine,
  type EInvoiceParty,
} from "@/server/einvoice/model";
import { clip, el, txt, xmlDocument, type XmlNode } from "@/server/einvoice/xml";

/**
 * Generador PURO de Facturae 3.2.2 a partir de una factura emitida.
 *
 * Fuentes (consultadas el 27-11-2026):
 * - Esquema oficial `Facturaev3_2_2.xml` (XSD, version="3.2.2"):
 *   https://www.facturae.gob.es/content/dam/facturae/formato/versiones/Facturaev3_2_2.xml
 *   Espacio de nombres: http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml
 * - Orden HAP/1650/2015, de 31 de julio (BOE-A-2015-8844), anexo II, regla 6: en las facturas en
 *   euros, coste total e importe bruto de cada línea y todos los demás importes van con DOS
 *   decimales; el precio unitario, los tipos y los porcentajes pueden llevar los decimales que
 *   admite el formato (hasta ocho).
 *
 * Decisiones de redondeo (coherentes con el motor fiscal de la aplicación, en céntimos):
 * - `TotalCost` = cantidad × precio, redondeado a céntimos. `GrossAmount` = base de la línea que
 *   calcula el motor (cantidad × precio × (1 − dto.), un único redondeo). `DiscountAmount` es la
 *   diferencia entre ambos, así que TotalCost − DiscountAmount = GrossAmount siempre.
 * - Las cuotas del desglose de la factura (`TaxesOutputs`, `TaxesWithheld`) son las del motor: se
 *   calculan por tipo sobre la suma de bases, no sumando cuotas de línea. Las cuotas de cada línea
 *   son informativas y su suma puede diferir en céntimos de las de la factura.
 * - `InvoiceTotal` = bruto + impuestos repercutidos − retenciones (sin suplidos).
 *
 * Líneas especiales de la factura (anotaciones del XSD de `InvoiceTotalsType`):
 * - SUPLIDOS (`isDisbursement`, art. 78.Tres.3.º LIVA): no son base imponible, así que no van como
 *   línea de detalle sino en `ReimbursableExpenses` y `TotalReimbursableExpenses` («suplidos
 *   incorporados en la factura»), y suman en `TotalExecutableAmount` («TotalOutstandingAmount −
 *   retenciones + suplidos…»). Su descripción, que el tipo no admite, va en la información adicional.
 * - DESCUENTO GLOBAL (`isGlobalDiscount`, art. 78.Tres.2.º LIVA): `GeneralDiscounts`, uno por
 *   combinación de impuestos, y `TotalGeneralDiscounts`; `TotalGrossAmountBeforeTaxes` =
 *   `TotalGrossAmount` − descuentos generales, y las bases del desglose de la factura ya los
 *   restan. Las cuotas de cada línea siguen siendo sobre su bruto (informativas, como el esquema).
 * - ANTICIPO DESCONTADO (`advanceInvoiceId`): la factura de anticipo ya repercutió el IVA de lo
 *   cobrado (art. 75.Dos LIVA), así que la final MINORA LA BASE (art. 80 no aplica: no es una
 *   rectificación) y el anticipo va como línea de detalle negativa con su impuesto. NO se usa
 *   `PaymentsOnAccount`, que según el XSD resta de `InvoiceTotal` sin tocar la base ni las cuotas:
 *   sería para pagos a cuenta sin factura propia, y con IVA ya repercutido duplicaría la cuota.
 * - Datos registrales del emisor persona jurídica: `RegistrationData` (Tomo, Libro, Folio, Hoja,
 *   Sección y Registro) deducidos del texto libre de la empresa; si no se reconoce nada, se omiten.
 *
 * Lo que este generador NO cubre: lotes (modalidad L), facturas en divisa distinta del euro,
 * cargos generales, cesiones de crédito, adjuntos y extensiones.
 */

export const FACTURAE_VERSION = "3.2.2";
export const FACTURAE_NAMESPACE = "http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml";
export const XMLDSIG_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";
export const FACTURAE_XSD_URL = "https://www.facturae.gob.es/content/dam/facturae/formato/versiones/Facturaev3_2_2.xml";

/** Códigos de impuesto de Facturae (TaxTypeCodeType). */
const TAX_TYPE_CODE = { VAT: "01", IPSI: "02", IGIC: "03", IRPF: "04", OTHER: "05" } as const;

/** Medios de pago de Facturae (PaymentMeansType): 01 al contado, 02 recibo domiciliado, 04 transferencia, 19 tarjeta. */
const PAYMENT_MEANS: Record<string, string> = { CASH: "01", DIRECT_DEBIT: "02", BANK_TRANSFER: "04", CARD: "19" };

/**
 * Motivo de la rectificación. Facturae tiene su propia lista (01–16 y 80–85), que no coincide con
 * las claves R1–R5 de la AEAT y para la que no hay tabla oficial de equivalencias. Solo R2
 * (concurso de acreedores) tiene un código inequívoco, el 85. Para el resto se usa el 16 «Base
 * imponible» (nuestras rectificativas siempre modifican importes) y la causa real con su clave de
 * la AEAT viaja en `AdditionalReasonDescription`. EQUIVALENCIA NO OFICIAL.
 */
const CORRECTIVE_REASON: Record<string, { code: string; description: string }> = {
  R2: { code: "85", description: "Base imponible modificada cuotas repercutidas no satisfechas. Auto de declaración de concurso" },
};
const DEFAULT_CORRECTIVE_REASON = { code: "16", description: "Base imponible" };

const RECTIFICATION_REASON_TEXT: Record<string, string> = {
  R1: "R1: error fundado en derecho o causas del art. 80.Uno, Dos y Seis de la Ley 37/1992",
  R2: "R2: concurso de acreedores del destinatario (art. 80.Tres de la Ley 37/1992)",
  R3: "R3: crédito incobrable (art. 80.Cuatro de la Ley 37/1992)",
  R4: "R4: otras causas",
  R5: "R5: rectificación de factura simplificada",
};

export type FacturaeResult = {
  xml: string;
  /** Avisos que no impiden generar el fichero pero conviene revisar antes de enviarlo. */
  warnings: string[];
  fileName: string;
};

const amount = (cents: number) => centsToFixed(cents);

function taxCodeFor(data: EInvoiceData) {
  const system = indirectTaxSystem(data.issuerTerritory);
  return system === "IGIC" ? TAX_TYPE_CODE.IGIC : system === "IPSI" ? TAX_TYPE_CODE.IPSI : TAX_TYPE_CODE.VAT;
}

// ---------------------------------------------------------------------------------------------
// Partes
// ---------------------------------------------------------------------------------------------

function addressNode(party: EInvoiceParty, who: string, problems: string[]): XmlNode {
  const country = partyCountry(party);
  const alpha3 = countryAlpha3(country);
  const street = clip([party.address, party.addressLine2].filter(Boolean).join(", "), 80);
  const town = clip(party.city, 50);
  const province = clip(party.province ?? party.city, 20);
  if (!street) problems.push(`Falta la dirección ${who}.`);
  if (!town) problems.push(`Falta la población ${who}.`);
  if (!alpha3) problems.push(`El país ${who} (${country}) no está en la tabla de países de este generador de Facturae.`);
  if (country === "ES") {
    const postCode = (party.postalCode ?? "").trim();
    if (!/^\d{5}$/.test(postCode)) problems.push(`El código postal ${who} debe tener 5 cifras.`);
    return el("AddressInSpain", [
      txt("Address", street ?? "-"),
      txt("PostCode", /^\d{5}$/.test(postCode) ? postCode : "00000"),
      txt("Town", town ?? "-"),
      txt("Province", province ?? "-"),
      txt("CountryCode", "ESP"),
    ]);
  }
  return el("OverseasAddress", [
    txt("Address", street ?? "-"),
    txt("PostCodeAndTown", clip([party.postalCode, party.city].filter(Boolean).join(" "), 50) ?? "-"),
    txt("Province", province ?? "-"),
    txt("CountryCode", alpha3 ?? "ESP"),
  ]);
}

function contactNode(party: EInvoiceParty): XmlNode | null {
  const children = [
    txt("Telephone", clip(party.phone, 15)),
    txt("WebAddress", clip(party.website, 60)),
    txt("ElectronicMail", clip(party.email, 60)),
  ].filter(Boolean);
  return children.length > 0 ? el("ContactDetails", children) : null;
}

function administrativeCentres(data: EInvoiceData, problems: string[]): XmlNode | null {
  const dir3 = data.dir3;
  if (!dir3) return null;
  // Roles de Facturae para FACe: 01 «Fiscal» = oficina contable, 02 «Receptor» = órgano gestor,
  // 03 «Pagador» = unidad tramitadora, 04 «Comprador» = órgano proponente.
  const centres: Array<{ code: string | null; role: string; label: string }> = [
    { code: normalizeDir3(dir3.accountingOffice), role: "01", label: "Oficina contable" },
    { code: normalizeDir3(dir3.managingBody), role: "02", label: "Órgano gestor" },
    { code: normalizeDir3(dir3.processingUnit), role: "03", label: "Unidad tramitadora" },
    { code: normalizeDir3(dir3.proposingBody), role: "04", label: "Órgano proponente" },
  ];
  const present = centres.filter((centre): centre is { code: string; role: string; label: string } => Boolean(centre.code));
  if (present.length === 0) return null;
  for (const centre of present) {
    if (centre.code.length > 10) problems.push(`El código DIR3 de «${centre.label}» no puede superar 10 caracteres.`);
  }
  // El esquema obliga a dar un domicilio en cada centro: se usa el del destinatario.
  const scratch: string[] = [];
  return el("AdministrativeCentres", present.map((centre) => el("AdministrativeCentre", [
    txt("CentreCode", centre.code),
    txt("RoleTypeCode", centre.role),
    addressNode(data.customer, "del cliente", scratch),
    txt("CentreDescription", centre.label),
  ])));
}

/**
 * `RegistrationData` (RegistrationDataType, campos de hasta 20 caracteres) a partir del texto libre
 * de los datos registrales («Registro Mercantil de Madrid, Tomo 1234, Folio 56, Hoja M-7890…»).
 * Solo lo que se reconoce con seguridad; un campo que no cabe en 20 caracteres no se emite.
 */
export function registrationDataFields(text: string | null | undefined): Array<[string, string]> {
  const source = (text ?? "").replace(/\s+/g, " ").trim();
  if (!source) return [];
  const value = (pattern: RegExp) => {
    const match = pattern.exec(source);
    const found = match?.[1]?.trim().replace(/[.,;]+$/, "");
    return found && Array.from(found).length <= 20 ? found : null;
  };
  const fields: Array<[string, string | null]> = [
    ["Book", value(/\blibro\s*:?\s*([^,;]+)/i)],
    ["RegisterOfCompaniesLocation", value(/registro\s+mercantil\s+de\s+([^,;.]+)/i)],
    ["Sheet", value(/\bhoja\s*(?:n\.?º|n[úu]m\.?|n[úu]mero)?\s*:?\s*([^,;\s]+)/i)],
    ["Folio", value(/\bfolio\s*:?\s*([^,;\s]+)/i)],
    ["Section", value(/\bsecci[oó]n\s*:?\s*([^,;]+)/i)],
    ["Volume", value(/\btomo\s*:?\s*([^,;\s]+)/i)],
    ["AdditionalRegistrationData", value(/\binscripci[oó]n\s*:?\s*([^,;]+)/i)],
  ];
  return fields.filter((field): field is [string, string] => field[1] !== null);
}

function partyNode(tag: "SellerParty" | "BuyerParty", party: EInvoiceParty, who: string, problems: string[], warnings: string[], centres: XmlNode | null): XmlNode {
  const taxNumber = partyTaxNumber(party);
  if (taxNumber.length < 3 || taxNumber.length > 30) problems.push(`Falta el NIF ${who}: Facturae no admite facturas sin identificación fiscal de las dos partes.`);
  const natural = isNaturalPerson(party);
  const fullName = (party.legalName?.trim() || party.name || "").trim();
  if (!fullName) problems.push(`Falta el nombre o la razón social ${who}.`);
  let person: XmlNode;
  if (natural) {
    const name = splitPersonName(fullName || "-");
    warnings.push(`El NIF ${who} es de persona física: Facturae pide nombre y apellidos por separado y se han deducido del nombre completo («${name.name}» / «${name.firstSurname}»${name.secondSurname ? ` / «${name.secondSurname}»` : ""}). Compruébalos.`);
    person = el("Individual", [
      txt("Name", clip(name.name, 40) ?? "-"),
      txt("FirstSurname", clip(name.firstSurname, 40) ?? "-"),
      txt("SecondSurname", clip(name.secondSurname, 40)),
      addressNode(party, who, problems),
      contactNode(party),
    ]);
  } else {
    const tradeName = party.legalName?.trim() && party.name?.trim() && party.legalName.trim() !== party.name.trim() ? clip(party.name, 40) : null;
    const registration = tag === "SellerParty" ? registrationDataFields(party.registryData) : [];
    if (tag === "SellerParty" && party.registryData?.trim() && registration.length === 0) {
      warnings.push("No se han reconocido los datos registrales de la empresa (tomo, folio, hoja…): no van en los campos estructurados de Facturae.");
    }
    person = el("LegalEntity", [
      txt("CorporateName", clip(fullName, 80) ?? "-"),
      txt("TradeName", tradeName),
      registration.length > 0 ? el("RegistrationData", registration.map(([name, value]) => txt(name, value))) : null,
      addressNode(party, who, problems),
      contactNode(party),
    ]);
  }
  return el(tag, [
    el("TaxIdentification", [
      txt("PersonTypeCode", natural ? "F" : "J"),
      txt("ResidenceTypeCode", residenceType(party)),
      txt("TaxIdentificationNumber", taxNumber || "---"),
    ]),
    centres,
    person,
  ]);
}

// ---------------------------------------------------------------------------------------------
// Impuestos
// ---------------------------------------------------------------------------------------------

type OutputGroup = {
  code: string;
  rate: number;
  surchargeRate: number | null;
  baseCents: number;
  taxCents: number;
  surchargeCents: number;
  /** Nombre del impuesto cuando es «05 Otro». */
  name: string | null;
};

type LineTaxes = {
  outputs: OutputGroup[];
  withheld: Array<{ rate: number; baseCents: number; taxCents: number }>;
  /** La línea no lleva cuota del impuesto indirecto (exenta, no sujeta, inversión…). */
  zeroIndirect: boolean;
};

const taxOn = (baseCents: number, rate: number) => amountToCents((baseCents * rate) / 10000);

function lineTaxes(line: EInvoiceLine, baseCents: number, indirectCode: string): LineTaxes {
  const vat = line.taxes.filter(isVatTax);
  const surcharge = line.taxes.filter(isSurchargeTax);
  const outputs: OutputGroup[] = vat.map((tax, index) => {
    // El recargo de equivalencia viaja dentro del impuesto al que acompaña (misma base).
    const paired = index === 0 ? surcharge[0] : undefined;
    return {
      code: indirectCode,
      rate: tax.rate,
      surchargeRate: paired ? paired.rate : null,
      baseCents,
      taxCents: taxOn(baseCents, tax.rate),
      surchargeCents: paired ? taxOn(baseCents, paired.rate) : 0,
      name: null,
    };
  });
  const zeroIndirect = vat.length === 0 || vat.every((tax) => tax.rate === 0);
  if (vat.length === 0) {
    // El esquema exige al menos un impuesto repercutido por línea: tipo 0 sobre la base.
    outputs.push({ code: indirectCode, rate: 0, surchargeRate: null, baseCents, taxCents: 0, surchargeCents: 0, name: null });
  }
  for (const tax of line.taxes.filter(isOtherOutputTax)) {
    outputs.push({ code: TAX_TYPE_CODE.OTHER, rate: tax.rate, surchargeRate: null, baseCents, taxCents: taxOn(baseCents, tax.rate), surchargeCents: 0, name: tax.name ?? null });
  }
  const withheld = line.taxes.filter(isWithholdingTax).map((tax) => ({ rate: tax.rate, baseCents, taxCents: taxOn(baseCents, tax.rate) }));
  return { outputs, withheld, zeroIndirect };
}

function outputTaxNode(group: OutputGroup): XmlNode {
  return el("Tax", [
    txt("TaxTypeCode", group.code),
    txt("TaxRate", decimalString(group.rate, 8, 2)),
    el("TaxableBase", [txt("TotalAmount", amount(group.baseCents))]),
    el("TaxAmount", [txt("TotalAmount", amount(group.taxCents))]),
    // Tipo de recargo «siempre con dos decimales» (DoubleTwoDecimalType).
    group.surchargeRate !== null ? txt("EquivalenceSurcharge", group.surchargeRate.toFixed(2)) : null,
    group.surchargeRate !== null ? el("EquivalenceSurchargeAmount", [txt("TotalAmount", amount(group.surchargeCents))]) : null,
  ]);
}

function withheldTaxNode(tax: { rate: number; baseCents: number; taxCents: number }): XmlNode {
  return el("Tax", [
    txt("TaxTypeCode", TAX_TYPE_CODE.IRPF),
    txt("TaxRate", decimalString(tax.rate, 8, 2)),
    el("TaxableBase", [txt("TotalAmount", amount(tax.baseCents))]),
    el("TaxAmount", [txt("TotalAmount", amount(tax.taxCents))]),
  ]);
}

const groupKey = (group: Pick<OutputGroup, "code" | "rate" | "surchargeRate" | "name">) =>
  `${group.code}|${group.rate}|${group.surchargeRate ?? ""}|${group.code === TAX_TYPE_CODE.OTHER ? group.name ?? "" : ""}`;

/**
 * Reparte un total exacto (el del motor fiscal) entre grupos proporcionalmente a su importe
 * provisional: el descuadre de céntimos va al grupo mayor. Así el desglose de la factura suma
 * exactamente las cuotas guardadas aunque Facturae agrupe distinto (IVA con y sin recargo).
 */
function settle(provisional: number[], exactTotal: number): number[] {
  const result = [...provisional];
  const difference = exactTotal - result.reduce((sum, value) => sum + value, 0);
  if (difference !== 0 && result.length > 0) {
    let largest = 0;
    for (let index = 1; index < result.length; index += 1) if (Math.abs(result[index]) > Math.abs(result[largest])) largest = index;
    result[largest] += difference;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------------------------

function safeFileName(number: string, extension: string) {
  return `${number.replace(/[^a-zA-Z0-9._-]+/g, "-")}.${extension}`;
}

function monthBounds(isoDate: string): { start: string; end: string } {
  const [year, month] = isoDate.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  return { start: `${prefix}-01`, end: `${prefix}-${String(last).padStart(2, "0")}` };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Árbol XML de la factura (sin firma). Lanza `EInvoiceError` con todos los datos que faltan.
 * `buildFacturaeXml` lo serializa; la firma XAdES añade `ds:Signature` como último hijo de la raíz.
 */
export function buildFacturaeTree(data: EInvoiceData): { root: XmlNode; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (data.currency.toUpperCase() !== "EUR") problems.push("Este generador de Facturae solo admite facturas en euros.");
  if (!ISO_DATE.test(data.issueDate)) problems.push("La factura no tiene fecha de expedición.");
  if (data.lines.length === 0) problems.push("La factura no tiene líneas.");
  const totals = computeEInvoiceTotals(data);

  const { series, number } = splitSeriesAndNumber(data.number);
  let invoiceNumber = number;
  let invoiceSeries = series;
  if (Array.from(invoiceNumber).length > 20 || (invoiceSeries !== null && Array.from(invoiceSeries).length > 20)) {
    invoiceNumber = data.number.trim();
    invoiceSeries = null;
    if (Array.from(invoiceNumber).length > 20) problems.push("El número de factura supera los 20 caracteres que admite Facturae.");
  }

  const indirectCode = taxCodeFor(data);
  const nature = zeroTaxNature(data.vatTreatment, data.vatExemptionCode);
  const legalLiterals = data.legalLiterals.map((literal) => literal.trim()).filter(Boolean);

  // --- Líneas -------------------------------------------------------------------------------
  const invoiceGroups = new Map<string, OutputGroup>();
  const withheldGroups = new Map<number, { rate: number; baseCents: number; taxCents: number }>();
  const lineNodes: XmlNode[] = [];
  const generalDiscounts: Array<{ reason: string; cents: number }> = [];
  const reimbursable: Array<{ description: string; cents: number }> = [];
  data.lines.forEach((line, index) => {
    // Suplido: fuera de la base y de los impuestos; va en ReimbursableExpenses.
    if (isDisbursementLine(line)) {
      reimbursable.push({ description: line.description?.trim() || "Suplido", cents: amountToCents(totals.lines[index]?.disbursementAmount ?? 0) });
      return;
    }
    const grossCents = amountToCents(totals.lines[index]?.subtotal ?? 0);
    const totalCostCents = lineTotalCostCents(line);
    const discountCents = totalCostCents - grossCents;
    const taxes = lineTaxes(line, grossCents, indirectCode);
    for (const group of taxes.outputs) {
      const key = groupKey(group);
      const current = invoiceGroups.get(key);
      if (current) current.baseCents += group.baseCents;
      else invoiceGroups.set(key, { ...group, taxCents: 0, surchargeCents: 0 });
    }
    for (const tax of taxes.withheld) {
      const current = withheldGroups.get(tax.rate);
      if (current) current.baseCents += tax.baseCents;
      else withheldGroups.set(tax.rate, { rate: tax.rate, baseCents: tax.baseCents, taxCents: 0 });
    }
    // Descuento global: resta de las bases del desglose, pero no es una línea de detalle.
    if (isGlobalDiscountLine(line)) {
      generalDiscounts.push({ reason: clip(line.description, 2500) ?? "Descuento", cents: -grossCents });
      return;
    }
    const otherNames = taxes.outputs.filter((group) => group.code === TAX_TYPE_CODE.OTHER && group.name).map((group) => `05 = ${group.name}`);
    // Exenta o no sujeta: el motivo va precedido del código del impuesto al que se refiere.
    const special = taxes.zeroIndirect && (nature === "EXEMPT" || nature === "EXPORT" || nature === "INTRA_EU" || nature === "NOT_SUBJECT")
      ? el("SpecialTaxableEvent", [
          txt("SpecialTaxableEventCode", nature === "NOT_SUBJECT" ? "02" : "01"),
          txt("SpecialTaxableEventReason", clip(`${indirectCode} ${legalLiterals[legalLiterals.length - 1] ?? (nature === "NOT_SUBJECT" ? "Operación no sujeta" : "Operación exenta")}`, 2500)),
        ])
      : null;
    if (!line.description?.trim()) problems.push(`La línea ${index + 1} no tiene descripción.`);
    lineNodes.push(el("InvoiceLine", [
      txt("ItemDescription", clip(line.description, 2500) ?? "-"),
      txt("Quantity", decimalString(line.quantity, 8)),
      txt("UnitPriceWithoutTax", decimalString(line.unitPrice, 8, 2)),
      txt("TotalCost", amount(totalCostCents)),
      discountCents !== 0
        ? el("DiscountsAndRebates", [el("Discount", [
            txt("DiscountReason", "Descuento"),
            (line.discountPct ?? 0) > 0 ? txt("DiscountRate", decimalString(line.discountPct ?? 0, 8, 2)) : null,
            txt("DiscountAmount", amount(discountCents)),
          ])])
        : null,
      txt("GrossAmount", amount(grossCents)),
      taxes.withheld.length > 0 ? el("TaxesWithheld", taxes.withheld.map(withheldTaxNode)) : null,
      el("TaxesOutputs", taxes.outputs.map(outputTaxNode)),
      otherNames.length > 0 ? txt("AdditionalLineItemInformation", clip(otherNames.join("; "), 2500)) : null,
      special,
    ]));
  });
  if (lineNodes.length === 0 && data.lines.length > 0) problems.push("La factura solo tiene suplidos o descuentos: Facturae exige al menos una línea de detalle.");
  const generalDiscountCents = generalDiscounts.reduce((sum, discount) => sum + discount.cents, 0);
  const reimbursableCents = reimbursable.reduce((sum, expense) => sum + expense.cents, 0);

  // --- Desglose de la factura: cuadra con los totales del motor ---------------------------------
  const groups = [...invoiceGroups.values()];
  for (const group of groups) {
    group.taxCents = taxOn(group.baseCents, group.rate);
    group.surchargeCents = group.surchargeRate !== null ? taxOn(group.baseCents, group.surchargeRate) : 0;
  }
  // Total exacto de impuestos repercutidos (cuotas + recargos + otros): el del motor.
  const provisional = groups.flatMap((group) => (group.surchargeRate !== null ? [group.taxCents, group.surchargeCents] : [group.taxCents]));
  const settled = settle(provisional, totals.taxCents);
  let cursor = 0;
  for (const group of groups) {
    group.taxCents = settled[cursor++];
    if (group.surchargeRate !== null) group.surchargeCents = settled[cursor++];
  }
  const withheld = [...withheldGroups.values()];
  const settledWithheld = settle(withheld.map((tax) => taxOn(tax.baseCents, tax.rate)), totals.retentionCents);
  withheld.forEach((tax, index) => { tax.taxCents = settledWithheld[index]; });

  // Total a pagar (con suplidos) y total de la factura (sin ellos).
  const totalCents = totals.totalCents;
  const invoiceTotalCents = totals.invoiceTotalCents;

  // --- Rectificativa ------------------------------------------------------------------------
  let corrective: XmlNode | null = null;
  if (data.isCreditNote) {
    const original = data.corrective;
    if (!original?.originalNumber) {
      problems.push("La factura rectificativa no tiene factura original asociada.");
    } else {
      const originalParts = splitSeriesAndNumber(original.originalNumber);
      const fits = Array.from(originalParts.number).length <= 20 && (originalParts.series === null || Array.from(originalParts.series).length <= 20);
      const reason = CORRECTIVE_REASON[(original.reason ?? "").toUpperCase()] ?? DEFAULT_CORRECTIVE_REASON;
      // Periodo natural en el que tributó la factura rectificada: el mes de su expedición.
      const period = monthBounds(original.originalIssueDate && ISO_DATE.test(original.originalIssueDate) ? original.originalIssueDate : data.issueDate);
      const reasonText = [RECTIFICATION_REASON_TEXT[(original.reason ?? "").toUpperCase()], original.description?.trim()].filter(Boolean).join(". ");
      corrective = el("Corrective", [
        txt("InvoiceNumber", fits ? originalParts.number : clip(original.originalNumber, 20)),
        fits ? txt("InvoiceSeriesCode", originalParts.series) : null,
        txt("ReasonCode", reason.code),
        txt("ReasonDescription", reason.description),
        el("TaxPeriod", [txt("StartDate", period.start), txt("EndDate", period.end)]),
        // Como en el registro VERI*FACTU (TipoRectificativa «I»): los importes van siempre por diferencias.
        txt("CorrectionMethod", "02"),
        txt("CorrectionMethodDescription", "Rectificación por diferencias"),
        txt("AdditionalReasonDescription", clip(reasonText, 2500)),
        original.originalIssueDate && ISO_DATE.test(original.originalIssueDate) ? txt("InvoiceIssueDate", original.originalIssueDate) : null,
      ]);
    }
  }

  // --- Pago ---------------------------------------------------------------------------------
  let paymentDetails: XmlNode | null = null;
  if (!data.isCreditNote && totalCents > 0 && data.payment?.type && PAYMENT_MEANS[data.payment.type]) {
    const means = PAYMENT_MEANS[data.payment.type];
    const iban = (data.payment.iban ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const debtorIban = (data.payment.debtorIban ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const dueDate = data.dueDate && ISO_DATE.test(data.dueDate) ? data.dueDate : data.issueDate;
    if (means === "04" && !iban) warnings.push("La forma de pago es transferencia pero no consta el IBAN de cobro: la factura irá sin cuenta bancaria.");
    paymentDetails = el("PaymentDetails", [el("Installment", [
      txt("InstallmentDueDate", dueDate),
      txt("InstallmentAmount", amount(totalCents)),
      txt("PaymentMeans", means),
      means === "04" && iban.length >= 5 && iban.length <= 34 ? el("AccountToBeCredited", [txt("IBAN", iban)]) : null,
      means === "02" && debtorIban.length >= 5 && debtorIban.length <= 34 ? el("AccountToBeDebited", [txt("IBAN", debtorIban)]) : null,
    ])]);
  }

  // --- Partes -------------------------------------------------------------------------------
  const seller = partyNode("SellerParty", data.issuer, "de tu empresa", problems, warnings, null);
  const buyer = partyNode("BuyerParty", data.customer, "del cliente", problems, warnings, administrativeCentres(data, problems));

  const longLiterals = legalLiterals.filter((literal) => Array.from(literal).length > 250);
  if (longLiterals.length > 0) warnings.push("Alguna mención legal supera los 250 caracteres de Facturae y se ha recortado.");

  const additionalInformation = [
    reimbursable.length > 0 ? `Suplidos (art. 78.Tres.3.º Ley 37/1992): ${reimbursable.map((expense) => `${expense.description} ${amount(expense.cents)}`).join("; ")}` : null,
    data.verifactuUrl ? `Factura verificable en la sede electrónica de la AEAT (VERI*FACTU): ${data.verifactuUrl}` : null,
    data.notes?.trim() || null,
  ].filter(Boolean).join(" | ");

  if (problems.length > 0) throw new EInvoiceError(problems);

  const sellerTaxNumber = partyTaxNumber(data.issuer);
  const operationDate = data.operationDate && ISO_DATE.test(data.operationDate) && data.operationDate !== data.issueDate ? data.operationDate : null;
  const totalAmountNode = (name: string, cents: number) => el(name, [txt("TotalAmount", amount(cents))]);

  const root = el("fe:Facturae", [
    el("FileHeader", [
      txt("SchemaVersion", FACTURAE_VERSION),
      // Modalidad individual: un fichero, una factura. Emisor = el propio proveedor.
      txt("Modality", "I"),
      txt("InvoiceIssuerType", "EM"),
      el("Batch", [
        txt("BatchIdentifier", clip(`${sellerTaxNumber}${invoiceNumber}${invoiceSeries ?? ""}`, 70)),
        txt("InvoicesCount", "1"),
        totalAmountNode("TotalInvoicesAmount", invoiceTotalCents),
        totalAmountNode("TotalOutstandingAmount", invoiceTotalCents),
        totalAmountNode("TotalExecutableAmount", totalCents),
        txt("InvoiceCurrencyCode", "EUR"),
      ]),
    ]),
    el("Parties", [seller, buyer]),
    el("Invoices", [el("Invoice", [
      el("InvoiceHeader", [
        txt("InvoiceNumber", invoiceNumber),
        txt("InvoiceSeriesCode", invoiceSeries),
        // FC = factura completa. OO = original; OR = original rectificativa.
        txt("InvoiceDocumentType", "FC"),
        txt("InvoiceClass", data.isCreditNote ? "OR" : "OO"),
        corrective,
      ]),
      el("InvoiceIssueData", [
        txt("IssueDate", data.issueDate),
        txt("OperationDate", operationDate),
        txt("InvoiceCurrencyCode", "EUR"),
        txt("TaxCurrencyCode", "EUR"),
        txt("LanguageName", "es"),
      ]),
      el("TaxesOutputs", groups.map(outputTaxNode)),
      withheld.length > 0 ? el("TaxesWithheld", withheld.map(withheldTaxNode)) : null,
      el("InvoiceTotals", [
        txt("TotalGrossAmount", amount(totals.subtotalCents + generalDiscountCents)),
        generalDiscounts.length > 0
          ? el("GeneralDiscounts", generalDiscounts.map((discount) => el("Discount", [txt("DiscountReason", discount.reason), txt("DiscountAmount", amount(discount.cents))])))
          : null,
        generalDiscounts.length > 0 ? txt("TotalGeneralDiscounts", amount(generalDiscountCents)) : null,
        txt("TotalGrossAmountBeforeTaxes", amount(totals.subtotalCents)),
        txt("TotalTaxOutputs", amount(totals.taxCents)),
        txt("TotalTaxesWithheld", amount(totals.retentionCents)),
        txt("InvoiceTotal", amount(invoiceTotalCents)),
        reimbursable.length > 0
          ? el("ReimbursableExpenses", reimbursable.map((expense) => el("ReimbursableExpenses", [txt("ReimbursableExpensesAmount", amount(expense.cents))])))
          : null,
        txt("TotalOutstandingAmount", amount(invoiceTotalCents)),
        txt("TotalExecutableAmount", amount(totalCents)),
        reimbursable.length > 0 ? txt("TotalReimbursableExpenses", amount(reimbursableCents)) : null,
      ]),
      el("Items", lineNodes),
      paymentDetails,
      legalLiterals.length > 0 ? el("LegalLiterals", legalLiterals.map((literal) => txt("LegalReference", clip(literal, 250)))) : null,
      additionalInformation ? el("AdditionalData", [txt("InvoiceAdditionalInformation", clip(additionalInformation, 2500))]) : null,
    ])]),
  ], { "xmlns:ds": XMLDSIG_NAMESPACE, "xmlns:fe": FACTURAE_NAMESPACE });

  return { root, warnings };
}

/** Facturae 3.2.2 sin firmar (`.xml`). Para FACe hay que firmarlo: ver `signFacturae` en `xades.ts`. */
export function buildFacturaeXml(data: EInvoiceData): FacturaeResult {
  const { root, warnings } = buildFacturaeTree(data);
  return { xml: xmlDocument(root), warnings, fileName: safeFileName(data.number, "xml") };
}

/** Problemas que impedirían generar el Facturae, sin lanzar (para avisar en pantalla antes de descargar). */
export function facturaeProblems(data: EInvoiceData): string[] {
  try {
    buildFacturaeTree(data);
    return [];
  } catch (error) {
    if (error instanceof EInvoiceError) return error.problems;
    throw error;
  }
}

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
 * ESTE GENERADOR NO ES ESE PERFIL. Produce el núcleo EN 16931:2017, que es lo que se puede
 * contrastar hoy; el perfil de la AEAT se apoya en la versión 2026 de la norma y en unas
 * especificaciones técnicas que no se han podido contrastar. Diferencias conocidas:
 * - No se emiten los campos BT-ES (clave de régimen, tipo de rectificativa R1–R4, QR en
 *   `cbc:UUID`, indicador de copia…) ni los identificadores de proceso de la AEAT.
 * - El recargo de equivalencia y los impuestos distintos del IVA/IGIC/IPSI no existen en el núcleo
 *   de 2017 (la orden los resuelve con la categoría «N» y con cargos): con ellos NO se genera UBL.
 * - La retención de IRPF tampoco existe en el núcleo: se informa en `cac:WithholdingTaxTotal`
 *   (elemento propio de UBL 2.1, el mismo que usa la orden) y se resta del importe a pagar, de modo
 *   que la regla BR-CO-16 de un validador estricto de 2017 no la contempla. Se avisa.
 * - Rectificativas: tipo 384 («factura rectificativa», lista L1 de la orden) con importes por
 *   diferencias y referencia a la factura original (BG-3).
 *
 * Redondeos: los mismos del motor fiscal (céntimos); bases por línea, cuotas por tipo.
 */

export const UBL_CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017";
const NS_INVOICE = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
const NS_CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
const NS_CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";

/** Medios de pago UNTDID 4461: 10 efectivo, 30 transferencia, 48 tarjeta, 49 adeudo domiciliado. */
const PAYMENT_MEANS: Record<string, string> = { CASH: "10", BANK_TRANSFER: "30", CARD: "48", DIRECT_DEBIT: "49" };

export type UblResult = { xml: string; warnings: string[]; fileName: string };

type Category = { id: string; rate: number; reasonCode: string | null; reason: string | null };

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

export function buildUblTree(data: EInvoiceData): { root: XmlNode; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  const currency = data.currency.toUpperCase();
  const money = (name: string, cents: number) => txt(name, centsToFixed(cents), { currencyID: currency });

  if (!ISO_DATE.test(data.issueDate)) problems.push("La factura no tiene fecha de expedición.");
  if (data.lines.length === 0) problems.push("La factura no tiene líneas.");
  if (data.lines.some((line) => line.taxes.some(isSurchargeTax))) {
    problems.push("La factura lleva recargo de equivalencia, que el núcleo EN 16931:2017 no sabe expresar. Usa Facturae; el perfil UBL de la AEAT (Orden HAC/1028/2026) lo incorporará cuando se implemente.");
  }
  if (data.lines.some((line) => line.taxes.some(isOtherOutputTax))) {
    problems.push("La factura lleva impuestos distintos del IVA, IGIC o IPSI, que el núcleo EN 16931:2017 no sabe expresar. Usa Facturae.");
  }
  if (data.lines.some((line) => line.taxes.filter(isVatTax).length > 1)) problems.push("Alguna línea tiene más de un tipo de IVA: EN 16931 solo admite uno por línea.");
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

  const breakdown = new Map<string, { category: Category; baseCents: number }>();
  const withheld = new Map<number, number>();
  const lineNodes = data.lines.map((line, index) => {
    const netCents = amountToCents(totals.lines[index]?.subtotal ?? 0);
    const vat = line.taxes.find(isVatTax);
    const category = categoryFor(vat ? vat.rate : null);
    const key = `${category.id}|${category.rate}`;
    const current = breakdown.get(key);
    if (current) current.baseCents += netCents;
    else breakdown.set(key, { category, baseCents: netCents });
    for (const tax of line.taxes.filter(isWithholdingTax)) withheld.set(tax.rate, (withheld.get(tax.rate) ?? 0) + netCents);

    // BR-27: el precio no puede ser negativo; el signo de una línea de abono va en la cantidad.
    const negativePrice = line.unitPrice < 0;
    const quantity = negativePrice ? -line.quantity : line.quantity;
    const unitPrice = negativePrice ? -line.unitPrice : line.unitPrice;
    const allowanceCents = lineTotalCostCents(line) - netCents;
    if (!line.description?.trim()) problems.push(`La línea ${index + 1} no tiene descripción.`);
    return el("cac:InvoiceLine", [
      txt("cbc:ID", String(index + 1)),
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
      ]),
      el("cac:Price", [txt("cbc:PriceAmount", decimalString(unitPrice, 8, 2), { currencyID: currency })]),
    ]);
  });

  // Cuotas por categoría y tipo; el descuadre de céntimos frente al motor (que agrupa por tipo) va al grupo mayor.
  const groups = [...breakdown.values()].map((group) => ({ ...group, taxCents: amountToCents((group.baseCents * group.category.rate) / 10000) }));
  const difference = totals.taxCents - groups.reduce((sum, group) => sum + group.taxCents, 0);
  if (difference !== 0 && groups.length > 0) {
    groups.reduce((largest, group) => (Math.abs(group.taxCents) > Math.abs(largest.taxCents) ? group : largest)).taxCents += difference;
  }
  const withheldGroups = [...withheld.entries()].map(([rate, baseCents]) => ({ rate, baseCents, taxCents: amountToCents((baseCents * rate) / 10000) }));
  const withheldDifference = totals.retentionCents - withheldGroups.reduce((sum, group) => sum + group.taxCents, 0);
  if (withheldDifference !== 0 && withheldGroups.length > 0) withheldGroups[0].taxCents += withheldDifference;
  if (totals.retentionCents !== 0) {
    warnings.push("La factura lleva retención: el núcleo EN 16931:2017 no la contempla. Va en «WithholdingTaxTotal» y restada del importe a pagar; un validador estricto de 2017 puede señalar la regla BR-CO-16.");
  }
  if (groups.some((group) => group.category.id === "O")) warnings.push("Operación no sujeta (categoría «O»): EN 16931 pide que la factura no lleve identificadores de IVA de las partes; revisa el fichero con tu cliente.");

  const supplier = partyNode(data.issuer, "de tu empresa", problems);
  const customer = partyNode(data.customer, "del cliente", problems);

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

  const root = el("Invoice", [
    txt("cbc:CustomizationID", UBL_CUSTOMIZATION_ID),
    txt("cbc:ID", data.number),
    txt("cbc:IssueDate", data.issueDate),
    !data.isCreditNote && payableCents > 0 ? txt("cbc:DueDate", dueDate) : null,
    // UNTDID 1001: 380 factura; 384 factura rectificativa.
    txt("cbc:InvoiceTypeCode", data.isCreditNote ? "384" : "380"),
    txt("cbc:Note", clip(notes, 2000)),
    txt("cbc:DocumentCurrencyCode", currency),
    billingReference,
    data.verifactuUrl
      ? el("cac:AdditionalDocumentReference", [
          txt("cbc:ID", "QR"),
          txt("cbc:DocumentDescription", "VERIFACTU"),
          el("cac:Attachment", [el("cac:ExternalReference", [txt("cbc:URI", data.verifactuUrl)])]),
        ])
      : null,
    el("cac:AccountingSupplierParty", [supplier]),
    el("cac:AccountingCustomerParty", [customer]),
    operationDate ? el("cac:Delivery", [txt("cbc:ActualDeliveryDate", operationDate)]) : null,
    paymentCode && !data.isCreditNote
      ? el("cac:PaymentMeans", [
          txt("cbc:PaymentMeansCode", paymentCode),
          paymentCode === "30" && iban ? el("cac:PayeeFinancialAccount", [txt("cbc:ID", iban)]) : null,
        ])
      : null,
    // BR-CO-25: con importe a pagar positivo debe constar el vencimiento o las condiciones de pago.
    !data.isCreditNote && payableCents > 0 && !dueDate ? el("cac:PaymentTerms", [txt("cbc:Note", "Pago al contado")]) : null,
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
            // Como en el anexo I de la Orden HAC/1028/2026 (BG-ES-4): categoría «S» y esquema «WTH».
            el("cac:TaxCategory", [txt("cbc:ID", "S"), txt("cbc:Percent", decimalString(group.rate, 4)), el("cac:TaxScheme", [txt("cbc:ID", "WTH")])]),
          ])),
        ])
      : null,
    el("cac:LegalMonetaryTotal", [
      money("cbc:LineExtensionAmount", totals.subtotalCents),
      money("cbc:TaxExclusiveAmount", totals.subtotalCents),
      money("cbc:TaxInclusiveAmount", totals.subtotalCents + totals.taxCents),
      money("cbc:PayableAmount", payableCents),
    ]),
    ...lineNodes,
  ], { xmlns: NS_INVOICE, "xmlns:cac": NS_CAC, "xmlns:cbc": NS_CBC });

  return { root, warnings };
}

export function buildUblXml(data: EInvoiceData): UblResult {
  const { root, warnings } = buildUblTree(data);
  return { xml: xmlDocument(root), warnings, fileName: `${data.number.replace(/[^a-zA-Z0-9._-]+/g, "-")}-ubl.xml` };
}

export function ublProblems(data: EInvoiceData): string[] {
  try {
    buildUblTree(data);
    return [];
  } catch (error) {
    if (error instanceof EInvoiceError) return error.problems;
    throw error;
  }
}

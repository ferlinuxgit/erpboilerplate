import ExcelJS from "exceljs";

import { EU_COUNTRY_CODES } from "@/lib/fiscal-spain";
import type { ReceivedRegisterRow } from "@/server/accounting/gestor-package-model";
import { hasSpanishNifShape, normalizeSpanishNif, sanitizeText } from "@/server/fiscal-files/fields";

/**
 * Libros registro de IVA e IRPF en el formato electrónico normalizado de la AEAT (XLSX), el que
 * piden los requerimientos y el que importan Pre303, el modelo 130 y Renta Web.
 *
 * Fuentes oficiales (sede de la AEAT › IVA › Libros registro de IVA):
 * - «Formatos de los Libros Registro de IVA e IRPF», especificaciones 2025-2026, V.18.02.2026
 *   (nombre del fichero, pestañas y requisitos de importación):
 *   https://sede.agenciatributaria.gob.es/static_files/Sede/Tema/IVA/Fact_registro/Libros_registro/Formato_Electronico_Comun_Libros_Registro_IVA_IRPF.pdf
 * - Diseños de registro con sus validaciones: https://sede.agenciatributaria.gob.es/static_files/AEAT/LSI.xlsx
 *   (personas físicas) y …/AEAT/LSIJ.xlsx (personas jurídicas).
 * - Plantillas oficiales (sep. 2026), de las que se copia la disposición de las hojas (dos filas de
 *   títulos, una de tipos de dato y los asientos desde la fila 4; importes y fechas como celdas
 *   numéricas y de fecha): …/Sede/Tema/IVA/Fact_registro/Libros/PLANTILLA_LIBROS_UNIFICADOS.xlsx
 *
 * Diferencia entre las dos fuentes: la hoja de bienes de inversión tiene 40 columnas en LSI.xlsx y
 * 42 en la plantilla (añade «Inmueble»). Se sigue la plantilla, que es más reciente y es la que la
 * propia AEAT da para confeccionar el fichero.
 *
 * El libro de «determinadas operaciones intracomunitarias» (art. 66 RIVA: envíos para peritajes o
 * trabajos, transferencias de bienes y ventas en consigna) no tiene diseño en este formato y el
 * programa no registra esas operaciones: no se genera. Las entregas y adquisiciones
 * intracomunitarias ordinarias van en los libros de expedidas y recibidas.
 *
 * Módulo puro: recibe los datos ya leídos y devuelve las filas y el XLSX.
 */

export type LsiCell = string | number | Date | null;

type ColumnType = "text" | "money" | "rate" | "date" | "year";
type Column = { group: string; sub?: string; spec: string; type: ColumnType };

const col = (group: string, sub: string | undefined, spec: string, type: ColumnType): Column => ({ group, sub, spec, type });
const A = (length: number) => `Alfanumérico (${length})`;
const DEC = "Decimal(12,2)";
const DATE = "Fecha(dd/mm/yyyy)";
const COBRO = "Cobro (Operación Criterio de Caja de IVA y/o artículo 7.2.1º de Reglamento del IRPF)";
const PAGO = "Pago (Operación Criterio de Caja de IVA y/o artículo 7.2.1º de Reglamento del IRPF)";

const HEAD: Column[] = [
  col("Autoliquidación", "Ejercicio", "Decimal (4,0)", "year"),
  col("Autoliquidación", "Periodo", A(2), "text"),
  col("Actividad", "Código", A(1), "text"),
  col("Actividad", "Tipo", A(2), "text"),
  col("Actividad", "Grupo o Epígrafe del IAE", A(4), "text"),
];

/** Libro de facturas expedidas / ventas e ingresos: 36 columnas (A a AJ). */
export const LSI_ISSUED_COLUMNS: Column[] = [
  ...HEAD,
  col("Tipo de Factura", undefined, A(2), "text"),
  col("Concepto de\nIngreso", undefined, A(3), "text"),
  col("Ingreso Computable", undefined, DEC, "money"),
  col("Fecha\nExpedición", undefined, DATE, "date"),
  col("Fecha\nOperación", undefined, DATE, "date"),
  col("Identificación de la Factura", "Serie", A(20), "text"),
  col("Identificación de la Factura", "Número", A(20), "text"),
  col("Identificación de la Factura", "Número-Final", A(20), "text"),
  col("NIF Destinatario", "Tipo", A(2), "text"),
  col("NIF Destinatario", "Código País", A(2), "text"),
  col("NIF Destinatario", "Identificación", A(20), "text"),
  col("Nombre\nDestinatario", undefined, A(40), "text"),
  col("Clave de Operación", undefined, A(2), "text"),
  col("Calificación de la Operación", undefined, A(2), "text"),
  col("Operación\nExenta", undefined, A(2), "text"),
  col("Total\nFactura", undefined, DEC, "money"),
  col("Base\nImponible", undefined, DEC, "money"),
  col("Tipo\nde IVA", undefined, "Decimal(4,2)", "rate"),
  col("Cuota IVA\nRepercutida", undefined, DEC, "money"),
  col("Tipo de\nRecargo Eq.", undefined, "Decimal(4,2)", "rate"),
  col("Cuota Recargo Eq.", undefined, DEC, "money"),
  col(COBRO, "Fecha", DATE, "date"),
  col(COBRO, "Importe", DEC, "money"),
  col(COBRO, "Medio Utilizado", A(2), "text"),
  col(COBRO, "Identificación Medio Utilizado", A(34), "text"),
  col("Tipo Retención\ndel IRPF", undefined, "Decimal(4,2)", "rate"),
  col("Importe Retenido\ndel IRPF", undefined, DEC, "money"),
  col("Registro Acuerdo Facturación", undefined, A(15), "text"),
  col("Inmueble", "Situación", A(1), "text"),
  col("Inmueble", "Referencia Catastral", A(20), "text"),
  col("Referencia Externa", undefined, A(40), "text"),
];

/** Libro de facturas recibidas / compras y gastos: 42 columnas (A a AP). */
export const LSI_RECEIVED_COLUMNS: Column[] = [
  ...HEAD,
  col("Tipo de Factura", undefined, A(2), "text"),
  col("Concepto de\nGasto", undefined, A(3), "text"),
  col("Gasto Deducible", undefined, DEC, "money"),
  col("Fecha\nExpedición", undefined, DATE, "date"),
  col("Fecha\nOperación", undefined, DATE, "date"),
  col("Identificación Factura del Expedidor", "(Serie-Número)", A(40), "text"),
  col("Identificación Factura del Expedidor", "Número-Final", A(20), "text"),
  col("Fecha\nRecepción", undefined, DATE, "date"),
  col("Número\nRecepción", undefined, A(20), "text"),
  col("Número\nRecepción Final", undefined, A(20), "text"),
  col("NIF Expedidor", "Tipo", A(2), "text"),
  col("NIF Expedidor", "Código País", A(2), "text"),
  col("NIF Expedidor", "Identificación", A(20), "text"),
  col("Nombre\nExpedidor", undefined, A(40), "text"),
  col("Clave de\nOperación", undefined, A(2), "text"),
  col("Bien de Inversión", undefined, A(1), "text"),
  col("Inversión del Sujeto Pasivo", undefined, A(1), "text"),
  col("Deducible en Periodo Posterior", undefined, A(1), "text"),
  col("Periodo Deducción", "Ejercicio", "Decimal (4,0)", "year"),
  col("Periodo Deducción", "Periodo", A(2), "text"),
  col("Total\nFactura", undefined, DEC, "money"),
  col("Base\nImponible", undefined, DEC, "money"),
  col("Tipo\nde IVA", undefined, "Decimal(4,2)", "rate"),
  col("Cuota IVA\nSoportado", undefined, DEC, "money"),
  col("Cuota Deducible", undefined, DEC, "money"),
  col("Tipo de\nRecargo Eq.", undefined, "Decimal(4,2)", "rate"),
  col("Cuota\nRecargo Eq.", undefined, DEC, "money"),
  col(PAGO, "Fecha", DATE, "date"),
  col(PAGO, "Importe", DEC, "money"),
  col(PAGO, "Medio Utilizado", A(2), "text"),
  col(PAGO, "Identificación Medio Utilizado", A(34), "text"),
  col("Tipo Retención\ndel IRPF", undefined, "Decimal(4,2)", "rate"),
  col("Importe Retenido\ndel IRPF", undefined, DEC, "money"),
  col("Registro Acuerdo Facturación", undefined, A(15), "text"),
  col("Inmueble", "Situación", A(1), "text"),
  col("Inmueble", "Referencia Catastral", A(20), "text"),
  col("Referencia Externa", undefined, A(40), "text"),
];

/** Libro de bienes de inversión: 42 columnas (A a AP), según la plantilla oficial. */
export const LSI_ASSET_COLUMNS: Column[] = [
  ...HEAD,
  col("Tipo de Bien", undefined, A(2), "text"),
  col("Descripción del Bien", "Identificador", A(40), "text"),
  col("Descripción del Bien", "Literal", A(160), "text"),
  col("Fecha Inicio\nUtilización", undefined, DATE, "date"),
  col("Valor Adquisición", undefined, DEC, "money"),
  col("Valor\nAmortizable", undefined, DEC, "money"),
  col("Método de\nAmortización", undefined, A(2), "text"),
  col("Porcentaje de\nAmortización", undefined, "Decimal (4,2)", "rate"),
  col("Amortización", "Acumulada al Inicio", DEC, "money"),
  col("Amortización", "Cuota Resultante", DEC, "money"),
  col("Amortización", "Acumulada al final", DEC, "money"),
  col("Amortización", "Pendiente", DEC, "money"),
  col("Fecha\nExpedición", undefined, DATE, "date"),
  col("Identificación Factura del Expedidor", "(Serie-Número)", A(40), "text"),
  col("Identificación Factura del Expedidor", "Número-Final", A(20), "text"),
  col("Número\nRecepción", undefined, A(20), "text"),
  col("Número\nRecepción Final", undefined, A(20), "text"),
  col("NIF Expedidor", "Tipo", A(2), "text"),
  col("NIF Expedidor", "Código País", A(2), "text"),
  col("NIF Expedidor", "Identificación", A(20), "text"),
  col("Nombre\nExpedidor", undefined, A(40), "text"),
  col("Año de Inicio Utilización", "Base Imponible", DEC, "money"),
  col("Año de Inicio Utilización", "Tipo de IVA", "Decimal(4,2)", "rate"),
  col("Año de Inicio Utilización", "Prorrata Definitiva", "Decimal(5,2)", "rate"),
  col("Año de Inicio Utilización", "Cuota Deducible", DEC, "money"),
  col("Regularización Anual", "Prorrata Definitiva", "Decimal(5,2)", "rate"),
  col("Regularización Anual", "Cuota Deducible", DEC, "money"),
  col("Regularización Anual", "Cuota a Regularizar", DEC, "money"),
  col("Baja del Bien", "Fecha", DATE, "date"),
  col("Baja del Bien", "Causa", A(2), "text"),
  col("Identificación de la Factura de Transmisión del Bien", "Serie", A(20), "text"),
  col("Identificación de la Factura de Transmisión del Bien", "Número", A(20), "text"),
  col("Identificación de la Factura de Transmisión del Bien", "Número-Final", A(20), "text"),
  col("Registro Acuerdo Facturación", undefined, A(15), "text"),
  col("Inmueble", "Situación", A(1), "text"),
  col("Inmueble", "Referencia Catastral", A(20), "text"),
  col("Referencia Externa", undefined, A(40), "text"),
];

/** Actividad a la que corresponden los asientos (validación 16 del diseño); opcional. */
export type LsiActivity = { code?: string | null; type?: string | null; iaeGroup?: string | null };

export type LsiOptions = {
  /** Persona física: libros unificados de IVA e IRPF (tipo T). Si no, solo los de IVA (tipo C). */
  isIndividual: boolean;
  activity?: LsiActivity;
  /** Fecha civil (año, mes, día) de un instante en la zona horaria fiscal de la empresa. */
  civilDate: (instant: Date) => { year: number; month: number; day: number };
};

const text = (value: string | null | undefined, length: number) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, length) || null;
const money = (cents: number) => Math.round(cents) / 100;
const round2 = (value: number) => Math.round(value * 100) / 100;

function dateCell(instant: Date | null | undefined, options: LsiOptions) {
  if (!instant || Number.isNaN(instant.getTime())) return null;
  const { year, month, day } = options.civilDate(instant);
  return new Date(Date.UTC(year, month - 1, day));
}

function periodOf(instant: Date, options: LsiOptions) {
  const { year, month } = options.civilDate(instant);
  return { year, period: `${Math.floor((month - 1) / 3) + 1}T` };
}

function activityCells(options: LsiOptions): LsiCell[] {
  const activity = options.activity ?? {};
  return [text(activity.code?.toUpperCase(), 1), text(activity.type, 2), text(activity.iaeGroup, 4)];
}

/**
 * Identificación de la contraparte (validación 2): un NIF español va solo en «Identificación»; un
 * extranjero lleva el tipo (02 NIF-IVA de la UE, 04 documento oficial del país de residencia), el
 * país y su número.
 */
export function counterpartyId(taxId: string | null | undefined, countryCode: string | null | undefined): { type: string | null; country: string | null; id: string | null } {
  const cleaned = (taxId ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return { type: null, country: null, id: null };
  const country = (countryCode ?? "ES").trim().toUpperCase() || "ES";
  const spanish = normalizeSpanishNif(cleaned);
  if (country === "ES" || (hasSpanishNifShape(spanish) && cleaned.startsWith("ES"))) return { type: null, country: null, id: spanish.slice(0, 20) };
  if (EU_COUNTRY_CODES.has(country)) {
    const prefix = country === "GR" ? "EL" : country;
    return { type: "02", country, id: (cleaned.startsWith(prefix) ? cleaned : `${prefix}${cleaned}`).slice(0, 20) };
  }
  return { type: "04", country, id: cleaned.slice(0, 20) };
}

/** Serie y número: el número completo va en «Número»; si pasa de 20 caracteres, el principio pasa a «Serie». */
export function splitInvoiceNumber(number: string): { series: string | null; number: string } {
  const value = number.trim();
  if (value.length <= 20) return { series: null, number: value };
  return { series: value.slice(0, value.length - 20).slice(-20), number: value.slice(-20) };
}

// ---------------------------------------------------------------------------------------------
// Facturas expedidas
// ---------------------------------------------------------------------------------------------

/** Línea de factura emitida ya reducida a su base y sus impuestos (en céntimos). */
export type LsiIssuedLine = {
  invoiceId: string;
  number: string;
  issueDate: Date;
  operationDate: Date | null;
  /** Fecha de devengo (la misma que decide el periodo del 303). */
  accrualDate: Date;
  invoiceType: string;
  rectificationReason: string | null;
  /** DOMESTIC, INTRA_EU, INTRA_EU_SERVICES, EXPORT, EXEMPT, REVERSE_CHARGE o NOT_SUBJECT. */
  treatment: string;
  /** Causa de exención (E1-E6) o de no sujeción (N1, N2) indicada en la factura. */
  exemptionCode: string | null;
  customerName: string;
  customerTaxId: string | null;
  customerCountry: string | null;
  baseCents: number;
  vatRate: number;
  vatCents: number;
  /** null si la línea no lleva recargo de equivalencia. */
  surchargeRate: number | null;
  surchargeCents: number;
  withholdingRate: number;
  withholdingCents: number;
};

const EXEMPTIONS = ["E1", "E2", "E3", "E4", "E5", "E6"];
const NOT_SUBJECT = ["N1", "N2"];

/**
 * Calificación de una línea sin cuota, con el mismo criterio que el registro VERI*FACTU
 * (`exemptLine` en verifactu/mapping.ts): intracomunitaria E5, exportación E2 con clave 02,
 * inversión del sujeto pasivo S2, no sujeta N2 y, en otro caso, exenta E1.
 */
function classifyIssued(line: LsiIssuedLine): { key: string; qualification: string | null; exemption: string | null } {
  if (line.vatCents !== 0 || (line.vatRate > 0 && line.treatment === "DOMESTIC")) return { key: "01", qualification: "S1", exemption: null };
  const code = line.exemptionCode;
  switch (line.treatment) {
    case "INTRA_EU":
    case "INTRA_EU_SERVICES":
      // Servicios a empresas de la UE: no sujetos por reglas de localización, salvo que la factura indique otra causa.
      if (line.treatment === "INTRA_EU_SERVICES") return { key: "01", qualification: code && NOT_SUBJECT.includes(code) ? code : "N2", exemption: null };
      return { key: "01", qualification: null, exemption: code && EXEMPTIONS.includes(code) ? code : "E5" };
    case "EXPORT":
      return { key: "02", qualification: null, exemption: code && EXEMPTIONS.includes(code) ? code : "E2" };
    case "REVERSE_CHARGE":
      return { key: "01", qualification: "S2", exemption: null };
    case "NOT_SUBJECT":
      return { key: "01", qualification: code && NOT_SUBJECT.includes(code) ? code : "N2", exemption: null };
    default:
      if (code && NOT_SUBJECT.includes(code)) return { key: "01", qualification: code, exemption: null };
      return { key: "01", qualification: null, exemption: code && EXEMPTIONS.includes(code) ? code : "E1" };
  }
}

/**
 * Filas del libro de facturas expedidas: una por factura, tipo de IVA, tipo de recargo y
 * calificación (validación 7). «Total Factura» e «Ingreso Computable» llevan el subtotal de la
 * fila; la retención del IRPF se anota una sola vez, en la primera fila de la factura.
 */
export function buildLsiIssuedRows(lines: readonly LsiIssuedLine[], options: LsiOptions): LsiCell[][] {
  type Group = { first: LsiIssuedLine; klass: ReturnType<typeof classifyIssued>; vatRate: number; surchargeRate: number | null; base: number; vat: number; surcharge: number };
  const groups = new Map<string, Group>();
  const withholding = new Map<string, { cents: number; rates: Set<number> }>();
  for (const line of lines) {
    const klass = classifyIssued(line);
    const taxed = klass.qualification === "S1";
    const vatRate = taxed ? round2(line.vatRate) : 0;
    const surchargeRate = taxed && line.surchargeRate !== null ? round2(line.surchargeRate) : null;
    const key = [line.invoiceId, klass.key, klass.qualification, klass.exemption, vatRate, surchargeRate].join("|");
    const group = groups.get(key) ?? { first: line, klass, vatRate, surchargeRate, base: 0, vat: 0, surcharge: 0 };
    group.base += line.baseCents;
    group.vat += taxed ? line.vatCents : 0;
    group.surcharge += taxed ? line.surchargeCents : 0;
    groups.set(key, group);
    if (line.withholdingCents !== 0) {
      const entry = withholding.get(line.invoiceId) ?? { cents: 0, rates: new Set<number>() };
      entry.cents += line.withholdingCents;
      entry.rates.add(round2(line.withholdingRate));
      withholding.set(line.invoiceId, entry);
    }
  }

  const sorted = [...groups.values()].sort((left, right) =>
    left.first.issueDate.getTime() - right.first.issueDate.getTime()
    || left.first.number.localeCompare(right.first.number)
    || right.vatRate - left.vatRate);
  const seen = new Set<string>();
  return sorted.map((group) => {
    const invoice = group.first;
    const isFirstRow = !seen.has(invoice.invoiceId);
    seen.add(invoice.invoiceId);
    const id = counterpartyId(invoice.customerTaxId, invoice.customerCountry);
    const identified = id.id !== null;
    const rectification = invoice.invoiceType === "CREDIT_NOTE";
    const reason = ["R1", "R2", "R3", "R4"].includes(invoice.rectificationReason ?? "") ? invoice.rectificationReason : "R4";
    // F1/F2 según se identifique al destinatario; R5 = rectificativa de factura sin destinatario identificado.
    const invoiceType = rectification ? (identified ? reason : "R5") : identified ? "F1" : "F2";
    const period = periodOf(invoice.accrualDate, options);
    const { series, number } = splitInvoiceNumber(invoice.number);
    const taxed = group.klass.qualification === "S1";
    const reverse = group.klass.qualification === "S2";
    const total = group.base + group.vat + group.surcharge;
    const retained = isFirstRow && options.isIndividual ? withholding.get(invoice.invoiceId) : undefined;
    const operation = invoice.operationDate && dateCell(invoice.operationDate, options)?.getTime() !== dateCell(invoice.issueDate, options)?.getTime() ? dateCell(invoice.operationDate, options) : null;
    return [
      period.year, period.period, ...activityCells(options),
      invoiceType,
      options.isIndividual ? "I01" : null,
      options.isIndividual ? money(group.base) : null,
      dateCell(invoice.issueDate, options),
      operation,
      series, number, null,
      id.type, id.country, id.id,
      identified ? text(invoice.customerName, 40) : "VENTAS A CONSUMIDOR FINAL",
      group.klass.key, group.klass.qualification, group.klass.exemption,
      money(total), money(group.base),
      taxed || reverse ? group.vatRate : null,
      taxed || reverse ? money(group.vat) : null,
      group.surchargeRate, group.surchargeRate === null ? null : money(group.surcharge),
      null, null, null, null,
      retained ? (retained.rates.size === 1 ? [...retained.rates][0] : null) : null,
      retained ? money(retained.cents) : null,
      null, null, null, null,
    ];
  });
}

// ---------------------------------------------------------------------------------------------
// Facturas recibidas
// ---------------------------------------------------------------------------------------------

/** Datos de la factura recibida que no lleva la fila del libro del gestor. */
export type LsiReceivedExtra = {
  supplierCountry: string | null;
  isSimplified: boolean;
  rectificationReason: string | null;
  importDuaNumber: string | null;
  importDuaDate: Date | null;
  /** Concepto de gasto del IRPF (G01…) según la cuenta de gasto de las líneas. */
  expenseConcept: string | null;
  /** Tipo de retención de las líneas (0 si no llevan). */
  retentionRate: number;
  investmentGood: boolean;
};

export type LsiReceivedEntry = { row: ReceivedRegisterRow; extra: LsiReceivedExtra };

/**
 * Concepto de gasto del IRPF (validación 11 del diseño) a partir de la cuenta del PGC de la línea.
 * Es una correspondencia orientativa del programa, no una tabla oficial: revísala con tu asesor.
 */
export function expenseConceptForAccount(accountCode: string | null | undefined): string {
  const code = accountCode ?? "";
  const starts = (...prefixes: string[]) => prefixes.some((prefix) => code.startsWith(prefix));
  if (starts("600", "601", "602", "606", "608", "609")) return "G01";
  if (starts("607")) return "G03";
  if (starts("621")) return "G12";
  if (starts("622")) return "G13";
  if (starts("623")) return "G19";
  if (starts("625")) return "G20";
  if (starts("628")) return "GY4";
  if (starts("631", "634", "636", "639")) return "G26";
  if (starts("640")) return "G04";
  if (starts("642")) return "G05";
  if (starts("641")) return "G07";
  if (starts("649", "643")) return "G10";
  if (starts("662", "663", "664", "665")) return "G23";
  if (starts("66")) return "G24";
  if (starts("62")) return "G22";
  if (starts("2")) return "";
  return "G37";
}

/**
 * Filas del libro de facturas recibidas a partir de las del libro del gestor (una por factura y
 * tipo, con los mismos importes que el 303). La fila de anulación de una factura conserva sus
 * importes negativos y su fecha de recepción es la de la anulación.
 */
export function buildLsiReceivedRows(entries: readonly LsiReceivedEntry[], options: LsiOptions): LsiCell[][] {
  return entries.map(({ row, extra }) => {
    const period = periodOf(row.registrationDate, options);
    const id = counterpartyId(row.supplierTaxId, extra.supplierCountry);
    const isImport = row.vatTreatment === "IMPORT";
    const withDua = isImport && Boolean(extra.importDuaNumber);
    const rectification = row.documentKind === "RECTIFICATION";
    const reason = ["R1", "R2", "R3", "R4"].includes(extra.rectificationReason ?? "") ? extra.rectificationReason : "R4";
    // F5 = importación con DUA; R5/F2 = documento simplificado; R1-R4 = rectificativa.
    const invoiceType = withDua ? "F5" : rectification ? (extra.isSimplified ? "R5" : reason) : extra.isSimplified ? "F2" : "F1";
    // 09 = adquisición intracomunitaria; 13 = importación informada sin DUA; 01 = régimen general.
    const operationKey = row.vatTreatment === "INTRA_EU" ? "09" : isImport && !withDua ? "13" : "01";
    const reverseCharge = row.vatTreatment === "REVERSE_CHARGE";
    const soportado = row.chargedTax + row.selfAssessedTax;
    const issue = withDua && extra.importDuaDate ? extra.importDuaDate : row.issueDate;
    const operation = row.operationDate && dateCell(row.operationDate, options)?.getTime() !== dateCell(issue, options)?.getTime() ? dateCell(row.operationDate, options) : null;
    const hasSurcharge = row.surchargeRate > 0 || row.surchargeAmount !== 0;
    const individual = options.isIndividual;
    const concept = individual ? extra.expenseConcept || null : null;
    return [
      period.year, period.period, ...activityCells(options),
      invoiceType,
      concept,
      concept ? round2(row.base) : null,
      dateCell(issue, options),
      operation,
      text(withDua ? extra.importDuaNumber : row.supplierNumber ?? row.number.replace(/ \(anulación\)$/, ""), 40),
      null,
      dateCell(row.registrationDate, options),
      text(row.number.replace(/ \(anulación\)$/, ""), 20),
      null,
      id.type, id.country, id.id,
      text(row.supplierName, 40),
      operationKey,
      extra.investmentGood ? "S" : "N",
      reverseCharge ? "S" : "N",
      "N",
      null, null,
      round2(row.base + row.chargedTax + row.surchargeAmount),
      round2(row.base),
      round2(row.taxRate),
      round2(soportado),
      round2(row.deductibleTax),
      hasSurcharge ? round2(row.surchargeRate) : null,
      hasSurcharge ? round2(row.surchargeAmount) : null,
      null, null, null, null,
      individual && row.withholding !== 0 ? round2(extra.retentionRate) : null,
      individual && row.withholding !== 0 ? round2(row.withholding) : null,
      null, null, null, null,
    ];
  });
}

// ---------------------------------------------------------------------------------------------
// Bienes de inversión
// ---------------------------------------------------------------------------------------------

export type LsiAsset = {
  /** Código del bien en el programa (BI-0001) o, sin ficha, el número de la factura. */
  identifier: string;
  description: string;
  /** Cuenta de inmovilizado del PGC (211, 217…), de la que sale el tipo de bien. */
  assetAccountCode: string | null;
  /** Fecha de inicio de utilización (AAAA-MM-DD). */
  inServiceDate: string;
  acquisitionCostCents: number;
  amortizableCents: number;
  /** Porcentaje anual de amortización; null si el bien no se amortiza. */
  annualPct: number | null;
  accumulatedAtStartCents: number;
  yearDepreciationCents: number;
  /** Factura de adquisición enlazada, si la hay. */
  invoice?: {
    issueDate: Date;
    supplierNumber: string | null;
    number: string;
    supplierName: string;
    supplierTaxId: string | null;
    supplierCountry: string | null;
    baseCents: number;
    /** Tipo de IVA; null si la factura mezcla varios. */
    vatRate: number | null;
    prorrataPct: number;
    deductibleCents: number;
  } | null;
  disposalDate?: string | null;
  /** sale (venta) o retirement (baja sin contraprestación). */
  disposalType?: string | null;
};

/**
 * Tipo de bien (validación 2 del diseño) según la cuenta del PGC. Correspondencia orientativa del
 * programa. Los terrenos (210, 220) no tienen código propio en la lista de la AEAT (el 11 es solo
 * para escombreras): quedan, como el resto de cuentas sin equivalencia, en 29 «otro inmovilizado
 * material».
 */
export function assetTypeForAccount(accountCode: string | null | undefined): string {
  const code = accountCode ?? "";
  const map: Array<[string, string]> = [
    ["203", "31"], ["205", "32"], ["206", "33"], ["20", "39"],
    ["211", "12"], ["221", "12"], ["212", "25"], ["215", "25"], ["213", "21"], ["214", "28"],
    ["216", "24"], ["217", "23"], ["218", "22"],
  ];
  return map.find(([prefix]) => code.startsWith(prefix))?.[1] ?? "29";
}

const isoDate = (value: string | null | undefined) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
};

/**
 * Filas del libro de bienes de inversión del ejercicio: una por bien. Las columnas de amortización
 * son del libro del IRPF y solo se rellenan para personas físicas (validación 11). La
 * regularización anual (art. 107 LIVA) no la calcula el programa: sus columnas quedan vacías.
 */
export function buildLsiAssetRows(assets: readonly LsiAsset[], year: number, options: LsiOptions): LsiCell[][] {
  return assets.map((asset) => {
    const individual = options.isIndividual;
    const invoice = asset.invoice ?? null;
    const id = counterpartyId(invoice?.supplierTaxId, invoice?.supplierCountry);
    const accumulatedEnd = asset.accumulatedAtStartCents + asset.yearDepreciationCents;
    const amortized = individual && asset.annualPct !== null;
    return [
      year, "4T", ...activityCells(options),
      assetTypeForAccount(asset.assetAccountCode),
      text(asset.identifier, 40), text(asset.description, 160),
      isoDate(asset.inServiceDate),
      individual ? money(asset.acquisitionCostCents) : null,
      individual ? money(asset.amortizableCents) : null,
      // 01 = amortización lineal según tablas (la única que aplica el programa).
      amortized ? "01" : null,
      amortized ? round2(asset.annualPct as number) : null,
      amortized ? money(asset.accumulatedAtStartCents) : null,
      amortized ? money(asset.yearDepreciationCents) : null,
      amortized ? money(accumulatedEnd) : null,
      amortized ? money(Math.max(asset.amortizableCents - accumulatedEnd, 0)) : null,
      invoice ? dateCell(invoice.issueDate, options) : null,
      invoice ? text(invoice.supplierNumber ?? invoice.number, 40) : null, null,
      invoice ? text(invoice.number, 20) : null, null,
      id.type, id.country, id.id,
      invoice ? text(invoice.supplierName, 40) : null,
      invoice ? money(invoice.baseCents) : null,
      invoice?.vatRate ?? null,
      invoice ? round2(invoice.prorrataPct) : null,
      invoice ? money(invoice.deductibleCents) : null,
      null, null, null,
      isoDate(asset.disposalDate),
      // 02 = venta o transmisión; 99 = otras causas (baja sin contraprestación).
      asset.disposalDate ? (asset.disposalType === "sale" ? "02" : "99") : null,
      null, null, null,
      null, null, null, null,
    ];
  });
}

// ---------------------------------------------------------------------------------------------
// Libro XLSX
// ---------------------------------------------------------------------------------------------

export type LsiBooks = {
  year: number;
  taxId: string | null;
  name: string;
  isIndividual: boolean;
  issued: LsiCell[][];
  received: LsiCell[][];
  assets: LsiCell[][];
};

/** Tipo de fichero: T = libros unificados de IVA e IRPF; C = todos los libros del IVA. */
export function lsiFileType(isIndividual: boolean) {
  return isIndividual ? "T" : "C";
}

/** Nombres de las pestañas según el tipo de fichero (apartado 2 de las especificaciones). */
export function lsiSheetNames(isIndividual: boolean) {
  return isIndividual
    ? { issued: "EXPEDIDAS_INGRESOS", received: "RECIBIDAS_GASTOS", assets: "BIENES-INVERSIÓN" }
    : { issued: "EXPEDIDAS", received: "RECIBIDAS", assets: "BIENES-INVERSIÓN" };
}

/** Nombre del fichero: ejercicio + NIF + tipo de libro + nombre o razón social (apartado 2). */
export function lsiFileName(books: Pick<LsiBooks, "year" | "taxId" | "name" | "isIndividual">) {
  return `${books.year}${normalizeSpanishNif(books.taxId)}${lsiFileType(books.isIndividual)}${sanitizeText(books.name)}.xlsx`;
}

const columnLetter = (index: number) => {
  let letter = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) letter = String.fromCharCode(65 + ((value - 1) % 26)) + letter;
  return letter;
};

const NUM_FORMATS: Record<ColumnType, string> = { text: "@", money: "0.00", rate: "0.00", date: "dd/mm/yyyy", year: "0" };

function addSheet(workbook: ExcelJS.Workbook, name: string, columns: Column[], rows: LsiCell[][]) {
  const sheet = workbook.addWorksheet(name);
  // Fila 1: grupo; fila 2: subcolumna; fila 3: tipo de dato. Igual que la plantilla oficial.
  sheet.addRow(columns.map((column, index) => (index > 0 && columns[index - 1].group === column.group && column.sub ? null : column.group)));
  sheet.addRow(columns.map((column) => column.sub ?? null));
  sheet.addRow(columns.map((column) => column.spec));
  let start = 0;
  while (start < columns.length) {
    let end = start;
    while (end + 1 < columns.length && columns[end + 1].group === columns[start].group && columns[start].sub) end += 1;
    if (end > start) sheet.mergeCells(`${columnLetter(start + 1)}1:${columnLetter(end + 1)}1`);
    else if (!columns[start].sub) sheet.mergeCells(`${columnLetter(start + 1)}1:${columnLetter(start + 1)}2`);
    start = end + 1;
  }
  for (const rowNumber of [1, 2, 3]) {
    const row = sheet.getRow(rowNumber);
    row.font = { bold: rowNumber < 3 };
    row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }
  for (const values of rows) {
    if (values.length !== columns.length) throw new Error(`La hoja ${name} espera ${columns.length} columnas y la fila tiene ${values.length}.`);
    sheet.addRow(values);
  }
  columns.forEach((column, index) => {
    const sheetColumn = sheet.getColumn(index + 1);
    sheetColumn.width = column.type === "text" ? 16 : 13;
    for (let rowNumber = 4; rowNumber <= rows.length + 3; rowNumber += 1) sheet.getCell(rowNumber, index + 1).numFmt = NUM_FORMATS[column.type];
  });
  sheet.views = [{ state: "frozen", ySplit: 3 }];
}

/** XLSX con los tres libros, cada uno en su pestaña. */
export async function buildLsiWorkbook(books: LsiBooks): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const names = lsiSheetNames(books.isIndividual);
  addSheet(workbook, names.issued, LSI_ISSUED_COLUMNS, books.issued);
  addSheet(workbook, names.received, LSI_RECEIVED_COLUMNS, books.received);
  addSheet(workbook, names.assets, LSI_ASSET_COLUMNS, books.assets);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/**
 * MEMORIA ABREVIADA / DE PYMES (funciones puras).
 *
 * Apartados del «Contenido de la memoria abreviada» (PGC, RD 1514/2007, tercera parte) y del
 * «Contenido de la memoria de PYMES» (RD 1515/2007), en su redacción vigente tras el RD 602/2016:
 * diez notas, de «1. Actividad de la empresa» a «10. Otra información». Se añaden, señalados como
 * tales, dos apartados que exigen otras normas: la propuesta de aplicación del resultado (art. 253
 * de la Ley de Sociedades de Capital) y la información sobre el periodo medio de pago a proveedores
 * (disposición adicional tercera de la Ley 15/2010 y Resolución del ICAC de 29 de enero de 2016).
 *
 * Los cuadros numéricos salen de la contabilidad; el texto lo redacta la empresa. Cada apartado
 * trae un texto de partida que hay que revisar: la memoria la formulan y firman los administradores.
 */

import type { StatementAccountRow } from "@/server/accounting/statements-model";

export type NoteSection = {
  id: string;
  title: string;
  /** Qué pide la norma en este apartado (ayuda para quien lo redacta). */
  guidance: string;
  /** Apartado que no está en el modelo del plan pero exige otra norma. */
  extraLegalBasis?: string;
};

export const NOTE_SECTIONS: NoteSection[] = [
  { id: "1", title: "1. Actividad de la empresa", guidance: "Objeto social, actividad o actividades a las que se dedica y domicilio. Si pertenece a un grupo, nombre y domicilio de la sociedad dominante." },
  { id: "2", title: "2. Bases de presentación de las cuentas anuales", guidance: "Imagen fiel, principios contables no obligatorios aplicados, aspectos críticos de la valoración e incertidumbres, comparación con el ejercicio anterior, elementos recogidos en varias partidas, cambios de criterio y corrección de errores." },
  { id: "aplicacion", title: "Aplicación del resultado", guidance: "Propuesta de aplicación del resultado del ejercicio: base de reparto (saldo de la cuenta de pérdidas y ganancias, remanente, reservas) y aplicación (reserva legal, otras reservas, dividendos, compensación de pérdidas).", extraLegalBasis: "art. 253 de la Ley de Sociedades de Capital" },
  { id: "3", title: "3. Normas de registro y valoración", guidance: "Criterios contables aplicados: inmovilizado intangible y material, inversiones inmobiliarias, permutas, activos y pasivos financieros, existencias, moneda extranjera, impuesto sobre beneficios, ingresos y gastos, provisiones, subvenciones, negocios conjuntos y operaciones entre partes vinculadas." },
  { id: "4", title: "4. Inmovilizado material, intangible e inversiones inmobiliarias", guidance: "Movimiento del ejercicio de cada epígrafe y de sus amortizaciones y deterioros: saldo inicial, entradas, salidas y saldo final. Arrendamientos financieros sobre activos no corrientes." },
  { id: "5", title: "5. Activos financieros", guidance: "Movimiento de los activos financieros no corrientes y de sus correcciones por riesgo de crédito; activos valorados a valor razonable; participaciones en empresas del grupo, multigrupo y asociadas." },
  { id: "6", title: "6. Pasivos financieros", guidance: "Vencimiento de las deudas en cada uno de los cinco años siguientes y resto; deudas con garantía real; impagos de préstamos durante el ejercicio." },
  { id: "7", title: "7. Fondos propios", guidance: "Capital autorizado, acciones o participaciones propias (número, valor nominal y precio medio de adquisición) y movimiento de las partidas de fondos propios." },
  { id: "8", title: "8. Situación fiscal", guidance: "Gasto por impuesto sobre beneficios corriente y cualquier otra información que exija la norma tributaria (diferencias entre el resultado contable y la base imponible, bases negativas pendientes, incentivos fiscales)." },
  { id: "9", title: "9. Operaciones con partes vinculadas", guidance: "Operaciones con la dominante, empresas del grupo, administradores y personal de alta dirección: naturaleza, importe y saldos pendientes. Anticipos y créditos concedidos a los administradores." },
  { id: "10", title: "10. Otra información", guidance: "Número medio de personas empleadas, acuerdos fuera de balance, ingresos o gastos excepcionales, subvenciones recibidas, compromisos y garantías, y hechos posteriores al cierre." },
  { id: "pmp", title: "Información sobre el periodo medio de pago a proveedores", guidance: "Periodo medio de pago a proveedores del ejercicio y del anterior. Desde la Ley 18/2022, también el volumen y el número de facturas pagadas dentro del plazo máximo legal y su porcentaje sobre el total.", extraLegalBasis: "disposición adicional tercera de la Ley 15/2010 y Resolución del ICAC de 29 de enero de 2016" },
];

export type NotesContext = {
  companyName: string;
  taxId: string | null;
  address: string | null;
  yearLabel: string;
  modelName: string;
  planName: string;
  resultAmount: number;
};

const euro = (value: number) => `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" }).format(value)} €`;

/** Texto de partida de cada apartado. Lo que va entre corchetes debe completarlo la empresa. */
export function defaultNoteText(sectionId: string, ctx: NotesContext): string {
  switch (sectionId) {
    case "1":
      return `${ctx.companyName}${ctx.taxId ? `, con NIF ${ctx.taxId}` : ""}${ctx.address ? ` y domicilio en ${ctx.address}` : ""}, tiene por objeto social [describe la actividad]. Su actividad principal durante el ejercicio ${ctx.yearLabel} ha sido [actividad].\n\nLa sociedad no forma parte de un grupo de sociedades en los términos del artículo 42 del Código de Comercio. [Si forma parte, indica la dominante y su domicilio.]`;
    case "2":
      return `Imagen fiel. Las cuentas anuales del ejercicio ${ctx.yearLabel} se han preparado a partir de los registros contables de la sociedad y se presentan de acuerdo con el ${ctx.planName} (${ctx.modelName.toLowerCase()}), de forma que muestran la imagen fiel del patrimonio, de la situación financiera y de los resultados. No ha sido necesario dejar de aplicar ninguna disposición legal en materia contable.\n\nPrincipios contables no obligatorios aplicados. No se han aplicado principios contables no obligatorios.\n\nAspectos críticos de la valoración y estimación de la incertidumbre. No existen incertidumbres significativas que puedan suponer cambios importantes en el valor de los activos o pasivos en el ejercicio siguiente. Las cuentas se han formulado bajo el principio de empresa en funcionamiento.\n\nComparación de la información. Las cifras del ejercicio se presentan junto con las del ejercicio anterior y son comparables.\n\nElementos recogidos en varias partidas. No hay elementos patrimoniales registrados en dos o más partidas del balance.\n\nCambios en criterios contables y corrección de errores. No se han producido en el ejercicio.`;
    case "aplicacion":
      return ctx.resultAmount >= 0
        ? `El órgano de administración propone a la junta general la siguiente aplicación del resultado del ejercicio ${ctx.yearLabel}:\n\nBase de reparto: saldo de la cuenta de pérdidas y ganancias, ${euro(ctx.resultAmount)}.\nAplicación: a reserva legal, [importe]; a reservas voluntarias, [importe]; a dividendos, [importe]; a compensar pérdidas de ejercicios anteriores, [importe].`
        : `El resultado del ejercicio ${ctx.yearLabel} ha sido una pérdida de ${euro(Math.abs(ctx.resultAmount))}. El órgano de administración propone a la junta general llevarla a «Resultados negativos de ejercicios anteriores» para su compensación con beneficios futuros.`;
    case "3":
      return "Inmovilizado intangible. Se valora por su precio de adquisición o coste de producción, menos la amortización acumulada y las pérdidas por deterioro. Se amortiza linealmente durante su vida útil.\n\nInmovilizado material. Se valora por su precio de adquisición o coste de producción, menos la amortización acumulada y las pérdidas por deterioro. La amortización se calcula linealmente según la vida útil estimada de cada elemento. Los gastos de conservación y mantenimiento se cargan a la cuenta de pérdidas y ganancias.\n\nInversiones inmobiliarias. [Indica el criterio o que no existen.]\n\nActivos financieros y pasivos financieros. Los créditos y débitos por operaciones comerciales con vencimiento no superior a un año se valoran por su valor nominal. Al cierre se efectúan las correcciones valorativas necesarias cuando existe evidencia objetiva de deterioro. El resto de activos y pasivos financieros se valoran a coste amortizado.\n\nExistencias. Se valoran por su precio de adquisición o coste de producción; cuando el valor neto realizable es inferior, se registra la corrección valorativa. [Indica el método de asignación de valor: precio medio ponderado o FIFO.]\n\nTransacciones en moneda extranjera. Se convierten al tipo de cambio de la fecha de la operación; las diferencias de cambio se imputan a la cuenta de pérdidas y ganancias.\n\nImpuestos sobre beneficios. El gasto por impuesto corriente es la cantidad que resulta de las liquidaciones fiscales del ejercicio. Los activos y pasivos por impuesto diferido se reconocen por las diferencias temporarias.\n\nIngresos y gastos. Se imputan según el criterio de devengo. Los ingresos por ventas y prestaciones de servicios se valoran por el valor razonable de la contrapartida, deducidos descuentos e impuestos.\n\nProvisiones y contingencias. Se reconocen cuando existe una obligación presente, es probable una salida de recursos y su importe se puede estimar con fiabilidad.\n\nSubvenciones, donaciones y legados. Las no reintegrables se registran como ingresos imputados al patrimonio neto y se llevan a resultados de forma correlacionada con los gastos que financian. Las de explotación se imputan a resultados en el ejercicio en que se conceden.\n\nCriterios empleados en transacciones entre partes vinculadas. Se contabilizan por su valor razonable, con las normas generales.";
    case "4":
      return "El movimiento del ejercicio de cada epígrafe y de sus amortizaciones acumuladas y correcciones valorativas por deterioro se recoge en el cuadro siguiente.\n\nArrendamientos financieros. La sociedad no tiene bienes en régimen de arrendamiento financiero. [Si los tiene: coste en origen, duración del contrato, años transcurridos, cuotas satisfechas en años anteriores y en el ejercicio, cuotas pendientes y valor de la opción de compra.]";
    case "5":
      return "El movimiento de los activos financieros no corrientes se recoge en el cuadro siguiente. No se han registrado correcciones por deterioro originadas por el riesgo de crédito distintas de las indicadas. La sociedad no tiene activos financieros valorados a valor razonable ni participaciones en empresas del grupo, multigrupo o asociadas. [Revísalo.]";
    case "6":
      return "El detalle de las deudas al cierre se recoge en el cuadro siguiente. Vencimientos de las deudas a largo plazo en los cinco años siguientes y resto: [indica los importes por año]. No existen deudas con garantía real. Durante el ejercicio no se ha producido ningún impago del principal ni de los intereses de los préstamos. [Revísalo.]";
    case "7":
      return "El capital social está representado por [número] [acciones/participaciones] de [importe] € de valor nominal cada una, totalmente suscritas y desembolsadas. La sociedad no tiene acciones o participaciones propias. El movimiento de las partidas de fondos propios se recoge en el cuadro siguiente y en el estado de cambios en el patrimonio neto.";
    case "8":
      return "La conciliación entre el resultado contable y la base imponible del Impuesto sobre Sociedades se recoge en el cuadro siguiente. La sociedad tiene abiertos a inspección los ejercicios no prescritos de los impuestos que le son aplicables. [Indica, si las hay, las bases imponibles negativas pendientes de compensar y los incentivos fiscales aplicados.]";
    case "9":
      return "Durante el ejercicio no se han realizado operaciones con partes vinculadas distintas de las propias del tráfico ordinario en condiciones normales de mercado. Los miembros del órgano de administración [no han percibido / han percibido] retribuciones por importe de [importe] €. No se les han concedido anticipos ni créditos, ni la sociedad ha asumido obligaciones por su cuenta a título de garantía. [Revísalo.]";
    case "10":
      return "El número medio de personas empleadas en el curso del ejercicio se indica en el cuadro siguiente. No existen acuerdos que no figuren en el balance, ni compromisos financieros, garantías o contingencias que no estén reflejados en él. No se han producido ingresos o gastos de cuantía o incidencia excepcionales. Las subvenciones, donaciones y legados recibidos son los que figuran en el cuadro. Con posterioridad al cierre no se han producido hechos de importancia relativa significativa que no estén reflejados en estas cuentas. [Revísalo.]";
    case "pmp":
      return "La información sobre el periodo medio de pago a proveedores se recoge en el cuadro siguiente. Se ha calculado con las facturas recibidas de proveedores y acreedores comerciales y sus pagos, contando los días desde la fecha de la factura.";
    default:
      return "";
  }
}

export type NoteTable = {
  title: string;
  columns: string[];
  /** Primera celda: concepto; el resto, importes (null = celda vacía). */
  rows: Array<{ label: string; values: Array<number | string | null>; strong?: boolean }>;
  /** Unidad de las columnas numéricas («€» por defecto). */
  unit?: "€" | "";
  note?: string;
};

type MovementGroup = { label: string; prefixes: string[] };

// «+ 0» evita el cero negativo al cambiar el signo de un saldo nulo.
const cents = (value: number) => Math.round(value) / 100 + 0;

/**
 * Cuadro de movimientos de un conjunto de cuentas: saldo inicial, entradas, salidas y saldo final.
 * `creditNature`: cuentas correctoras (amortización acumulada, deterioros), cuyo saldo es acreedor;
 * se muestran en positivo, con sus aumentos como entradas.
 */
export function movementRows(rows: StatementAccountRow[], groups: MovementGroup[], creditNature = false) {
  return groups.map((group) => {
    let opening = 0;
    let debit = 0;
    let credit = 0;
    for (const row of rows) {
      if (!group.prefixes.some((prefix) => row.code.startsWith(prefix))) continue;
      opening += row.priorCents;
      debit += row.debitCents;
      credit += row.creditCents;
    }
    const sign = creditNature ? -1 : 1;
    const additions = creditNature ? credit : debit;
    const disposals = creditNature ? debit : credit;
    return { label: group.label, opening: cents(sign * opening), additions: cents(additions), disposals: cents(disposals), closing: cents(sign * (opening + debit - credit)) };
  });
}

const MOVEMENT_COLUMNS = ["Saldo inicial", "Entradas", "Salidas", "Saldo final"];

function movementTable(title: string, rows: ReturnType<typeof movementRows>, totalLabel: string, note?: string): NoteTable {
  const total = rows.reduce((sum, row) => ({ opening: sum.opening + row.opening, additions: sum.additions + row.additions, disposals: sum.disposals + row.disposals, closing: sum.closing + row.closing }), { opening: 0, additions: 0, disposals: 0, closing: 0 });
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    title,
    columns: MOVEMENT_COLUMNS,
    rows: [
      ...rows.map((row) => ({ label: row.label, values: [row.opening, row.additions, row.disposals, row.closing] })),
      { label: totalLabel, values: [round(total.opening), round(total.additions), round(total.disposals), round(total.closing)], strong: true },
    ],
    note,
  };
}

/** Nota 4: coste, amortización acumulada y deterioro del inmovilizado. */
export function fixedAssetTables(rows: StatementAccountRow[]): NoteTable[] {
  return [
    movementTable("Coste", movementRows(rows, [
      { label: "Inmovilizado intangible (20)", prefixes: ["20"] },
      { label: "Inmovilizado material (21 y 23)", prefixes: ["21", "23"] },
      { label: "Inversiones inmobiliarias (22)", prefixes: ["22"] },
    ]), "Total coste"),
    movementTable("Amortización acumulada", movementRows(rows, [
      { label: "Del inmovilizado intangible (280)", prefixes: ["280"] },
      { label: "Del inmovilizado material (281)", prefixes: ["281"] },
      { label: "De las inversiones inmobiliarias (282)", prefixes: ["282"] },
    ], true), "Total amortización acumulada", "Entradas: dotaciones del ejercicio. Salidas: bajas y ventas."),
    movementTable("Correcciones valorativas por deterioro", movementRows(rows, [
      { label: "Del inmovilizado intangible (290)", prefixes: ["290"] },
      { label: "Del inmovilizado material (291)", prefixes: ["291"] },
      { label: "De las inversiones inmobiliarias (292)", prefixes: ["292"] },
    ], true), "Total deterioro"),
  ];
}

export type FixedAssetRegisterSummary = { additions: { count: number; cost: number }; disposals: { count: number; cost: number }; inUse: { count: number; cost: number } };

export function fixedAssetRegisterTable(summary: FixedAssetRegisterSummary): NoteTable {
  return {
    title: "Fichas de inmovilizado",
    columns: ["N.º de bienes", "Coste"],
    rows: [
      { label: "Altas del ejercicio", values: [String(summary.additions.count), summary.additions.cost] },
      { label: "Bajas y ventas del ejercicio", values: [String(summary.disposals.count), summary.disposals.cost] },
      { label: "Bienes en uso al cierre", values: [String(summary.inUse.count), summary.inUse.cost], strong: true },
    ],
    note: "Según el registro de bienes de la aplicación (Contabilidad › Inmovilizado).",
  };
}

/** Nota 5: activos financieros no corrientes (subgrupos 24, 25 y 26) y sus deterioros. */
export function financialAssetTables(rows: StatementAccountRow[]): NoteTable[] {
  return [
    movementTable("Activos financieros no corrientes", movementRows(rows, [
      { label: "Participaciones y créditos en partes vinculadas (24)", prefixes: ["24"] },
      { label: "Otras inversiones financieras a largo plazo (25)", prefixes: ["25"] },
      { label: "Fianzas y depósitos constituidos a largo plazo (26)", prefixes: ["26"] },
    ]), "Total"),
    movementTable("Correcciones por deterioro de activos financieros", movementRows(rows, [
      { label: "De participaciones y valores a largo plazo (293, 294, 297)", prefixes: ["293", "294", "297"] },
      { label: "De créditos a largo plazo (295, 298)", prefixes: ["295", "298"] },
      { label: "De créditos por operaciones comerciales (490, 493)", prefixes: ["490", "493"] },
    ], true), "Total deterioro"),
  ];
}

/** Nota 6: deudas al cierre por naturaleza (saldos acreedores). */
export function debtTable(rows: StatementAccountRow[]): NoteTable {
  const balance = (prefixes: string[]) => {
    let total = 0;
    for (const row of rows) if (prefixes.some((prefix) => row.code.startsWith(prefix))) total += row.priorCents + row.debitCents - row.creditCents;
    return cents(-total);
  };
  const lines: Array<[string, string[], string[]]> = [
    ["Deudas con entidades de crédito", ["170", "1605"], ["520", "527", "5105"]],
    ["Acreedores por arrendamiento financiero", ["174", "1625"], ["524", "5125"]],
    ["Otras deudas", ["171", "172", "173", "175", "176", "177", "178", "179", "180", "185", "189", "15", "1615", "1635"], ["521", "522", "523", "525", "526", "528", "555", "560", "561", "569"]],
    ["Deudas con empresas del grupo y asociadas", ["1603", "1604", "1613", "1614", "1623", "1624", "1633", "1634"], ["5103", "5104", "5113", "5114", "5123", "5124", "5133", "5134", "5143", "5144", "5563", "5564"]],
    ["Proveedores y acreedores comerciales", [], ["400", "401", "403", "404", "405", "406", "41"]],
  ];
  const data = lines.map(([label, long, short]) => ({ label, long: balance(long), short: balance(short) }));
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    title: "Deudas al cierre del ejercicio",
    columns: ["A largo plazo", "A corto plazo", "Total"],
    rows: [
      ...data.map((line) => ({ label: line.label, values: [line.long, line.short, round(line.long + line.short)] })),
      { label: "Total", values: [round(data.reduce((sum, line) => sum + line.long, 0)), round(data.reduce((sum, line) => sum + line.short, 0)), round(data.reduce((sum, line) => sum + line.long + line.short, 0))], strong: true },
    ],
  };
}

/** Nota 10: subvenciones, donaciones y legados (subgrupo 13 y cuentas 740, 746 y 747). */
export function grantsTable(rows: StatementAccountRow[]): NoteTable {
  const equity = movementRows(rows, [{ label: "Subvenciones, donaciones y legados en el patrimonio neto (130, 131, 132)", prefixes: ["130", "131", "132"] }], true)[0];
  const income = (prefixes: string[]) => {
    let total = 0;
    for (const row of rows) if (prefixes.some((prefix) => row.code.startsWith(prefix))) total += row.creditCents - row.debitCents;
    return cents(total);
  };
  return {
    title: "Subvenciones, donaciones y legados",
    columns: ["Importe"],
    rows: [
      { label: "Saldo inicial en el patrimonio neto", values: [equity.opening] },
      { label: "Recibidas en el ejercicio", values: [equity.additions] },
      { label: "Traspasadas a resultados y otras disminuciones", values: [equity.disposals] },
      { label: "Saldo final en el patrimonio neto", values: [equity.closing], strong: true },
      { label: "Subvenciones de explotación imputadas al resultado (740 y 747)", values: [income(["740", "747"])] },
      { label: "Subvenciones de capital traspasadas al resultado (746)", values: [income(["746"])] },
    ],
  };
}

export type TaxReconciliationInput = {
  /** Resultado del ejercicio después de impuestos. */
  result: number;
  /** Gasto por impuesto sobre beneficios contabilizado (cuentas 630, 633 y 638), gasto en positivo. */
  incomeTaxExpense: number;
  /** Datos que no están en la contabilidad: null si la empresa no los ha indicado. */
  permanentDifferences: number | null;
  temporaryDifferences: number | null;
  lossCarryforward: number | null;
};

/** Nota 8: conciliación del resultado contable con la base imponible del Impuesto sobre Sociedades. */
export function taxReconciliationTable(input: TaxReconciliationInput): NoteTable {
  const round = (value: number) => Math.round(value * 100) / 100;
  const beforeTax = round(input.result + input.incomeTaxExpense);
  const hasData = input.permanentDifferences !== null || input.temporaryDifferences !== null || input.lossCarryforward !== null;
  const previousBase = round(beforeTax + (input.permanentDifferences ?? 0) + (input.temporaryDifferences ?? 0));
  const base = round(previousBase - (input.lossCarryforward ?? 0));
  return {
    title: "Conciliación del resultado contable con la base imponible",
    columns: ["Importe"],
    rows: [
      { label: "Resultado contable del ejercicio", values: [round(input.result)] },
      { label: "Impuesto sobre beneficios contabilizado", values: [round(input.incomeTaxExpense)] },
      { label: "Resultado contable antes de impuestos", values: [beforeTax], strong: true },
      { label: "Diferencias permanentes (gastos no deducibles, exenciones…)", values: [input.permanentDifferences] },
      { label: "Diferencias temporarias", values: [input.temporaryDifferences] },
      { label: "Base imponible previa", values: [hasData ? previousBase : null] },
      { label: "Compensación de bases imponibles negativas de ejercicios anteriores", values: [input.lossCarryforward === null ? null : -round(input.lossCarryforward)] },
      { label: "Base imponible (resultado fiscal)", values: [hasData ? base : null], strong: true },
    ],
    note: hasData
      ? "Las diferencias y la compensación de bases negativas son las indicadas por la empresa; el resto sale de la contabilidad."
      : "La aplicación no liquida el Impuesto sobre Sociedades: indica las diferencias permanentes y temporarias y la compensación de bases negativas para completar la conciliación.",
  };
}

export type SupplierInvoiceForPayment = {
  /** Fecha desde la que se cuentan los días (fecha de la factura). */
  date: Date;
  totalCents: number;
  payments: Array<{ date: Date; cents: number }>;
};

export type SupplierPaymentPeriod = {
  /** Periodo medio de pago a proveedores, en días. null si no hay operaciones. */
  averageDays: number | null;
  ratioPaidDays: number | null;
  ratioPendingDays: number | null;
  totalPaid: number;
  totalPending: number;
  /** Facturas pagadas dentro del plazo máximo legal (Ley 18/2022). */
  paidWithinLimit: { amount: number; count: number; amountPct: number | null; countPct: number | null };
  paidInvoices: number;
};

/** Plazo máximo legal de pago entre empresas (art. 4 de la Ley 3/2004): 60 días naturales. */
export const LEGAL_PAYMENT_LIMIT_DAYS = 60;

const DAY_MS = 86_400_000;
const daysBetween = (from: Date, to: Date) => Math.max(0, Math.round((to.getTime() - from.getTime()) / DAY_MS));

/**
 * Periodo medio de pago a proveedores (Resolución del ICAC de 29 de enero de 2016):
 *
 *   PMP = (ratio de operaciones pagadas × pagos realizados + ratio de operaciones pendientes × pagos pendientes)
 *         / (pagos realizados + pagos pendientes)
 *
 * - ratio de operaciones pagadas: días entre la factura y cada pago del ejercicio, ponderados por el importe pagado;
 * - ratio de operaciones pendientes: días entre la factura y el cierre, ponderados por lo que queda por pagar.
 * `invoices`: facturas de proveedores con pagos en el ejercicio o pendientes al cierre. Solo cuentan
 * los pagos hechos dentro del ejercicio (`from` ≤ fecha < `toExclusive`).
 */
export function supplierPaymentPeriod(invoices: SupplierInvoiceForPayment[], range: { from: Date; toExclusive: Date }): SupplierPaymentPeriod {
  const closing = new Date(range.toExclusive.getTime() - DAY_MS);
  let paidCents = 0;
  let paidWeighted = 0;
  let pendingCents = 0;
  let pendingWeighted = 0;
  let withinCents = 0;
  let withinCount = 0;
  let paidInvoices = 0;
  for (const invoice of invoices) {
    if (invoice.totalCents <= 0 || invoice.date >= range.toExclusive) continue;
    let paidBeforeClose = 0;
    let paidInYear = 0;
    let lastPaymentDays = 0;
    for (const payment of invoice.payments) {
      if (payment.date >= range.toExclusive) continue;
      paidBeforeClose += payment.cents;
      if (payment.date < range.from) continue;
      const days = daysBetween(invoice.date, payment.date);
      paidInYear += payment.cents;
      paidWeighted += days * payment.cents;
      lastPaymentDays = Math.max(lastPaymentDays, days);
    }
    paidCents += paidInYear;
    const pending = Math.max(0, invoice.totalCents - paidBeforeClose);
    if (pending > 0) {
      pendingCents += pending;
      pendingWeighted += daysBetween(invoice.date, closing) * pending;
    } else if (paidInYear > 0) {
      // Factura terminada de pagar en el ejercicio: ¿dentro del plazo máximo legal?
      paidInvoices += 1;
      if (lastPaymentDays <= LEGAL_PAYMENT_LIMIT_DAYS) {
        withinCents += paidInYear;
        withinCount += 1;
      }
    }
  }
  const round1 = (value: number) => Math.round(value * 10) / 10;
  const total = paidCents + pendingCents;
  return {
    averageDays: total > 0 ? round1((paidWeighted + pendingWeighted) / total) : null,
    ratioPaidDays: paidCents > 0 ? round1(paidWeighted / paidCents) : null,
    ratioPendingDays: pendingCents > 0 ? round1(pendingWeighted / pendingCents) : null,
    totalPaid: cents(paidCents),
    totalPending: cents(pendingCents),
    paidWithinLimit: {
      amount: cents(withinCents),
      count: withinCount,
      amountPct: paidCents > 0 ? round1((withinCents / paidCents) * 100) : null,
      countPct: paidInvoices > 0 ? round1((withinCount / paidInvoices) * 100) : null,
    },
    paidInvoices,
  };
}

const days = (value: number | null) => (value === null ? null : `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} días`);
const pct = (value: number | null) => (value === null ? null : `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} %`);

export function supplierPaymentTable(current: SupplierPaymentPeriod, previous: SupplierPaymentPeriod | null, labels: { current: string; previous?: string }): NoteTable {
  const columns = previous && labels.previous ? [labels.current, labels.previous] : [labels.current];
  const pair = <T,>(pick: (period: SupplierPaymentPeriod) => T): T[] => (previous && labels.previous ? [pick(current), pick(previous)] : [pick(current)]);
  return {
    title: "Periodo medio de pago a proveedores",
    columns,
    unit: "",
    rows: [
      { label: "Periodo medio de pago a proveedores", values: pair((period) => days(period.averageDays)), strong: true },
      { label: "Ratio de operaciones pagadas", values: pair((period) => days(period.ratioPaidDays)) },
      { label: "Ratio de operaciones pendientes de pago", values: pair((period) => days(period.ratioPendingDays)) },
      { label: "Total pagos realizados (€)", values: pair((period) => period.totalPaid) },
      { label: "Total pagos pendientes (€)", values: pair((period) => period.totalPending) },
      { label: `Importe pagado en ${LEGAL_PAYMENT_LIMIT_DAYS} días o menos (€)`, values: pair((period) => period.paidWithinLimit.amount) },
      { label: "Porcentaje sobre el total de pagos", values: pair((period) => pct(period.paidWithinLimit.amountPct)) },
      { label: `Número de facturas pagadas en ${LEGAL_PAYMENT_LIMIT_DAYS} días o menos`, values: pair((period) => String(period.paidWithinLimit.count)) },
      { label: "Porcentaje sobre el total de facturas pagadas", values: pair((period) => pct(period.paidWithinLimit.countPct)) },
    ],
    note: "Calculado con las facturas recibidas y sus pagos registrados; los días se cuentan desde la fecha de la factura.",
  };
}

export function employeesTable(current: number | null, previous: number | null, labels: { current: string; previous?: string }): NoteTable {
  const format = (value: number | null) => (value === null ? null : new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value));
  return {
    title: "Número medio de personas empleadas",
    columns: labels.previous ? [labels.current, labels.previous] : [labels.current],
    unit: "",
    rows: [{ label: "Plantilla media del ejercicio", values: labels.previous ? [format(current), format(previous)] : [format(current)], strong: true }],
    note: current === null ? "Indica la plantilla media del ejercicio: es un dato obligatorio de la memoria." : undefined,
  };
}

/** Texto guardado de un apartado o, si la empresa aún no lo ha escrito, el texto de partida. */
export function noteText(sectionId: string, saved: Record<string, string> | null | undefined, ctx: NotesContext) {
  const text = saved?.[sectionId];
  return typeof text === "string" && text.trim() !== "" ? text : defaultNoteText(sectionId, ctx);
}

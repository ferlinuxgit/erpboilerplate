/**
 * Retenciones e ingresos a cuenta (módulo puro): modelos 111, 115 y 123 (autoliquidaciones) y sus
 * resúmenes anuales 190, 180 y 193.
 *
 * Entrada: una lista de «partidas» (`WithholdingItem`), cada una con su perceptor, su base, su
 * retención y la fecha a la que se imputa. Las carga `@/server/payroll/withholding-data` desde las
 * nóminas, las facturas recibidas con retención y los rendimientos del capital pagados.
 *
 * NUMERACIÓN CONTRASTADA el 27-11-2026 con los diseños de registro de la sede de la AEAT:
 * - 111: `dr111e16v18.xls` (casillas 01 a 30) e instrucciones del modelo;
 * - 115: `DR115e15v13.xls` (casillas 01 a 05);
 * - 123: `DR123e24.xls`, ejercicio 2024 y siguientes (casillas 01 a 14, Orden HAC/56/2024);
 * - 190: diseños lógicos de 2025 (Orden HAC/1431/2025): claves y subclaves de percepción;
 * - 180: diseño de 2023 (Orden HFP/1284/2023): situación del inmueble 1 a 4;
 * - 193: diseños de 2024 y 2025: clave de percepción y naturaleza.
 * La fórmula «30 = 28 − 29» del 111 no aparece literal en las instrucciones (remiten a «la
 * operación indicada en el formulario»); es la que figura en el propio impreso.
 *
 * Importes en céntimos enteros. Este módulo no genera ficheros de presentación: expone los
 * resultados con tipos exportados para que los lea quien los genere.
 */

export type WithholdingModelCode = "111" | "115" | "123" | "190" | "180" | "193";

export const WITHHOLDING_MODEL_CODES: readonly WithholdingModelCode[] = ["111", "115", "123", "190", "180", "193"];

export function isWithholdingModelCode(value: string): value is WithholdingModelCode {
  return (WITHHOLDING_MODEL_CODES as readonly string[]).includes(value);
}

/** Autoliquidación periódica de la que es resumen cada declaración anual. */
export const ANNUAL_SUMMARY_OF: Record<"190" | "180" | "193", "111" | "115" | "123"> = { "190": "111", "180": "115", "193": "123" };

/** Bloques del modelo 111 (apartados I a V de la liquidación). */
export type Modelo111Block = "work" | "economic" | "prizes" | "forestry" | "image";

/** De dónde sale la partida. */
export type WithholdingSource = "payroll" | "supplierInvoice" | "capitalIncome";

/**
 * Criterio con el que se ha fechado la partida:
 * - `payment`: fecha de pago (art. 78.1 RIRPF: la obligación de retener nace al satisfacer la renta);
 * - `accrual`: devengo mensual de la nómina;
 * - `registration`: fecha de registro de la factura (criterio histórico del programa);
 * - `registration-unpaid`: se pidió imputar por pago pero la renta aún no consta pagada;
 * - `registration-filed`: se pagó en otro periodo, pero el de registro ya está presentado con ella dentro.
 */
export type WithholdingAllocation = "payment" | "accrual" | "registration" | "registration-unpaid" | "registration-filed";

export type CapitalIncomeKind = "dividend" | "interest";

export type WithholdingItem = {
  source: WithholdingSource;
  sourceId: string;
  /** Texto para identificar el documento (número de factura, «Nómina 2026-03 · Ana»…). */
  documentLabel: string;
  /** Autoliquidación en la que se ingresa la retención. */
  model: "111" | "115" | "123";
  /** Fecha civil de imputación (AAAA-MM-DD). */
  date: string;
  allocation: WithholdingAllocation;
  recipientTaxId: string | null;
  recipientName: string;
  /** Solo en el 111: apartado de la liquidación. */
  block?: Modelo111Block;
  /** Percepción en especie (la retención es entonces un «ingreso a cuenta»). */
  inKind: boolean;
  /** Percepción íntegra (o valoración de la retribución en especie). */
  baseCents: number;
  /** Retención o ingreso a cuenta. */
  withheldCents: number;
  /** Tipo aplicado (%), si se conoce. */
  rate?: number | null;
  /** Clave y subclave de percepción del 190 (A, E/01…, G/01…). */
  key190?: string;
  subkey190?: string | null;
  /** Solo en el 123/193. */
  capitalKind?: CapitalIncomeKind;
};

/** Casilla de un modelo. `count`: número de perceptores o de rentas (no es un importe). */
export type WithholdingBox = {
  box: string;
  label: string;
  amount: number;
  kind: "count" | "base" | "tax" | "settlement";
};

export type WithholdingCheck = {
  code: string;
  status: "ok" | "warning" | "blocking";
  title: string;
  detail: string;
  action: string;
};

const toAmount = (cents: number) => Math.round(cents) / 100;

/** NIF sin espacios ni guiones y en mayúsculas; cadena vacía si falta. */
export function normalizeRecipientTaxId(taxId: string | null | undefined) {
  return (taxId ?? "").replace(/[\s.\-]/g, "").toUpperCase();
}

/** Clave para agrupar un perceptor: su NIF, o su nombre si no lo tiene. */
export function recipientKey(item: Pick<WithholdingItem, "recipientTaxId" | "recipientName">) {
  return normalizeRecipientTaxId(item.recipientTaxId) || `sin-nif:${item.recipientName.trim().toLowerCase()}`;
}

function countRecipients(items: WithholdingItem[]) {
  return new Set(items.map(recipientKey)).size;
}

function sumBase(items: WithholdingItem[]) {
  return items.reduce((total, item) => total + item.baseCents, 0);
}

function sumWithheld(items: WithholdingItem[]) {
  return items.reduce((total, item) => total + item.withheldCents, 0);
}

/** Partidas cuya fecha de imputación cae en [start, endExclusive) (fechas civiles AAAA-MM-DD). */
export function itemsInRange<T extends { date: string }>(items: T[], start: string, endExclusive: string) {
  return items.filter((item) => item.date >= start && item.date < endExclusive);
}

// ---------------------------------------------------------------------------------------------
// Imputación temporal
// ---------------------------------------------------------------------------------------------

export type AllocationInput = {
  /** Fecha de devengo o de registro (AAAA-MM-DD): la que se usa si no hay pago. */
  fallbackDate: string;
  /** Criterio cuando no se imputa por pago. */
  fallbackKind: "registration" | "accrual";
  /** `payment`: imputar por fecha de pago cuando el pago existe. */
  basis: "payment" | "fallback";
  /** Pagos aplicados a la renta (fecha civil e importe pagado). */
  payments: Array<{ date: string; cents: number }>;
  /** Importe total a pagar al perceptor (líquido): sirve para repartir pagos parciales. */
  payableCents: number;
  baseCents: number;
  withheldCents: number;
  /** Periodo ya presentado del modelo que contiene esa fecha ("2026-Q1"), o null si no lo está. */
  filedPeriodOf?: (date: string) => string | null;
};

export type AllocationPortion = { date: string; allocation: WithholdingAllocation; baseCents: number; withheldCents: number };

/**
 * Reparte una renta entre las fechas en que nace la obligación de retener.
 *
 * Art. 78.1 RIRPF: «la obligación de retener nacerá en el momento en que se satisfagan o abonen las
 * rentas correspondientes». Con el criterio de pago, cada pago arrastra la parte proporcional de la
 * base y de la retención; lo que queda sin pagar se imputa a la fecha de registro o de devengo (y
 * se avisa). Si ese periodo ya está presentado, la renta se declaró entera allí: se deja donde está
 * para no declararla dos veces cuando se pague más tarde.
 */
export function allocateWithholding(input: AllocationInput): AllocationPortion[] {
  const whole = (allocation: WithholdingAllocation): AllocationPortion[] => [
    { date: input.fallbackDate, allocation, baseCents: input.baseCents, withheldCents: input.withheldCents },
  ];
  if (input.basis !== "payment") return whole(input.fallbackKind);
  // Abonos y rectificativas (importes negativos) no se «pagan»: van por su fecha de registro.
  if (input.payableCents <= 0 || input.withheldCents < 0 || input.baseCents < 0) return whole(input.fallbackKind);
  const payments = input.payments.filter((payment) => payment.cents > 0).sort((left, right) => left.date.localeCompare(right.date));
  if (payments.length === 0) return whole(input.fallbackKind === "registration" ? "registration-unpaid" : "accrual");
  const filedPeriod = input.filedPeriodOf?.(input.fallbackDate) ?? null;
  if (filedPeriod !== null && payments.some((payment) => input.filedPeriodOf?.(payment.date) !== filedPeriod)) {
    return whole("registration-filed");
  }

  const portions: AllocationPortion[] = [];
  let paidCents = 0;
  let baseLeft = input.baseCents;
  let withheldLeft = input.withheldCents;
  for (const payment of payments) {
    const cents = Math.min(payment.cents, input.payableCents - paidCents);
    if (cents <= 0) break;
    paidCents += cents;
    const settles = paidCents >= input.payableCents;
    const baseCents = settles ? baseLeft : Math.round((input.baseCents * cents) / input.payableCents);
    const withheldCents = settles ? withheldLeft : Math.round((input.withheldCents * cents) / input.payableCents);
    baseLeft -= baseCents;
    withheldLeft -= withheldCents;
    portions.push({ date: payment.date, allocation: "payment", baseCents, withheldCents });
  }
  if (baseLeft !== 0 || withheldLeft !== 0) {
    portions.push({
      date: input.fallbackDate,
      allocation: input.fallbackKind === "registration" ? "registration-unpaid" : "accrual",
      baseCents: baseLeft,
      withheldCents: withheldLeft,
    });
  }
  return portions;
}

// ---------------------------------------------------------------------------------------------
// Modelo 111
// ---------------------------------------------------------------------------------------------

const MODELO_111_BLOCKS: Array<{ block: Modelo111Block; title: string; cash: [string, string, string]; kind: [string, string, string] | null; cashLabel: string }> = [
  { block: "work", title: "Rendimientos del trabajo", cash: ["01", "02", "03"], kind: ["04", "05", "06"], cashLabel: "Importe de las percepciones" },
  { block: "economic", title: "Rendimientos de actividades económicas", cash: ["07", "08", "09"], kind: ["10", "11", "12"], cashLabel: "Importe de las percepciones" },
  { block: "prizes", title: "Premios por la participación en juegos, concursos, rifas o combinaciones aleatorias", cash: ["13", "14", "15"], kind: ["16", "17", "18"], cashLabel: "Importe de las percepciones" },
  { block: "forestry", title: "Ganancias patrimoniales derivadas de los aprovechamientos forestales", cash: ["19", "20", "21"], kind: ["22", "23", "24"], cashLabel: "Importe de las percepciones" },
  // Cesión de derechos de imagen (art. 92.8 LIRPF): un solo trío de casillas, siempre ingreso a cuenta.
  { block: "image", title: "Contraprestaciones por la cesión de derechos de imagen", cash: ["25", "26", "27"], kind: null, cashLabel: "Contraprestaciones satisfechas" },
];

export type Modelo111BlockTotals = {
  block: Modelo111Block;
  title: string;
  cash: { recipients: number; baseCents: number; withheldCents: number };
  inKind: { recipients: number; baseCents: number; withheldCents: number };
};

export type Modelo111Result = {
  boxes: WithholdingBox[];
  blocks: Modelo111BlockTotals[];
  /** Casilla 28: suma de retenciones e ingresos a cuenta. */
  totalCents: number;
  /** Casilla 29: resultado de anteriores declaraciones (solo en una complementaria). */
  previousCents: number;
  /** Casilla 30: resultado a ingresar. */
  resultCents: number;
};

/**
 * Modelo 111. `previousCents` es la casilla 29, que solo se rellena en una autoliquidación
 * complementaria (resultado a ingresar de las anteriores del mismo ejercicio y periodo).
 */
export function computeModelo111(items: WithholdingItem[], options: { previousCents?: number } = {}): Modelo111Result {
  const own = items.filter((item) => item.model === "111");
  const boxes: WithholdingBox[] = [];
  const blocks: Modelo111BlockTotals[] = [];
  let totalCents = 0;

  for (const definition of MODELO_111_BLOCKS) {
    const inBlock = own.filter((item) => (item.block ?? "economic") === definition.block);
    // La cesión de derechos de imagen no distingue dinerario y especie.
    const cashItems = definition.kind ? inBlock.filter((item) => !item.inKind) : inBlock;
    const kindItems = definition.kind ? inBlock.filter((item) => item.inKind) : [];
    const cash = { recipients: countRecipients(cashItems), baseCents: sumBase(cashItems), withheldCents: sumWithheld(cashItems) };
    const inKind = { recipients: countRecipients(kindItems), baseCents: sumBase(kindItems), withheldCents: sumWithheld(kindItems) };
    blocks.push({ block: definition.block, title: definition.title, cash, inKind });
    totalCents += cash.withheldCents + inKind.withheldCents;

    const suffix = definition.kind ? " · dinerarias" : "";
    boxes.push(
      { box: definition.cash[0], label: `${definition.title}${suffix} · N.º de perceptores`, amount: cash.recipients, kind: "count" },
      { box: definition.cash[1], label: `${definition.title}${suffix} · ${definition.cashLabel}`, amount: toAmount(cash.baseCents), kind: "base" },
      { box: definition.cash[2], label: `${definition.title}${suffix} · ${definition.kind ? "Importe de las retenciones" : "Importe de los ingresos a cuenta"}`, amount: toAmount(cash.withheldCents), kind: "tax" },
    );
    if (definition.kind) {
      boxes.push(
        { box: definition.kind[0], label: `${definition.title} · en especie · N.º de perceptores`, amount: inKind.recipients, kind: "count" },
        { box: definition.kind[1], label: `${definition.title} · en especie · Valor de las percepciones en especie`, amount: toAmount(inKind.baseCents), kind: "base" },
        { box: definition.kind[2], label: `${definition.title} · en especie · Importe de los ingresos a cuenta`, amount: toAmount(inKind.withheldCents), kind: "tax" },
      );
    }
  }

  const previousCents = options.previousCents ?? 0;
  const resultCents = totalCents - previousCents;
  boxes.push(
    { box: "28", label: "Suma de retenciones e ingresos a cuenta (03 + 06 + 09 + 12 + 15 + 18 + 21 + 24 + 27)", amount: toAmount(totalCents), kind: "tax" },
    { box: "29", label: "A deducir (solo en una complementaria): resultado a ingresar de anteriores declaraciones del mismo periodo", amount: toAmount(previousCents), kind: "tax" },
    { box: "30", label: "Resultado a ingresar (28 − 29)", amount: toAmount(resultCents), kind: "settlement" },
  );
  return { boxes, blocks, totalCents, previousCents, resultCents };
}

// ---------------------------------------------------------------------------------------------
// Modelo 115
// ---------------------------------------------------------------------------------------------

export type Modelo115Result = {
  boxes: WithholdingBox[];
  recipients: number;
  baseCents: number;
  withheldCents: number;
  previousCents: number;
  resultCents: number;
};

/** Modelo 115: retenciones sobre arrendamientos de inmuebles urbanos (casillas 01 a 05). */
export function computeModelo115(items: WithholdingItem[], options: { previousCents?: number } = {}): Modelo115Result {
  const own = items.filter((item) => item.model === "115");
  const recipients = countRecipients(own);
  const baseCents = sumBase(own);
  const withheldCents = sumWithheld(own);
  const previousCents = options.previousCents ?? 0;
  const resultCents = withheldCents - previousCents;
  return {
    recipients,
    baseCents,
    withheldCents,
    previousCents,
    resultCents,
    boxes: [
      { box: "01", label: "Número de perceptores", amount: recipients, kind: "count" },
      { box: "02", label: "Base de las retenciones e ingresos a cuenta", amount: toAmount(baseCents), kind: "base" },
      { box: "03", label: "Retenciones e ingresos a cuenta", amount: toAmount(withheldCents), kind: "tax" },
      { box: "04", label: "A deducir (solo en una complementaria): resultado de anteriores declaraciones del mismo periodo", amount: toAmount(previousCents), kind: "tax" },
      { box: "05", label: "Resultado a ingresar (03 − 04)", amount: toAmount(resultCents), kind: "settlement" },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Modelo 123
// ---------------------------------------------------------------------------------------------

export type Modelo123Result = {
  boxes: WithholdingBox[];
  dividends: { count: number; baseCents: number; withheldCents: number };
  other: { count: number; baseCents: number; withheldCents: number };
  withheldCents: number;
  previousCents: number;
  resultCents: number;
};

/**
 * Modelo 123 (diseño de 2024 en adelante): rendimientos del capital mobiliario. El diseño cuenta
 * «número de rentas», no perceptores: aquí cada pago registrado es una renta. Las casillas 10 y 11
 * (periodificación de rendimientos de ejercicios anteriores) no se calculan y van a cero.
 */
export function computeModelo123(items: WithholdingItem[], options: { previousCents?: number } = {}): Modelo123Result {
  const own = items.filter((item) => item.model === "123");
  const totals = (list: WithholdingItem[]) => ({ count: list.length, baseCents: sumBase(list), withheldCents: sumWithheld(list) });
  const dividends = totals(own.filter((item) => item.capitalKind === "dividend"));
  const other = totals(own.filter((item) => item.capitalKind !== "dividend"));
  const withheldCents = dividends.withheldCents + other.withheldCents;
  const previousCents = options.previousCents ?? 0;
  const resultCents = withheldCents - previousCents;
  return {
    dividends,
    other,
    withheldCents,
    previousCents,
    resultCents,
    boxes: [
      { box: "01", label: "Número de rentas · Dividendos y otras rentas de participación en fondos propios", amount: dividends.count, kind: "count" },
      { box: "02", label: "Número de rentas · Resto de rentas", amount: other.count, kind: "count" },
      { box: "03", label: "Número de rentas · Total", amount: dividends.count + other.count, kind: "count" },
      { box: "04", label: "Base de retenciones e ingresos a cuenta · Dividendos y otras rentas de participación en fondos propios", amount: toAmount(dividends.baseCents), kind: "base" },
      { box: "05", label: "Base de retenciones e ingresos a cuenta · Resto de rentas", amount: toAmount(other.baseCents), kind: "base" },
      { box: "06", label: "Base de retenciones e ingresos a cuenta · Total", amount: toAmount(dividends.baseCents + other.baseCents), kind: "base" },
      { box: "07", label: "Retenciones e ingresos a cuenta · Dividendos y otras rentas de participación en fondos propios", amount: toAmount(dividends.withheldCents), kind: "tax" },
      { box: "08", label: "Retenciones e ingresos a cuenta · Resto de rentas", amount: toAmount(other.withheldCents), kind: "tax" },
      { box: "09", label: "Retenciones e ingresos a cuenta · Total", amount: toAmount(withheldCents), kind: "tax" },
      { box: "10", label: "Periodificación · Ingresos de ejercicios anteriores (no calculado)", amount: 0, kind: "tax" },
      { box: "11", label: "Periodificación · Regularización (no calculado)", amount: 0, kind: "tax" },
      { box: "12", label: "Suma de retenciones e ingresos a cuenta y regularización (09 + 11)", amount: toAmount(withheldCents), kind: "tax" },
      { box: "13", label: "A deducir (solo en una complementaria): resultados a ingresar de anteriores autoliquidaciones del mismo periodo", amount: toAmount(previousCents), kind: "tax" },
      { box: "14", label: "Resultado a ingresar (12 − 13)", amount: toAmount(resultCents), kind: "settlement" },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Cuadre de un resumen anual con sus autoliquidaciones
// ---------------------------------------------------------------------------------------------

/** Resultado de una autoliquidación periódica del año: el presentado (si hay foto) o el calculado hoy. */
export type PeriodicFiling = { period: string; resultCents: number; filed: boolean };

export type AnnualReconciliation = {
  /** Retenciones e ingresos a cuenta del resumen anual. */
  annualCents: number;
  /** Suma de los resultados de las autoliquidaciones del año. */
  periodicCents: number;
  differenceCents: number;
  balanced: boolean;
  periods: PeriodicFiling[];
};

export function reconcileAnnualSummary(annualCents: number, periods: PeriodicFiling[]): AnnualReconciliation {
  const periodicCents = periods.reduce((total, period) => total + period.resultCents, 0);
  return { annualCents, periodicCents, differenceCents: annualCents - periodicCents, balanced: annualCents === periodicCents, periods };
}

function reconciliationCheck(annual: "190" | "180" | "193", reconciliation: AnnualReconciliation): WithholdingCheck {
  const periodic = ANNUAL_SUMMARY_OF[annual];
  const money = (cents: number) => `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  if (reconciliation.balanced) {
    return {
      code: `model-${annual}-reconciliation`,
      status: "ok",
      title: `El ${annual} cuadra con los ${periodic} del año`,
      detail: `Retenciones del resumen anual: ${money(reconciliation.annualCents)}, igual que la suma de los modelos ${periodic}.`,
      action: "Nada que hacer.",
    };
  }
  const detail = reconciliation.periods.map((period) => `${period.period}: ${money(period.resultCents)}${period.filed ? " (presentado)" : ""}`).join("; ");
  return {
    code: `model-${annual}-reconciliation`,
    status: "blocking",
    title: `El ${annual} no cuadra con los ${periodic} del año`,
    detail: `El resumen anual suma ${money(reconciliation.annualCents)} de retenciones y los modelos ${periodic} del año suman ${money(reconciliation.periodicCents)} (diferencia de ${money(reconciliation.differenceCents)}). ${detail}.`,
    action: `La AEAT cruza ambos importes. Lo habitual es que se hayan cambiado datos después de presentar un ${periodic}: revisa ese periodo y presenta una complementaria, o corrige los datos.`,
  };
}

// ---------------------------------------------------------------------------------------------
// Modelo 190
// ---------------------------------------------------------------------------------------------

/** Claves de percepción del 190 que maneja el programa (diseños lógicos de 2025). */
export const MODELO_190_KEYS: Record<string, string> = {
  A: "Rendimientos del trabajo: empleados por cuenta ajena en general",
  E: "Rendimientos del trabajo: consejeros y administradores",
  G: "Rendimientos de actividades económicas: actividades profesionales",
};

/** Subclaves de la clave E (texto de los diseños de 2025). */
export const MODELO_190_E_SUBKEYS: Record<string, string> = {
  "01": "Administrador en el régimen general como asimilado (no incluido en la 02)",
  "02": "Asimilado en el régimen general y entidad con cifra de negocios inferior a 100.000 €",
  "03": "Administrador en el RETA y entidad con cifra de negocios inferior a 100.000 €",
  "04": "Resto de consejeros y administradores",
};

/** Subclaves de la clave G que asigna el programa. */
export const MODELO_190_G_SUBKEYS: Record<string, string> = {
  "01": "Tipo general (art. 95.1 RIRPF)",
  "03": "Tipo reducido por inicio de la actividad (año de inicio y los dos siguientes)",
};

/** Tipo reducido de los profesionales en el año de inicio y los dos siguientes (art. 95.1 RIRPF). */
export const PROFESSIONAL_REDUCED_RATE = 7;

/** Subclave de la clave G según el tipo aplicado: 03 si es el reducido del 7 %, 01 en otro caso. */
export function professionalSubkey(rate: number | null | undefined) {
  return rate !== null && rate !== undefined && Math.abs(rate - PROFESSIONAL_REDUCED_RATE) < 0.005 ? "03" : "01";
}

/** Datos personales del perceptor que pide el 190 para la clave A (si están en la ficha). */
export type Modelo190PersonalData = {
  birthYear?: number | null;
  /** 1, 2 o 3 (situación familiar del diseño de registro). */
  familySituation?: number | null;
  /** 0 a 3 (grado de discapacidad). */
  disability?: number | null;
  /** 1 a 4 (contrato o relación). */
  contractType?: number | null;
  spouseTaxId?: string | null;
};

export type Modelo190Recipient = {
  taxId: string | null;
  name: string;
  key: string;
  subkey: string | null;
  /** Percepciones dinerarias: íntegro y retenciones. */
  cashCents: number;
  withheldCents: number;
  /** Percepciones en especie: valoración e ingresos a cuenta efectuados. */
  inKindCents: number;
  inKindWithheldCents: number;
  personal?: Modelo190PersonalData;
};

export type Modelo190Result = {
  recipients: Modelo190Recipient[];
  /** Número de registros de percepción (uno por perceptor, clave y subclave). */
  recordCount: number;
  /** Suma de percepciones íntegras (dinerarias + en especie). */
  totalIncomeCents: number;
  /** Suma de retenciones e ingresos a cuenta. */
  totalWithheldCents: number;
  reconciliation: AnnualReconciliation;
  checks: WithholdingCheck[];
};

/**
 * Modelo 190: resumen anual de las retenciones del 111. Un registro por perceptor, clave y subclave.
 * `periods` son los resultados de los 111 del año: si no suman lo mismo que el resumen, el aviso es
 * bloqueante.
 */
export function computeModelo190(
  items: WithholdingItem[],
  options: { periods: PeriodicFiling[]; personalData?: Map<string, Modelo190PersonalData> },
): Modelo190Result {
  const groups = new Map<string, Modelo190Recipient>();
  for (const item of items.filter((candidate) => candidate.model === "111")) {
    const key = item.key190 ?? "G";
    const subkey = item.subkey190 ?? null;
    const id = `${recipientKey(item)}|${key}|${subkey ?? ""}`;
    const recipient = groups.get(id) ?? {
      taxId: normalizeRecipientTaxId(item.recipientTaxId) || null,
      name: item.recipientName,
      key,
      subkey,
      cashCents: 0,
      withheldCents: 0,
      inKindCents: 0,
      inKindWithheldCents: 0,
      personal: key === "A" ? options.personalData?.get(recipientKey(item)) : undefined,
    };
    if (item.inKind) {
      recipient.inKindCents += item.baseCents;
      recipient.inKindWithheldCents += item.withheldCents;
    } else {
      recipient.cashCents += item.baseCents;
      recipient.withheldCents += item.withheldCents;
    }
    groups.set(id, recipient);
  }
  const recipients = [...groups.values()].sort((left, right) => left.key.localeCompare(right.key) || left.name.localeCompare(right.name, "es"));
  const totalIncomeCents = recipients.reduce((total, row) => total + row.cashCents + row.inKindCents, 0);
  const totalWithheldCents = recipients.reduce((total, row) => total + row.withheldCents + row.inKindWithheldCents, 0);
  const reconciliation = reconcileAnnualSummary(totalWithheldCents, options.periods);

  const checks: WithholdingCheck[] = [reconciliationCheck("190", reconciliation)];
  const withoutTaxId = recipients.filter((row) => !row.taxId);
  if (withoutTaxId.length > 0) {
    checks.push({
      code: "model-190-missing-tax-id",
      status: "blocking",
      title: "Perceptores sin NIF",
      detail: `${withoutTaxId.length} perceptor(es) no tienen NIF: ${withoutTaxId.slice(0, 5).map((row) => row.name).join(", ")}.`,
      action: "Completa el NIF en la ficha del trabajador o del proveedor: el 190 no admite perceptores sin identificar.",
    });
  }
  const incomplete = recipients.filter((row) => row.key === "A" && (!row.personal?.birthYear || !row.personal?.familySituation || !row.personal?.contractType));
  if (incomplete.length > 0) {
    checks.push({
      code: "model-190-personal-data",
      status: "warning",
      title: "Faltan datos personales de empleados (clave A)",
      detail: `${incomplete.length} empleado(s) sin año de nacimiento, situación familiar o tipo de contrato: ${incomplete.slice(0, 5).map((row) => row.name).join(", ")}.`,
      action: "Complétalos en la ficha del trabajador. Los demás datos de la clave A (hijos, ascendientes, reducciones, gastos deducibles, pensiones) no se guardan en el programa: los aporta la gestoría.",
    });
  }
  return { recipients, recordCount: recipients.length, totalIncomeCents, totalWithheldCents, reconciliation, checks };
}

// ---------------------------------------------------------------------------------------------
// Modelo 180
// ---------------------------------------------------------------------------------------------

/** Situación del inmueble (posición 114 del diseño de registro del 180). */
export const RENTAL_PROPERTY_SITUATIONS: Record<string, string> = {
  "1": "Con referencia catastral, en territorio español salvo País Vasco y Navarra",
  "2": "Con referencia catastral, en el País Vasco",
  "3": "Con referencia catastral, en Navarra",
  "4": "Sin referencia catastral",
};

export type RentalPropertyData = {
  /** 1 a 4. */
  situation: string;
  cadastralReference: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
};

export type Modelo180Recipient = {
  taxId: string | null;
  name: string;
  /** 1 dineraria, 2 en especie. */
  modality: "1" | "2";
  baseCents: number;
  /** Último tipo aplicado (%), como pide el diseño. */
  rate: number | null;
  withheldCents: number;
  /** Inmueble declarado; null si el arrendador no tiene ninguno dado de alta. */
  property: RentalPropertyData | null;
  /** Inmuebles del arrendador (si hay varios, la base no se puede repartir sola). */
  propertyCount: number;
};

export type Modelo180Result = {
  recipients: Modelo180Recipient[];
  recordCount: number;
  totalBaseCents: number;
  totalWithheldCents: number;
  reconciliation: AnnualReconciliation;
  checks: WithholdingCheck[];
};

/**
 * Modelo 180: resumen anual de los arrendamientos del 115. El diseño pide un registro por inmueble;
 * como las facturas no dicen a qué inmueble corresponden, se genera un registro por arrendador con
 * su primer inmueble y se avisa cuando tiene varios o ninguno.
 */
export function computeModelo180(
  items: WithholdingItem[],
  options: { periods: PeriodicFiling[]; properties?: Map<string, RentalPropertyData[]> },
): Modelo180Result {
  const groups = new Map<string, Modelo180Recipient & { lastDate: string }>();
  for (const item of items.filter((candidate) => candidate.model === "115")) {
    const id = recipientKey(item);
    const properties = options.properties?.get(id) ?? [];
    const recipient = groups.get(id) ?? {
      taxId: normalizeRecipientTaxId(item.recipientTaxId) || null,
      name: item.recipientName,
      modality: "1" as const,
      baseCents: 0,
      rate: null,
      withheldCents: 0,
      property: properties[0] ?? null,
      propertyCount: properties.length,
      lastDate: "",
    };
    recipient.baseCents += item.baseCents;
    recipient.withheldCents += item.withheldCents;
    if (item.rate !== null && item.rate !== undefined && item.date >= recipient.lastDate) {
      recipient.rate = item.rate;
      recipient.lastDate = item.date;
    }
    groups.set(id, recipient);
  }
  const recipients = [...groups.values()]
    .map(({ lastDate, ...recipient }) => { void lastDate; return recipient; })
    .sort((left, right) => left.name.localeCompare(right.name, "es"));
  const totalBaseCents = recipients.reduce((total, row) => total + row.baseCents, 0);
  const totalWithheldCents = recipients.reduce((total, row) => total + row.withheldCents, 0);
  const reconciliation = reconcileAnnualSummary(totalWithheldCents, options.periods);

  const checks: WithholdingCheck[] = [reconciliationCheck("180", reconciliation)];
  const names = (rows: Modelo180Recipient[]) => rows.slice(0, 5).map((row) => row.name).join(", ");
  const withoutTaxId = recipients.filter((row) => !row.taxId);
  if (withoutTaxId.length > 0) {
    checks.push({ code: "model-180-missing-tax-id", status: "blocking", title: "Arrendadores sin NIF", detail: `${withoutTaxId.length} arrendador(es) sin NIF: ${names(withoutTaxId)}.`, action: "Completa el NIF en la ficha del proveedor." });
  }
  const withoutProperty = recipients.filter((row) => !row.property);
  if (withoutProperty.length > 0) {
    checks.push({
      code: "model-180-missing-property",
      status: "warning",
      title: "Falta el inmueble alquilado",
      detail: `${withoutProperty.length} arrendador(es) sin inmueble dado de alta: ${names(withoutProperty)}. El 180 pide la referencia catastral y la dirección de cada inmueble.`,
      action: "Da de alta el inmueble en Nóminas y retenciones › Inmuebles alquilados.",
    });
  }
  const severalProperties = recipients.filter((row) => row.propertyCount > 1);
  if (severalProperties.length > 0) {
    checks.push({
      code: "model-180-several-properties",
      status: "warning",
      title: "Arrendadores con varios inmuebles",
      detail: `${names(severalProperties)}: el 180 lleva un registro por inmueble y el programa no sabe repartir el alquiler entre ellos.`,
      action: "Reparte tú la base y la retención entre los inmuebles al presentar.",
    });
  }
  return { recipients, recordCount: recipients.length, totalBaseCents, totalWithheldCents, reconciliation, checks };
}

// ---------------------------------------------------------------------------------------------
// Modelo 193
// ---------------------------------------------------------------------------------------------

/**
 * Clave de percepción y naturaleza del 193 para lo que registra el programa (diseño de 2024/2025):
 * dividendos → clave A, naturaleza 02 («dividendos y participaciones en beneficios»); intereses de
 * préstamos → clave B, naturaleza 03 («intereses de préstamos no bancarios»). No se contempla la
 * clave D (exceso sobre el triple de los fondos propios en préstamos de socios vinculados).
 */
export const MODELO_193_CODES: Record<CapitalIncomeKind, { key: string; nature: string; label: string }> = {
  dividend: { key: "A", nature: "02", label: "Dividendos y participaciones en beneficios" },
  interest: { key: "B", nature: "03", label: "Intereses de préstamos no bancarios" },
};

export type Modelo193Recipient = {
  taxId: string | null;
  name: string;
  kind: CapitalIncomeKind;
  /** Clave de percepción (A, B). */
  key: string;
  /** Naturaleza (02, 03). */
  nature: string;
  /** Pago: 1 = como emisor. */
  payment: "1";
  /** Importe íntegro de las percepciones. */
  incomeCents: number;
  /** Base de retenciones (sin reducciones: igual al íntegro). */
  baseCents: number;
  rate: number | null;
  withheldCents: number;
};

export type Modelo193Result = {
  recipients: Modelo193Recipient[];
  recordCount: number;
  totalBaseCents: number;
  totalWithheldCents: number;
  reconciliation: AnnualReconciliation;
  checks: WithholdingCheck[];
};

/** Modelo 193: resumen anual de las retenciones del 123, un registro por perceptor y clave. */
export function computeModelo193(items: WithholdingItem[], options: { periods: PeriodicFiling[] }): Modelo193Result {
  const groups = new Map<string, Modelo193Recipient & { lastDate: string }>();
  for (const item of items.filter((candidate) => candidate.model === "123")) {
    const kind: CapitalIncomeKind = item.capitalKind === "dividend" ? "dividend" : "interest";
    const codes = MODELO_193_CODES[kind];
    const id = `${recipientKey(item)}|${kind}`;
    const recipient = groups.get(id) ?? {
      taxId: normalizeRecipientTaxId(item.recipientTaxId) || null,
      name: item.recipientName,
      kind,
      key: codes.key,
      nature: codes.nature,
      payment: "1" as const,
      incomeCents: 0,
      baseCents: 0,
      rate: null,
      withheldCents: 0,
      lastDate: "",
    };
    recipient.incomeCents += item.baseCents;
    recipient.baseCents += item.baseCents;
    recipient.withheldCents += item.withheldCents;
    if (item.rate !== null && item.rate !== undefined && item.date >= recipient.lastDate) {
      recipient.rate = item.rate;
      recipient.lastDate = item.date;
    }
    groups.set(id, recipient);
  }
  const recipients = [...groups.values()]
    .map(({ lastDate, ...recipient }) => { void lastDate; return recipient; })
    .sort((left, right) => left.key.localeCompare(right.key) || left.name.localeCompare(right.name, "es"));
  const totalBaseCents = recipients.reduce((total, row) => total + row.baseCents, 0);
  const totalWithheldCents = recipients.reduce((total, row) => total + row.withheldCents, 0);
  const reconciliation = reconcileAnnualSummary(totalWithheldCents, options.periods);
  const checks: WithholdingCheck[] = [reconciliationCheck("193", reconciliation)];
  const withoutTaxId = recipients.filter((row) => !row.taxId);
  if (withoutTaxId.length > 0) {
    checks.push({ code: "model-193-missing-tax-id", status: "blocking", title: "Perceptores sin NIF", detail: `${withoutTaxId.length} perceptor(es) sin NIF: ${withoutTaxId.slice(0, 5).map((row) => row.name).join(", ")}.`, action: "Completa el NIF en el registro del rendimiento pagado." });
  }
  return { recipients, recordCount: recipients.length, totalBaseCents, totalWithheldCents, reconciliation, checks };
}

// ---------------------------------------------------------------------------------------------
// Avisos comunes de imputación
// ---------------------------------------------------------------------------------------------

/** Avisos sobre cómo se han fechado las partidas del periodo (función pura). */
export function allocationChecks(items: WithholdingItem[], invoiceBasis: "registration" | "payment"): WithholdingCheck[] {
  const checks: WithholdingCheck[] = [];
  const invoices = items.filter((item) => item.source === "supplierInvoice");
  const labels = (list: WithholdingItem[]) => [...new Set(list.map((item) => item.documentLabel))].slice(0, 5).join(", ");
  if (invoiceBasis === "registration" && invoices.length > 0) {
    checks.push({
      code: "withholding-registration-basis",
      status: "warning",
      title: "Facturas imputadas por su fecha de registro",
      detail: "La obligación de retener nace cuando pagas la factura (art. 78 del Reglamento del IRPF), no cuando la registras. El programa imputa por fecha de registro, que solo coincide si pagas en el mismo periodo.",
      action: "Si pagas a tus profesionales o al arrendador en un periodo distinto del de la factura, activa «imputar por fecha de pago» en Nóminas y retenciones › Ajustes.",
    });
  }
  const unpaid = invoices.filter((item) => item.allocation === "registration-unpaid");
  if (unpaid.length > 0) {
    checks.push({
      code: "withholding-unpaid",
      status: "warning",
      title: "Facturas con retención sin pago registrado",
      detail: `${new Set(unpaid.map((item) => item.sourceId)).size} factura(s) no tienen el pago registrado (o solo en parte) y se imputan por su fecha de registro: ${labels(unpaid)}.`,
      action: "Si de verdad no las has pagado, su retención todavía no se ingresa: quítala de este periodo al presentar o registra el pago cuando lo hagas. Si ya están pagadas, registra el pago.",
    });
  }
  const filed = invoices.filter((item) => item.allocation === "registration-filed");
  if (filed.length > 0) {
    checks.push({
      code: "withholding-filed-period",
      status: "ok",
      title: "Facturas declaradas en su periodo de registro",
      detail: `${new Set(filed.map((item) => item.sourceId)).size} factura(s) se pagaron en otro periodo, pero el de su registro ya estaba presentado con ellas: ${labels(filed)}.`,
      action: "Se quedan en el periodo presentado para no declararlas dos veces.",
    });
  }
  return checks;
}

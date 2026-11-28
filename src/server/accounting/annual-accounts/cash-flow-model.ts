/**
 * ESTADO DE FLUJOS DE EFECTIVO por el MÉTODO INDIRECTO (funciones puras).
 *
 * Partidas del modelo normal del PGC (Real Decreto 1514/2007, tercera parte, «Estado de flujos de
 * efectivo correspondiente al ejercicio terminado el …», BOE-A-2007-19884, texto consolidado). Es
 * obligatorio con balance normal (art. 257.3 de la Ley de Sociedades de Capital) y voluntario con
 * balance abreviado o de PYMES; por eso se calcula igual para cualquier modelo.
 *
 * CÓMO SE CALCULA. La contabilidad solo dice, por cuenta, el saldo inicial y el debe y el haber del
 * ejercicio (sin los asientos de regularización, cierre y apertura). Como cada asiento cuadra, la
 * variación del efectivo (grupo 57) es exactamente la suma, cambiada de signo, de la variación de
 * todas las demás cuentas. El estado reparte esa suma: cada cuenta va a UNA partida, de modo que el
 * total cuadra siempre con el grupo 57, y lo que no tiene partida se enseña en «Diferencias sin
 * clasificar» con sus cuentas para que se revise.
 * - Explotación: resultado antes de impuestos (grupos 6 y 7 salvo 6300, 6301, 633 y 638); los
 *   gastos e ingresos que no son cobros ni pagos de explotación se anulan en «Ajustes» y su importe
 *   pasa a la partida de inversión, financiación o «otros flujos» donde está su contrapartida
 *   (amortizaciones y resultados por bajas → inversión; intereses → pagos y cobros de intereses).
 *   «Variación de provisiones» es la variación del saldo de 14, 499 y 529. El capital corriente es la
 *   variación de existencias, deudores, acreedores y periodificaciones (con sus deterioros, por eso
 *   693/793 y 694/794 no se ajustan aparte). El impuesto sobre beneficios cobrado o pagado es el
 *   gasto (6300, 6301, 633, 638) más la variación de 473, 474, 4752, 479 y 830 a 838.
 * - Inversión: por clase de activo, pagos = cargos en las cuentas del activo (el inmovilizado en
 *   curso, 23, y los proveedores de inmovilizado, 173 y 523, por su variación neta, para no contar
 *   los traspasos ni las compras aplazadas como pagos) y cobros = flujo neto de la clase + pagos.
 * - Financiación: capital, reservas, resultados y dividendos se tratan juntos (repartir el resultado o
 *   ampliar capital con reservas no mueve dinero); los dividendos pagados son los cargos en la 526 y
 *   el resto, emisión o amortización de instrumentos de patrimonio según su signo. Las deudas, por
 *   clase, van a «Emisión» o a «Devolución» según su variación neta.
 *
 * LIMITACIONES (cifras que requieren revisión, no errores de cuadre):
 * - Las diferencias de cambio no se separan: quedan en el resultado y la partida D) sale a cero.
 * - El efecto impositivo de las subvenciones y ajustes de valor llevado a la 479/474 aparece en
 *   «Cobros (pagos) por impuesto sobre beneficios».
 * - Los intereses devengados y no pagados figuran como pagados (y su deuda como financiación).
 * - Una provisión por desmantelamiento (143 contra inmovilizado) sale como ajuste y como inversión.
 * - Las cuentas 550 a 554 van a inversión o a financiación según su saldo final.
 * - Coberturas (134, 81, 91), diferencias de conversión (135, 82, 92) y ganancias y pérdidas
 *   actuariales (85, 95) no tienen partida automática: su efecto sale en las diferencias sin
 *   clasificar para que se decida dónde presentarlo.
 */

import type { StatementAccountRow } from "@/server/accounting/statements-model";

export type CashFlowLine = {
  id: string;
  label: string;
  depth: number;
  kind: "group" | "line" | "total";
  amount: number;
  /** Mismo concepto del ejercicio anterior; null sin comparativa. */
  previous: number | null;
};

export type CashFlowYear = {
  openingCash: number;
  closingCash: number;
  /** Variación del grupo 57 (final − inicial). */
  cashVariation: number;
  /** Variación explicada por las partidas A, B, C y D. */
  explained: number;
  /** cashVariation − explained: 0 si todo cuadra. */
  unclassified: number;
  /** Cuentas con movimiento sin partida (su efecto está en las diferencias sin clasificar). */
  unclassifiedAccounts: Array<{ code: string; name: string; amount: number }>;
};

export type CashFlowStatement = {
  lines: CashFlowLine[];
  current: CashFlowYear;
  previous: CashFlowYear | null;
};

type LineDef = { id: string; label: string; children?: LineDef[]; totalOf?: string[] };

const INVESTMENT_CLASSES: Array<[string, string]> = [
  ["a", "a) Empresas del grupo y asociadas."],
  ["b", "b) Inmovilizado intangible."],
  ["c", "c) Inmovilizado material."],
  ["d", "d) Inversiones inmobiliarias."],
  ["e", "e) Otros activos financieros."],
  ["f", "f) Activos no corrientes mantenidos para venta."],
  ["g", "g) Otros activos."],
];

const DEBT_CLASSES: Array<[string, string]> = [
  ["1", "1. Obligaciones y otros valores negociables"],
  ["2", "2. Deudas con entidades de crédito"],
  ["3", "3. Deudas con empresas del grupo y asociadas"],
  ["4", "4. Otras deudas"],
];

const STRUCTURE: LineDef[] = [
  {
    id: "A", label: "A) FLUJOS DE EFECTIVO DE LAS ACTIVIDADES DE EXPLOTACIÓN", children: [
      { id: "A.1", label: "1. Resultado del ejercicio antes de impuestos." },
      {
        id: "A.2", label: "2. Ajustes del resultado.", children: [
          { id: "A.2.a", label: "a) Amortización del inmovilizado (+)." },
          { id: "A.2.b", label: "b) Correcciones valorativas por deterioro (+/-)." },
          { id: "A.2.c", label: "c) Variación de provisiones (+/-)." },
          { id: "A.2.d", label: "d) Imputación de subvenciones (-)." },
          { id: "A.2.e", label: "e) Resultados por bajas y enajenaciones del inmovilizado (+/-)." },
          { id: "A.2.f", label: "f) Resultados por bajas y enajenaciones de instrumentos financieros (+/-)." },
          { id: "A.2.g", label: "g) Ingresos financieros (-)." },
          { id: "A.2.h", label: "h) Gastos financieros (+)." },
          { id: "A.2.i", label: "i) Diferencias de cambio (+/-)." },
          { id: "A.2.j", label: "j) Variación de valor razonable en instrumentos financieros (+/-)." },
          { id: "A.2.k", label: "k) Otros ingresos y gastos (-/+)." },
        ],
      },
      {
        id: "A.3", label: "3. Cambios en el capital corriente.", children: [
          { id: "A.3.a", label: "a) Existencias (+/-)." },
          { id: "A.3.b", label: "b) Deudores y otras cuentas a cobrar (+/-)." },
          { id: "A.3.c", label: "c) Otros activos corrientes (+/-)." },
          { id: "A.3.d", label: "d) Acreedores y otras cuentas a pagar (+/-)." },
          { id: "A.3.e", label: "e) Otros pasivos corrientes (+/-)." },
          { id: "A.3.f", label: "f) Otros activos y pasivos no corrientes (+/-)." },
        ],
      },
      {
        id: "A.4", label: "4. Otros flujos de efectivo de las actividades de explotación.", children: [
          { id: "A.4.a", label: "a) Pagos de intereses (-)." },
          { id: "A.4.b", label: "b) Cobros de dividendos (+)." },
          { id: "A.4.c", label: "c) Cobros de intereses (+)." },
          { id: "A.4.d", label: "d) Cobros (pagos) por impuesto sobre beneficios (+/-)." },
          { id: "A.4.e", label: "e) Otros pagos (cobros) (-/+)." },
        ],
      },
    ],
  },
  { id: "A.5", label: "5. Flujos de efectivo de las actividades de explotación (+/-1 +/-2 +/-3 +/-4)", totalOf: ["A"] },
  {
    id: "B", label: "B) FLUJOS DE EFECTIVO DE LAS ACTIVIDADES DE INVERSIÓN", children: [
      { id: "B.6", label: "6. Pagos por inversiones (-).", children: INVESTMENT_CLASSES.map(([key, label]) => ({ id: `B.6.${key}`, label })) },
      { id: "B.7", label: "7. Cobros por desinversiones (+).", children: INVESTMENT_CLASSES.map(([key, label]) => ({ id: `B.7.${key}`, label })) },
    ],
  },
  { id: "B.8", label: "8. Flujos de efectivo de las actividades de inversión (7-6)", totalOf: ["B"] },
  {
    id: "C", label: "C) FLUJOS DE EFECTIVO DE LAS ACTIVIDADES DE FINANCIACIÓN", children: [
      {
        id: "C.9", label: "9. Cobros y pagos por instrumentos de patrimonio.", children: [
          { id: "C.9.a", label: "a) Emisión de instrumentos de patrimonio (+)." },
          { id: "C.9.b", label: "b) Amortización de instrumentos de patrimonio (-)." },
          { id: "C.9.c", label: "c) Adquisición de instrumentos de patrimonio propio (-)." },
          { id: "C.9.d", label: "d) Enajenación de instrumentos de patrimonio propio (+)." },
          { id: "C.9.e", label: "e) Subvenciones, donaciones y legados recibidos (+)." },
        ],
      },
      {
        id: "C.10", label: "10. Cobros y pagos por instrumentos de pasivo financiero.", children: [
          { id: "C.10.a", label: "a) Emisión", children: DEBT_CLASSES.map(([key, label]) => ({ id: `C.10.a.${key}`, label: `${label} (+).` })) },
          { id: "C.10.b", label: "b) Devolución y amortización de", children: DEBT_CLASSES.map(([key, label]) => ({ id: `C.10.b.${key}`, label: `${label} (-).` })) },
        ],
      },
      {
        id: "C.11", label: "11. Pagos por dividendos y remuneraciones de otros instrumentos de patrimonio.", children: [
          { id: "C.11.a", label: "a) Dividendos (-)." },
          { id: "C.11.b", label: "b) Remuneración de otros instrumentos de patrimonio (-)." },
        ],
      },
    ],
  },
  { id: "C.12", label: "12. Flujos de efectivo de las actividades de financiación (+/-9 +/-10 -11)", totalOf: ["C"] },
  { id: "D", label: "D) Efecto de las variaciones de los tipos de cambio" },
  { id: "X", label: "Diferencias sin clasificar (cuentas sin partida: revísalas)" },
  { id: "E", label: "E) AUMENTO/DISMINUCIÓN NETA DEL EFECTIVO O EQUIVALENTES (+/-5 +/-8 +/-12 +/-D)", totalOf: ["A", "B", "C", "D", "X"] },
  { id: "CASH.OPEN", label: "Efectivo o equivalentes al comienzo del ejercicio." },
  { id: "CASH.CLOSE", label: "Efectivo o equivalentes al final del ejercicio." },
];

/**
 * Destino de una cuenta de balance:
 * - `line`: la variación (cambiada de signo) va directa a esa partida;
 * - `invest`: clase de inversión; `role` dice si sus cargos son pagos (`gross`), si cuenta su
 *   variación neta como pago (`net`) o si solo suma al flujo neto de la clase (`other`);
 * - `debt`: clase de deuda (emisión o devolución según la variación neta);
 * - `equity`, `ownShares`, `grants`: instrumentos de patrimonio, acciones propias y subvenciones.
 */
type Target =
  | { kind: "line"; line: string }
  | { kind: "invest"; cls: string; role: "gross" | "net" | "other" }
  | { kind: "debt"; cls: string }
  | { kind: "equity" | "ownShares" | "grants" };

const line = (id: string): Target => ({ kind: "line", line: id });
const invest = (cls: string, role: "gross" | "net" | "other" = "gross"): Target => ({ kind: "invest", cls, role });
const debt = (cls: string): Target => ({ kind: "debt", cls });

const GROUP_INVESTMENTS = ["2403", "2404", "2413", "2414", "2423", "2424", "5303", "5304", "5313", "5314", "5323", "5324", "5333", "5334", "5343", "5344", "5353", "5354", "5393", "5394", "5523", "5524"];
const GROUP_INVESTMENT_CONTRAS = ["2493", "2494", "2933", "2934", "2943", "2944", "2953", "2954", "5933", "5934", "5943", "5944", "5953", "5954"];
const FINANCIAL_ASSETS = ["2405", "2415", "2425", "250", "251", "252", "253", "254", "255", "257", "258", "26", "5305", "5315", "5325", "5335", "5345", "5355", "5395", "540", "541", "542", "543", "545", "546", "547", "548", "5590", "5593", "565", "566", "5525"];
const FINANCIAL_ASSET_CONTRAS = ["2495", "259", "2935", "2936", "2945", "2955", "297", "298", "549", "5935", "5936", "5945", "5955", "597", "598", "133", "800", "802", "900", "902"];
/** Cuentas de doble naturaleza: con saldo final deudor son inversión; con saldo acreedor, deuda. */
const DUAL_ACCOUNTS = ["550", "551", "552", "553", "554"];

const BALANCE_TARGETS: Array<[string[], Target]> = [
  // Explotación: provisiones y capital corriente.
  [["14", "499", "529"], line("A.2.c")],
  [["30", "31", "32", "33", "34", "35", "36", "39", "407"], line("A.3.a")],
  [["430", "431", "432", "433", "434", "435", "436", "437", "44", "460", "470", "471", "472", "490", "493", "544"], line("A.3.b")],
  [["480", "567"], line("A.3.c")],
  [["400", "401", "403", "404", "405", "406", "41", "438", "465", "466", "475", "476", "477"], line("A.3.d")],
  [["485", "568"], line("A.3.e")],
  [["181"], line("A.3.f")],
  [["473", "474", "4752", "479", "830", "833", "834", "835", "836", "837", "838", "137"], line("A.4.d")],
  // Inversión.
  [GROUP_INVESTMENTS, invest("a")],
  [[...GROUP_INVESTMENT_CONTRAS, "891", "892", "991", "992", "993", "994"], invest("a", "other")],
  [["20"], invest("b")],
  [["280", "290"], invest("b", "other")],
  [["21"], invest("c")],
  [["23", "173", "523"], invest("c", "net")],
  [["281", "291"], invest("c", "other")],
  [["22"], invest("d")],
  [["282", "292"], invest("d", "other")],
  [FINANCIAL_ASSETS, invest("e")],
  [FINANCIAL_ASSET_CONTRAS, invest("e", "other")],
  [["580", "581", "582", "583", "584"], invest("f")],
  [["599", "585", "586", "587", "588", "589", "136", "86", "96"], invest("f", "other")],
  // Financiación.
  [["100", "101", "102", "103", "104", "110", "111", "112", "113", "114", "115", "118", "119", "120", "121", "129", "19", "526", "557", "5580", "5585"], { kind: "equity" }],
  [["108", "109"], { kind: "ownShares" }],
  [["130", "131", "132", "84", "94", "4708", "172", "522"], { kind: "grants" }],
  [["177", "178", "179", "500", "501", "502", "505", "506", "507", "509"], debt("1")],
  [["1605", "170", "5105", "520", "527"], debt("2")],
  [["1603", "1604", "1613", "1614", "1623", "1624", "1633", "1634", "5103", "5104", "5113", "5114", "5123", "5124", "5133", "5134", "5143", "5144", "5563", "5564"], debt("3")],
  [["15", "1615", "1625", "1635", "171", "174", "175", "176", "180", "185", "189", "5115", "5125", "5135", "5145", "521", "524", "525", "528", "555", "5565", "5566", "5595", "5598", "560", "561", "569"], debt("4")],
];

/**
 * Gastos e ingresos que se anulan en «Ajustes del resultado» y a dónde va su importe (la partida o
 * la clase donde está su contrapartida). Los no listados se quedan en el resultado.
 */
const INCOME_ADJUSTMENTS: Array<[string[], string, Target]> = [
  [["680", "690", "670", "770", "790"], "", invest("b", "other")],
  [["681", "691", "671", "771", "791"], "", invest("c", "other")],
  [["682", "692", "672", "772", "792"], "", invest("d", "other")],
  [["666", "667", "766"], "A.2.f", invest("e", "other")],
  [["673", "773"], "A.2.f", invest("a", "other")],
  [["675", "775"], "A.2.f", debt("1")],
  [["696", "697", "698", "699", "796", "797", "798", "799"], "A.2.b", invest("e", "other")],
  [["663", "763"], "A.2.j", invest("e", "other")],
  [["746", "747"], "A.2.d", { kind: "grants" }],
  [["760"], "A.2.g", line("A.4.b")],
  [["761", "762", "769"], "A.2.g", line("A.4.c")],
  [["660", "661", "662", "664", "665", "669"], "A.2.h", line("A.4.a")],
];
const ADJUSTMENT_TABLE = INCOME_ADJUSTMENTS.map(([prefixes, lineId, target]): [string[], { lineId: string; target: Target }] => [prefixes, { lineId, target }]);

/** Partida de ajuste de las amortizaciones, deterioros y bajas del inmovilizado no financiero. */
const FIXED_ASSET_ADJUSTMENT = (code: string) => (code.startsWith("68") ? "A.2.a" : code.startsWith("69") || code.startsWith("79") ? "A.2.b" : "A.2.e");

const INCOME_TAX = ["6300", "6301", "633", "638"];

const isIncomeAccount = (code: string) => code.startsWith("6") || code.startsWith("7");

function longestMatch<T>(table: Array<[string[], T]>, code: string): { prefix: string; value: T } | null {
  let best: { prefix: string; value: T } | null = null;
  for (const [prefixes, value] of table) {
    for (const prefix of prefixes) {
      if (code.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) best = { prefix, value };
    }
  }
  return best;
}

type Accumulator = {
  lines: Map<string, number>;
  invest: Map<string, { flow: number; payments: number }>;
  debt: Map<string, number>;
  equity: number;
  dividendsPaid: number;
  ownShares: number;
  unclassified: Array<{ code: string; name: string; cents: number }>;
};

function add(map: Map<string, number>, key: string, cents: number) {
  if (cents !== 0) map.set(key, (map.get(key) ?? 0) + cents);
}

function apply(acc: Accumulator, target: Target, cashCents: number, row: { debitCents: number; creditCents: number; code: string }) {
  switch (target.kind) {
    case "line":
      add(acc.lines, target.line, cashCents);
      return;
    case "invest": {
      const current = acc.invest.get(target.cls) ?? { flow: 0, payments: 0 };
      current.flow += cashCents;
      if (target.role === "gross") current.payments += row.debitCents;
      else if (target.role === "net") current.payments += -cashCents;
      acc.invest.set(target.cls, current);
      return;
    }
    case "debt":
      add(acc.debt, target.cls, cashCents);
      return;
    case "equity":
      acc.equity += cashCents;
      if (row.code.startsWith("526")) acc.dividendsPaid += row.debitCents;
      return;
    case "ownShares":
      acc.ownShares += cashCents;
      return;
    case "grants":
      add(acc.lines, "C.9.e", cashCents);
      return;
  }
}

/** Importes en céntimos de cada partida hoja de un ejercicio y su comprobación con el grupo 57. */
function computeYear(rows: StatementAccountRow[]): { leaves: Map<string, number>; check: Omit<CashFlowYear, "unclassifiedAccounts"> & { unclassifiedAccounts: Accumulator["unclassified"] } } {
  const acc: Accumulator = { lines: new Map(), invest: new Map(), debt: new Map(), equity: 0, dividendsPaid: 0, ownShares: 0, unclassified: [] };
  let openingCash = 0;
  let cashVariation = 0;

  for (const row of rows) {
    const net = row.debitCents - row.creditCents;
    if (row.code.startsWith("57")) {
      openingCash += row.priorCents;
      cashVariation += net;
      continue;
    }
    if (net === 0 && row.debitCents === 0) continue;
    const cash = -net;

    if (isIncomeAccount(row.code)) {
      if (INCOME_TAX.some((prefix) => row.code.startsWith(prefix))) {
        add(acc.lines, "A.4.d", cash);
        continue;
      }
      add(acc.lines, "A.1", cash);
      const adjustment = longestMatch(ADJUSTMENT_TABLE, row.code);
      if (adjustment) {
        add(acc.lines, adjustment.value.lineId || FIXED_ASSET_ADJUSTMENT(row.code), -cash);
        apply(acc, adjustment.value.target, cash, { debitCents: 0, creditCents: 0, code: row.code });
      }
      continue;
    }

    const closing = row.priorCents + net;
    let target: Target | null;
    if (DUAL_ACCOUNTS.some((prefix) => row.code.startsWith(prefix))) target = closing >= 0 ? invest("e") : debt("4");
    else target = longestMatch(BALANCE_TARGETS, row.code)?.value ?? null;
    if (!target) {
      if (cash !== 0) acc.unclassified.push({ code: row.code, name: row.name, cents: cash });
      continue;
    }
    apply(acc, target, cash, row);
  }

  const leaves = new Map(acc.lines);
  for (const [cls, { flow, payments }] of acc.invest) {
    // Pagos = cargos en el activo; cobros = lo que falta para el flujo neto. Si los cargos no
    // explican el flujo (traspasos, ajustes), se corrigen para que ningún importe cambie de signo.
    let paid = Math.max(payments, 0);
    let collected = flow + paid;
    if (collected < 0) {
      paid = -flow;
      collected = 0;
    }
    add(leaves, `B.6.${cls}`, -paid);
    add(leaves, `B.7.${cls}`, collected);
  }
  for (const [cls, flow] of acc.debt) add(leaves, flow >= 0 ? `C.10.a.${cls}` : `C.10.b.${cls}`, flow);
  add(leaves, "C.11.a", -acc.dividendsPaid);
  const equityRest = acc.equity + acc.dividendsPaid;
  add(leaves, equityRest >= 0 ? "C.9.a" : "C.9.b", equityRest);
  add(leaves, acc.ownShares >= 0 ? "C.9.d" : "C.9.c", acc.ownShares);

  let explained = 0;
  for (const cents of leaves.values()) explained += cents;
  const unclassified = cashVariation - explained;
  add(leaves, "X", unclassified);
  leaves.set("CASH.OPEN", openingCash);
  leaves.set("CASH.CLOSE", openingCash + cashVariation);
  return {
    leaves,
    check: { openingCash, closingCash: openingCash + cashVariation, cashVariation, explained, unclassified, unclassifiedAccounts: acc.unclassified },
  };
}

const euros = (cents: number) => Math.round(cents) / 100;

function cents(def: LineDef, leaves: Map<string, number>, byId: Map<string, LineDef>): number {
  if (def.totalOf) return def.totalOf.reduce((sum, id) => sum + cents(byId.get(id)!, leaves, byId), 0);
  if (def.children) return def.children.reduce((sum, child) => sum + cents(child, leaves, byId), 0);
  return leaves.get(def.id) ?? 0;
}

function index(defs: LineDef[], byId = new Map<string, LineDef>()) {
  for (const def of defs) {
    byId.set(def.id, def);
    if (def.children) index(def.children, byId);
  }
  return byId;
}

const BY_ID = index(STRUCTURE);

function flatten(defs: LineDef[], current: Map<string, number>, previous: Map<string, number> | null, depth: number, out: CashFlowLine[]) {
  for (const def of defs) {
    out.push({
      id: def.id,
      label: def.label,
      depth,
      kind: def.totalOf ? "total" : def.children ? "group" : "line",
      amount: euros(cents(def, current, BY_ID)),
      previous: previous ? euros(cents(def, previous, BY_ID)) : null,
    });
    if (def.children) flatten(def.children, current, previous, depth + 1, out);
  }
  return out;
}

const toYear = (check: ReturnType<typeof computeYear>["check"]): CashFlowYear => ({
  openingCash: euros(check.openingCash),
  closingCash: euros(check.closingCash),
  cashVariation: euros(check.cashVariation),
  explained: euros(check.explained),
  unclassified: euros(check.unclassified),
  unclassifiedAccounts: check.unclassifiedAccounts.map((account) => ({ code: account.code, name: account.name, amount: euros(account.cents) })).sort((a, b) => a.code.localeCompare(b.code)),
});

/**
 * Estado de flujos de efectivo del ejercicio (`rows`, las mismas filas que el balance: saldo previo y
 * movimientos del ejercicio completo) con la columna del anterior (`previousRows`). La línea de
 * diferencias sin clasificar solo aparece si alguno de los dos ejercicios la necesita.
 */
export function buildCashFlowStatement(rows: StatementAccountRow[], previousRows?: StatementAccountRow[] | null): CashFlowStatement {
  const current = computeYear(rows);
  const previous = previousRows ? computeYear(previousRows) : null;
  const lines = flatten(STRUCTURE, current.leaves, previous?.leaves ?? null, 0, [])
    .filter((entry) => entry.id !== "X" || entry.amount !== 0 || (entry.previous ?? 0) !== 0);
  return { lines, current: toYear(current.check), previous: previous ? toYear(previous.check) : null };
}

/** Prefijos de cuenta con partida (para comprobar la cobertura del cuadro de cuentas). */
export function cashFlowPrefixes() {
  return {
    balance: [...BALANCE_TARGETS.flatMap(([prefixes]) => prefixes), ...DUAL_ACCOUNTS, "57"],
  };
}

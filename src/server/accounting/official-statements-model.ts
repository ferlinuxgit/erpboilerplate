/**
 * Balance y cuenta de pérdidas y ganancias en el MODELO ABREVIADO del Plan General de Contabilidad
 * (Real Decreto 1514/2007, tercera parte, «Modelos abreviados de cuentas anuales»), funciones puras.
 *
 * El reparto de cuentas por epígrafe es el de la columna «N.º cuentas» del BOE (BOE-A-2007-19884,
 * texto consolidado con el RD 1/2021). Lo que el modelo oficial no prevé se indica en cada caso:
 * - 473 (retenciones y pagos a cuenta) solo tiene saldo durante el ejercicio: va con «Otros deudores».
 * - 2935/2936 y 5935/5936 (RD 1/2021) siguen a sus participaciones: fuera del grupo → inversiones financieras.
 * - 678/778 (gastos e ingresos excepcionales) y 774 → «Otros resultados», como en el modelo de PYMES.
 * - 5585 (desembolsos exigidos por acciones consideradas pasivo financiero) acompaña a la 5580.
 * - 550, 552, 553 y 554 se tratan como la 551: activo si el saldo es deudor y pasivo si es acreedor.
 * - Grupos 8 y 9 sin traspasar → ajustes por cambios de valor (84 y 94 → subvenciones).
 * - Cualquier otra cuenta se lleva, según su saldo, a «Otros deudores» u «Otras deudas a corto
 *   plazo» (resultados: «Otros resultados») y se devuelve en `unmapped` para avisar.
 *
 * Signos: el activo se muestra con saldo deudor en positivo; el patrimonio neto y el pasivo, con
 * saldo acreedor en positivo; en la cuenta de pérdidas y ganancias los ingresos son positivos y los
 * gastos negativos, igual que la columna «(Debe) Haber» del modelo.
 */

import type { StatementAccountRow } from "@/server/accounting/statements-model";

type Side = "asset" | "equityLiability" | "income";

type NodeDefinition = {
  id: string;
  label: string;
  /** Prefijos de cuenta del epígrafe. */
  accounts?: string[];
  /** Prefijos que solo entran aquí con saldo deudor (activo) o acreedor (pasivo). */
  bySign?: string[];
  children?: NodeDefinition[];
  /** Fila de total: suma de los epígrafes indicados (no tiene cuentas propias). */
  totalOf?: string[];
};

const ASSETS: NodeDefinition[] = [
  {
    id: "A", label: "A) ACTIVO NO CORRIENTE", children: [
      { id: "A.I", label: "I. Inmovilizado intangible", accounts: ["20", "280", "290"] },
      { id: "A.II", label: "II. Inmovilizado material", accounts: ["21", "281", "291", "23"] },
      { id: "A.III", label: "III. Inversiones inmobiliarias", accounts: ["22", "282", "292"] },
      { id: "A.IV", label: "IV. Inversiones en empresas del grupo y asociadas a largo plazo", accounts: ["2403", "2404", "2413", "2414", "2423", "2424", "2493", "2494", "2933", "2934", "2943", "2944", "2953", "2954"] },
      { id: "A.V", label: "V. Inversiones financieras a largo plazo", accounts: ["2405", "2415", "2425", "2495", "250", "251", "252", "253", "254", "255", "257", "258", "259", "26", "2935", "2936", "2945", "2955", "297", "298"] },
      { id: "A.VI", label: "VI. Activos por impuesto diferido", accounts: ["474"] },
    ],
  },
  {
    id: "B", label: "B) ACTIVO CORRIENTE", children: [
      { id: "B.I", label: "I. Activos no corrientes mantenidos para la venta", accounts: ["580", "581", "582", "583", "584", "599"] },
      { id: "B.II", label: "II. Existencias", accounts: ["30", "31", "32", "33", "34", "35", "36", "39", "407"] },
      {
        id: "B.III", label: "III. Deudores comerciales y otras cuentas a cobrar", children: [
          { id: "B.III.1", label: "1. Clientes por ventas y prestaciones de servicios", accounts: ["430", "431", "432", "433", "434", "435", "436", "437", "490", "493"] },
          { id: "B.III.2", label: "2. Accionistas (socios) por desembolsos exigidos", accounts: ["5580", "5585"] },
          { id: "B.III.3", label: "3. Otros deudores", accounts: ["44", "460", "470", "471", "472", "473", "544"] },
        ],
      },
      { id: "B.IV", label: "IV. Inversiones en empresas del grupo y asociadas a corto plazo", accounts: ["5303", "5304", "5313", "5314", "5323", "5324", "5333", "5334", "5343", "5344", "5353", "5354", "5393", "5394", "5933", "5934", "5943", "5944", "5953", "5954"], bySign: ["5523", "5524"] },
      { id: "B.V", label: "V. Inversiones financieras a corto plazo", accounts: ["5305", "5315", "5325", "5335", "5345", "5355", "5395", "540", "541", "542", "543", "545", "546", "547", "548", "549", "5590", "5593", "565", "566", "5935", "5936", "5945", "5955", "597", "598"], bySign: ["550", "551", "552", "553", "554", "5525"] },
      { id: "B.VI", label: "VI. Periodificaciones a corto plazo", accounts: ["480", "567"] },
      { id: "B.VII", label: "VII. Efectivo y otros activos líquidos equivalentes", accounts: ["57"] },
    ],
  },
  { id: "TOTAL_ACTIVO", label: "TOTAL ACTIVO (A + B)", totalOf: ["A", "B"] },
];

const EQUITY_AND_LIABILITIES: NodeDefinition[] = [
  {
    id: "PN", label: "A) PATRIMONIO NETO", children: [
      {
        id: "PN.1", label: "A-1) Fondos propios", children: [
          {
            id: "PN.1.I", label: "I. Capital", children: [
              { id: "PN.1.I.1", label: "1. Capital escriturado", accounts: ["100", "101", "102"] },
              { id: "PN.1.I.2", label: "2. (Capital no exigido)", accounts: ["1030", "1040"] },
            ],
          },
          { id: "PN.1.II", label: "II. Prima de emisión", accounts: ["110"] },
          { id: "PN.1.III", label: "III. Reservas", accounts: ["112", "113", "114", "115", "119"] },
          { id: "PN.1.IV", label: "IV. (Acciones y participaciones en patrimonio propias)", accounts: ["108", "109"] },
          { id: "PN.1.V", label: "V. Resultados de ejercicios anteriores", accounts: ["120", "121"] },
          { id: "PN.1.VI", label: "VI. Otras aportaciones de socios", accounts: ["118"] },
          { id: "PN.1.VII", label: "VII. Resultado del ejercicio", accounts: ["129"] },
          { id: "PN.1.VIII", label: "VIII. (Dividendo a cuenta)", accounts: ["557"] },
          { id: "PN.1.IX", label: "IX. Otros instrumentos de patrimonio neto", accounts: ["111"] },
        ],
      },
      { id: "PN.2", label: "A-2) Ajustes por cambios de valor", accounts: ["133", "134", "135", "136", "137", "8", "9"] },
      { id: "PN.3", label: "A-3) Subvenciones, donaciones y legados recibidos", accounts: ["130", "131", "132", "84", "94"] },
    ],
  },
  {
    id: "PNC", label: "B) PASIVO NO CORRIENTE", children: [
      { id: "PNC.I", label: "I. Provisiones a largo plazo", accounts: ["14"] },
      {
        id: "PNC.II", label: "II. Deudas a largo plazo", children: [
          { id: "PNC.II.1", label: "1. Deudas con entidades de crédito", accounts: ["1605", "170"] },
          { id: "PNC.II.2", label: "2. Acreedores por arrendamiento financiero", accounts: ["1625", "174"] },
          { id: "PNC.II.3", label: "3. Otras deudas a largo plazo", accounts: ["1615", "1635", "171", "172", "173", "175", "176", "177", "178", "179", "180", "185", "189", "15"] },
        ],
      },
      { id: "PNC.III", label: "III. Deudas con empresas del grupo y asociadas a largo plazo", accounts: ["1603", "1604", "1613", "1614", "1623", "1624", "1633", "1634"] },
      { id: "PNC.IV", label: "IV. Pasivos por impuesto diferido", accounts: ["479"] },
      { id: "PNC.V", label: "V. Periodificaciones a largo plazo", accounts: ["181"] },
    ],
  },
  {
    id: "PC", label: "C) PASIVO CORRIENTE", children: [
      { id: "PC.I", label: "I. Pasivos vinculados con activos no corrientes mantenidos para la venta", accounts: ["585", "586", "587", "588", "589"] },
      { id: "PC.II", label: "II. Provisiones a corto plazo", accounts: ["499", "529"] },
      {
        id: "PC.III", label: "III. Deudas a corto plazo", children: [
          { id: "PC.III.1", label: "1. Deudas con entidades de crédito", accounts: ["5105", "520", "527"] },
          { id: "PC.III.2", label: "2. Acreedores por arrendamiento financiero", accounts: ["5125", "524"] },
          { id: "PC.III.3", label: "3. Otras deudas a corto plazo", accounts: ["1034", "1044", "190", "192", "194", "195", "197", "199", "500", "501", "502", "505", "506", "507", "509", "5115", "5135", "5145", "521", "522", "523", "525", "526", "528", "555", "5565", "5566", "5595", "5598", "560", "561", "569"], bySign: ["550", "551", "552", "553", "554", "5525"] },
        ],
      },
      { id: "PC.IV", label: "IV. Deudas con empresas del grupo y asociadas a corto plazo", accounts: ["5103", "5104", "5113", "5114", "5123", "5124", "5133", "5134", "5143", "5144", "5563", "5564"], bySign: ["5523", "5524"] },
      {
        id: "PC.V", label: "V. Acreedores comerciales y otras cuentas a pagar", children: [
          { id: "PC.V.1", label: "1. Proveedores", accounts: ["400", "401", "403", "404", "405", "406"] },
          { id: "PC.V.2", label: "2. Otros acreedores", accounts: ["41", "438", "465", "466", "475", "476", "477"] },
        ],
      },
      { id: "PC.VI", label: "VI. Periodificaciones a corto plazo", accounts: ["485", "568"] },
    ],
  },
  { id: "TOTAL_PN_PASIVO", label: "TOTAL PATRIMONIO NETO Y PASIVO (A + B + C)", totalOf: ["PN", "PNC", "PC"] },
];

const OPERATING = ["PG.1", "PG.2", "PG.3", "PG.4", "PG.5", "PG.6", "PG.7", "PG.8", "PG.9", "PG.10", "PG.11", "PG.OTROS"];
const FINANCIAL = ["PG.12", "PG.13", "PG.14", "PG.15", "PG.16"];

const INCOME: NodeDefinition[] = [
  { id: "PG.1", label: "1. Importe neto de la cifra de negocios", accounts: ["700", "701", "702", "703", "704", "705", "706", "708", "709"] },
  { id: "PG.2", label: "2. Variación de existencias de productos terminados y en curso de fabricación", accounts: ["6930", "71", "7930"] },
  { id: "PG.3", label: "3. Trabajos realizados por la empresa para su activo", accounts: ["73"] },
  { id: "PG.4", label: "4. Aprovisionamientos", accounts: ["600", "601", "602", "606", "607", "608", "609", "61", "6931", "6932", "6933", "7931", "7932", "7933"] },
  { id: "PG.5", label: "5. Otros ingresos de explotación", accounts: ["740", "747", "75"] },
  { id: "PG.6", label: "6. Gastos de personal", accounts: ["64", "7950", "7957"] },
  { id: "PG.7", label: "7. Otros gastos de explotación", accounts: ["62", "631", "634", "636", "639", "65", "694", "695", "794", "7954"] },
  { id: "PG.8", label: "8. Amortización del inmovilizado", accounts: ["68"] },
  { id: "PG.9", label: "9. Imputación de subvenciones de inmovilizado no financiero y otras", accounts: ["746"] },
  { id: "PG.10", label: "10. Excesos de provisiones", accounts: ["7951", "7952", "7955", "7956"] },
  { id: "PG.11", label: "11. Deterioro y resultado por enajenaciones del inmovilizado", accounts: ["670", "671", "672", "690", "691", "692", "770", "771", "772", "790", "791", "792"] },
  { id: "PG.OTROS", label: "Otros resultados", accounts: ["678", "774", "778"] },
  { id: "PG.A", label: "A) RESULTADO DE EXPLOTACIÓN", totalOf: OPERATING },
  { id: "PG.12", label: "12. Ingresos financieros", accounts: ["760", "761", "762", "767", "769"] },
  { id: "PG.13", label: "13. Gastos financieros", accounts: ["660", "661", "662", "664", "665", "669"] },
  { id: "PG.14", label: "14. Variación de valor razonable en instrumentos financieros", accounts: ["663", "763"] },
  { id: "PG.15", label: "15. Diferencias de cambio", accounts: ["668", "768"] },
  { id: "PG.16", label: "16. Deterioro y resultado por enajenaciones de instrumentos financieros", accounts: ["666", "667", "673", "675", "696", "697", "698", "699", "766", "773", "775", "796", "797", "798", "799"] },
  { id: "PG.B", label: "B) RESULTADO FINANCIERO", totalOf: FINANCIAL },
  { id: "PG.C", label: "C) RESULTADO ANTES DE IMPUESTOS (A + B)", totalOf: [...OPERATING, ...FINANCIAL] },
  { id: "PG.17", label: "17. Impuestos sobre beneficios", accounts: ["6300", "6301", "633", "638"] },
  { id: "PG.D", label: "D) RESULTADO DEL EJERCICIO (C + 17)", totalOf: [...OPERATING, ...FINANCIAL, "PG.17"] },
];

/** Epígrafes a los que va lo que el modelo oficial no prevé. */
const FALLBACK = { asset: "B.III.3", equityLiability: "PC.III.3", income: "PG.OTROS" } as const;
const YEAR_RESULT_LINE = "PN.1.VII";
const PRIOR_RESULTS_LINE = "PN.1.V";

export type OfficialStatementAccount = { accountId: string; code: string; name: string; amount: number };

export type OfficialStatementLine = {
  id: string;
  label: string;
  /** Sangría: 0 para las masas (A, B…), 1, 2 y 3 para sus epígrafes. */
  depth: number;
  kind: "group" | "line" | "total";
  amount: number;
  /** Mismo epígrafe del ejercicio anterior; null si no se ha pedido comparativa. */
  previous: number | null;
  /** Cuentas que componen el epígrafe (vacío en grupos y totales). */
  accounts: OfficialStatementAccount[];
};

export type OfficialStatements = {
  assets: OfficialStatementLine[];
  equityAndLiabilities: OfficialStatementLine[];
  incomeStatement: OfficialStatementLine[];
  totals: { assets: number; equityAndLiabilities: number; result: number };
  /** Activo − (patrimonio neto + pasivo); distinto de 0 solo con el libro descuadrado. */
  difference: number;
  /** Cuentas con saldo que el modelo oficial no asigna a ningún epígrafe (van al de «otros»). */
  unmapped: Array<{ code: string; name: string }>;
};

type Rule = { prefix: string; lineId: string; side: Side; bySign: boolean };

function collectRules(nodes: NodeDefinition[], side: Side, rules: Rule[] = []) {
  for (const node of nodes) {
    for (const prefix of node.accounts ?? []) rules.push({ prefix, lineId: node.id, side, bySign: false });
    for (const prefix of node.bySign ?? []) rules.push({ prefix, lineId: node.id, side, bySign: true });
    if (node.children) collectRules(node.children, side, rules);
  }
  return rules;
}

const BALANCE_RULES = [...collectRules(ASSETS, "asset"), ...collectRules(EQUITY_AND_LIABILITIES, "equityLiability")];
const INCOME_RULES = collectRules(INCOME, "income");

/** Regla del prefijo más largo; con cuentas de doble naturaleza decide el signo del saldo. */
function matchRule(rules: Rule[], code: string, balanceCents: number): Rule | null {
  let best: Rule[] = [];
  for (const rule of rules) {
    if (!code.startsWith(rule.prefix)) continue;
    if (best.length === 0 || rule.prefix.length > best[0].prefix.length) best = [rule];
    else if (rule.prefix.length === best[0].prefix.length) best.push(rule);
  }
  if (best.length <= 1) return best[0] ?? null;
  const wanted: Side = balanceCents >= 0 ? "asset" : "equityLiability";
  return best.find((rule) => rule.side === wanted) ?? best[0];
}

type Bucket = { cents: number; accounts: Array<{ accountId: string; code: string; name: string; cents: number }> };

function addToBucket(buckets: Map<string, Bucket>, lineId: string, row: { accountId: string; code: string; name: string }, cents: number) {
  if (cents === 0) return;
  const bucket = buckets.get(lineId) ?? { cents: 0, accounts: [] };
  bucket.cents += cents;
  if (row.accountId) bucket.accounts.push({ accountId: row.accountId, code: row.code, name: row.name, cents });
  buckets.set(lineId, bucket);
}

const isIncomeAccount = (code: string) => code.startsWith("6") || code.startsWith("7");

function fillBuckets(rows: StatementAccountRow[]) {
  const buckets = new Map<string, Bucket>();
  const unmapped: Array<{ code: string; name: string }> = [];
  let yearResultCents = 0;
  let priorResultCents = 0;

  for (const row of rows) {
    const periodNet = row.debitCents - row.creditCents;
    const closing = row.priorCents + periodNet;

    if (isIncomeAccount(row.code)) {
      // Cuenta de pérdidas y ganancias: movimientos del periodo, ingresos en positivo.
      if (periodNet !== 0) {
        const rule = matchRule(INCOME_RULES, row.code, periodNet);
        if (!rule) unmapped.push({ code: row.code, name: row.name });
        addToBucket(buckets, rule?.lineId ?? FALLBACK.income, row, -periodNet);
      }
      // Balance: el resultado aún sin regularizar forma parte del patrimonio neto.
      yearResultCents += -row.yearToDateCents;
      priorResultCents += -(closing - row.yearToDateCents);
      continue;
    }

    if (closing === 0) continue;
    const rule = matchRule(BALANCE_RULES, row.code, closing);
    if (!rule) {
      unmapped.push({ code: row.code, name: row.name });
      if (closing > 0) addToBucket(buckets, FALLBACK.asset, row, closing);
      else addToBucket(buckets, FALLBACK.equityLiability, row, -closing);
      continue;
    }
    addToBucket(buckets, rule.lineId, row, rule.side === "asset" ? closing : -closing);
  }

  const synthetic = { accountId: "", code: "", name: "" };
  addToBucket(buckets, YEAR_RESULT_LINE, synthetic, yearResultCents);
  addToBucket(buckets, PRIOR_RESULTS_LINE, synthetic, priorResultCents);
  return { buckets, unmapped };
}

function nodeCents(node: NodeDefinition, buckets: Map<string, Bucket>, byId: Map<string, NodeDefinition>): number {
  if (node.totalOf) return node.totalOf.reduce((sum, id) => sum + nodeCents(byId.get(id)!, buckets, byId), 0);
  const own = buckets.get(node.id)?.cents ?? 0;
  return own + (node.children ?? []).reduce((sum, child) => sum + nodeCents(child, buckets, byId), 0);
}

function indexNodes(nodes: NodeDefinition[], byId = new Map<string, NodeDefinition>()) {
  for (const node of nodes) {
    byId.set(node.id, node);
    if (node.children) indexNodes(node.children, byId);
  }
  return byId;
}

const euros = (cents: number) => Math.round(cents) / 100;

function flatten(
  nodes: NodeDefinition[],
  current: Map<string, Bucket>,
  previous: Map<string, Bucket> | null,
  byId: Map<string, NodeDefinition>,
  depth = 0,
  lines: OfficialStatementLine[] = [],
) {
  for (const node of nodes) {
    lines.push({
      id: node.id,
      label: node.label,
      depth,
      kind: node.totalOf ? "total" : node.children ? "group" : "line",
      amount: euros(nodeCents(node, current, byId)),
      previous: previous ? euros(nodeCents(node, previous, byId)) : null,
      accounts: (current.get(node.id)?.accounts ?? [])
        .map((account) => ({ accountId: account.accountId, code: account.code, name: account.name, amount: euros(account.cents) }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    });
    if (node.children) flatten(node.children, current, previous, byId, depth + 1, lines);
  }
  return lines;
}

const ASSETS_BY_ID = indexNodes(ASSETS);
const EQUITY_AND_LIABILITIES_BY_ID = indexNodes(EQUITY_AND_LIABILITIES);
const INCOME_BY_ID = indexNodes(INCOME);

/**
 * Balance y cuenta de pérdidas y ganancias abreviados. `previousRows` (mismo periodo del ejercicio
 * anterior) rellena la columna comparativa que exige el modelo.
 */
export function buildOfficialStatements(rows: StatementAccountRow[], previousRows?: StatementAccountRow[] | null): OfficialStatements {
  const current = fillBuckets(rows);
  const previous = previousRows ? fillBuckets(previousRows).buckets : null;
  const assets = flatten(ASSETS, current.buckets, previous, ASSETS_BY_ID);
  const equityAndLiabilities = flatten(EQUITY_AND_LIABILITIES, current.buckets, previous, EQUITY_AND_LIABILITIES_BY_ID);
  const incomeStatement = flatten(INCOME, current.buckets, previous, INCOME_BY_ID);
  const amountOf = (lines: OfficialStatementLine[], id: string) => lines.find((line) => line.id === id)?.amount ?? 0;
  const totalAssets = amountOf(assets, "TOTAL_ACTIVO");
  const totalEquityAndLiabilities = amountOf(equityAndLiabilities, "TOTAL_PN_PASIVO");
  const seen = new Set<string>();
  return {
    assets,
    equityAndLiabilities,
    incomeStatement,
    totals: { assets: totalAssets, equityAndLiabilities: totalEquityAndLiabilities, result: amountOf(incomeStatement, "PG.D") },
    difference: Math.round((totalAssets - totalEquityAndLiabilities) * 100) / 100,
    unmapped: current.unmapped
      .filter((account) => (seen.has(account.code) ? false : (seen.add(account.code), true)))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}

/** Prefijos de cuenta que el modelo abreviado asigna a algún epígrafe (para comprobar la cobertura del plan). */
export function officialStatementPrefixes() {
  return { balance: BALANCE_RULES.map((rule) => rule.prefix), income: INCOME_RULES.map((rule) => rule.prefix) };
}

/**
 * Tipos compartidos (servidor y cliente) del plan contable jerárquico: nodos del árbol con sus
 * sumas del periodo, filtros, estado de la URL y ficha de cuenta. Importes en céntimos enteros.
 */

export type ChartAccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" | "MIXED";
export type ChartNature = "DEBIT" | "CREDIT" | "MIXED";

export type ChartNode = {
  id: string;
  code: string;
  name: string;
  type: ChartAccountType;
  nature: ChartNature;
  /** Cuenta padre en el árbol (null = raíz). */
  parentCode: string | null;
  /** Nivel por dígitos (longitud del código). */
  level: number;
  isPostable: boolean;
  isBlocked: boolean;
  partnerId: string | null;
  partnerName: string | null;
  partnerTaxId: string | null;
  openingCents: number;
  debitCents: number;
  creditCents: number;
  /** Saldo final: inicial + debe − haber (positivo deudor, negativo acreedor). */
  balanceCents: number;
  /** Apuntes del periodo (la cuenta y todas las que empiezan por su código). */
  entries: number;
  childCount: number;
  hasMovements: boolean;
};

export const CHART_FILTER_KEYS = ["movements", "nonzero", "partners", "blocked"] as const;
export type ChartFilterKey = (typeof CHART_FILTER_KEYS)[number];
export type ChartFilters = Readonly<Record<ChartFilterKey, boolean>>;

export const CHART_FILTER_LABELS: Record<ChartFilterKey, string> = {
  movements: "Con movimientos",
  nonzero: "Ocultar saldo 0",
  partners: "Terceros (400/410/430)",
  blocked: "Bloqueadas",
};

/** Niveles del selector: 1–4 dígitos o todas las subcuentas. */
export const CHART_LEVELS = ["1", "2", "3", "4", "sub"] as const;
export type ChartLevel = (typeof CHART_LEVELS)[number];

export type ChartView = "tree" | "list" | "scheme";
export type ChartDensity = "compact" | "comfortable";

export type ChartTreeResponse = {
  nodes: ChartNode[];
  /** Cuentas cuyos hijos vienen completos en `nodes` ("" = raíz). */
  loadedParents: string[];
  /** Coincidencias de la búsqueda, en orden de código. */
  matchCodes: string[];
  /** La búsqueda tenía más coincidencias de las devueltas. */
  truncated: boolean;
  range: { from: string; to: string };
  subaccountLength: number;
};

export type ChartPeriodOption = { key: string; label: string; from: string; to: string };

export type ChartFiscalYearOption = {
  id: string;
  code: string;
  isClosed: boolean;
  from: string;
  to: string;
  periods: ChartPeriodOption[];
};

export type AccountSummaryLine = {
  lineId: string;
  entryId: string;
  number: string;
  postedAt: string;
  accountId: string;
  accountCode: string;
  concept: string | null;
  reference: string | null;
  documentType: string | null;
  documentNumber: string | null;
  partnerName: string | null;
  debitCents: number;
  creditCents: number;
};

export type AccountMonthlySeries = {
  label: string;
  debitCents: number[];
  creditCents: number[];
  /** Saldo acumulado a final de cada mes. */
  balanceCents: number[];
};

export type AccountSummary = {
  account: {
    id: string;
    code: string;
    name: string;
    type: ChartAccountType;
    nature: ChartNature;
    level: number;
    isPostable: boolean;
    isBlocked: boolean;
    parentCode: string | null;
  };
  path: Array<{ id: string; code: string; name: string }>;
  partner: { id: string; name: string; taxId: string | null; href: string | null } | null;
  totals: { openingCents: number; debitCents: number; creditCents: number; balanceCents: number; entries: number };
  months: Array<{ key: string; label: string; longLabel: string }>;
  current: AccountMonthlySeries;
  previous: AccountMonthlySeries | null;
  lastLines: AccountSummaryLine[];
  childCount: number;
  /** Siguiente subcuenta libre para «Crear subcuenta aquí» (null si no procede). */
  nextSubaccountCode: string | null;
  range: { from: string; to: string };
};

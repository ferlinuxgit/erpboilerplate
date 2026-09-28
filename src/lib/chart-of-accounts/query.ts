import {
  CHART_FILTER_KEYS,
  CHART_LEVELS,
  type ChartDensity,
  type ChartFilters,
  type ChartLevel,
  type ChartView,
} from "@/lib/chart-of-accounts/types";

/**
 * Estado de la pantalla del plan contable en la URL (?view=&level=&q=&fy=&from=&to=&sel=&f=&density=),
 * para que el botón Atrás y los enlaces compartidos vuelvan a la misma vista.
 */
export type ChartUrlState = {
  view: ChartView;
  level: ChartLevel;
  q: string;
  fy: string | null;
  from: string | null;
  to: string | null;
  sel: string | null;
  filters: ChartFilters;
  density: ChartDensity;
};

export const DEFAULT_CHART_LEVEL: ChartLevel = "2";
export const NO_CHART_FILTERS: ChartFilters = { movements: false, nonzero: false, partners: false, blocked: false };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

type SearchParamsLike = { get(name: string): string | null };
type ParamSource = SearchParamsLike | Record<string, string | string[] | undefined>;

function isSearchParamsLike(source: ParamSource): source is SearchParamsLike {
  return typeof source.get === "function";
}

function read(source: ParamSource, name: string): string | null {
  if (isSearchParamsLike(source)) return source.get(name);
  const value = source[name];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export function parseChartFilters(value: string | null | undefined): ChartFilters {
  const keys = new Set((value ?? "").split(",").map((entry) => entry.trim()));
  return { movements: keys.has("movements"), nonzero: keys.has("nonzero"), partners: keys.has("partners"), blocked: keys.has("blocked") };
}

export function serializeChartFilters(filters: ChartFilters): string {
  return CHART_FILTER_KEYS.filter((key) => filters[key]).join(",");
}

export function hasActiveFilters(filters: ChartFilters) {
  return CHART_FILTER_KEYS.some((key) => filters[key]);
}

export function parseChartLevel(value: string | null | undefined): ChartLevel {
  return CHART_LEVELS.find((level) => level === value) ?? DEFAULT_CHART_LEVEL;
}

/** Nivel → longitud máxima de código que se despliega (null = todas las subcuentas). */
export function chartLevelDepth(level: ChartLevel): number | null {
  return level === "sub" ? null : Number(level);
}

export function parseDateKey(value: string | null | undefined): string | null {
  if (!value || !DATE_KEY.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

export function parseChartUrlState(source: ParamSource): ChartUrlState {
  const view = read(source, "view");
  return {
    view: view === "list" || view === "scheme" ? view : "tree",
    level: parseChartLevel(read(source, "level")),
    q: (read(source, "q") ?? "").slice(0, 100),
    fy: read(source, "fy") || null,
    from: parseDateKey(read(source, "from")),
    to: parseDateKey(read(source, "to")),
    sel: read(source, "sel") || null,
    filters: parseChartFilters(read(source, "f")),
    density: read(source, "density") === "comfortable" ? "comfortable" : "compact",
  };
}

/** Query string sin los valores por defecto (URL corta y estable). */
export function serializeChartUrlState(state: ChartUrlState): string {
  const params = new URLSearchParams();
  if (state.view !== "tree") params.set("view", state.view);
  if (state.level !== DEFAULT_CHART_LEVEL) params.set("level", state.level);
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.fy) params.set("fy", state.fy);
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  if (state.sel) params.set("sel", state.sel);
  const filters = serializeChartFilters(state.filters);
  if (filters) params.set("f", filters);
  if (state.density !== "compact") params.set("density", state.density);
  return params.toString();
}

/** Parámetros de la API del árbol para un periodo y unos filtros. */
export function chartApiParams(input: { fy: string | null; from: string | null; to: string | null; filters: ChartFilters }) {
  const params = new URLSearchParams();
  if (input.fy) params.set("fy", input.fy);
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  const filters = serializeChartFilters(input.filters);
  if (filters) params.set("f", filters);
  return params;
}

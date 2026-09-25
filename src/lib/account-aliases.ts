/**
 * Búsqueda de cuentas contables en lenguaje llano.
 *
 * Quien no es contable busca "luz", "alquiler" o "gestor", no "628" ni "Suministros".
 * Este módulo (sin dependencias de servidor, usable en cliente y servidor) traduce esas
 * palabras a cuentas del PGC y ordena los resultados para el selector de cuentas y para
 * la sugerencia automática del OCR local.
 */

export type AccountOption = { id: string; code: string; name: string };

export type AccountAlias = {
  /** Cuenta del PGC (o prefijo: también casa con subcuentas como 6280001). */
  code: string;
  /** Palabras que un usuario escribiría para buscar la cuenta. */
  terms: readonly string[];
  /**
   * Palabras suficientemente inequívocas para sugerir la cuenta leyendo el texto de una
   * factura (OCR). Deben ser específicas: una coincidencia aquí propone la cuenta.
   */
  documentKeywords?: readonly string[];
};

export const ACCOUNT_ALIASES: readonly AccountAlias[] = [
  { code: "600", terms: ["compras", "compras mercaderias", "mercaderia", "mercancia", "genero", "productos para vender", "reventa"] },
  { code: "601", terms: ["materias primas", "materia prima"] },
  {
    code: "602",
    terms: ["otros aprovisionamientos", "envases", "embalajes", "material de oficina almacenado", "repuestos", "combustibles almacenados"],
  },
  { code: "607", terms: ["subcontratacion", "trabajos de otras empresas", "subcontrata"] },
  {
    code: "621",
    terms: ["alquiler", "alquileres", "arrendamiento", "renta local", "local", "oficina alquiler", "leasing operativo", "renting", "canon", "coworking"],
    documentKeywords: ["alquiler", "arrendamiento", "renting", "coworking"],
  },
  {
    code: "622",
    terms: ["reparaciones", "reparacion", "mantenimiento", "conservacion", "averia", "taller", "fontanero", "electricista", "limpieza"],
    documentKeywords: ["reparacion", "mantenimiento", "taller"],
  },
  {
    code: "623",
    terms: ["asesoria", "asesor", "gestor", "gestoria", "abogado", "notario", "notaria", "registro", "profesionales", "consultoria", "auditoria", "honorarios", "freelance"],
    documentKeywords: ["asesoria", "gestoria", "honorarios", "notaria", "abogados", "consultoria"],
  },
  {
    code: "624",
    terms: ["transporte", "transportes", "mensajeria", "envio", "envios", "portes", "paqueteria", "correos", "flete"],
    documentKeywords: ["mensajeria", "paqueteria", "portes", "transporte"],
  },
  {
    code: "625",
    terms: ["seguros", "seguro", "poliza", "prima de seguro", "aseguradora"],
    documentKeywords: ["poliza", "aseguradora", "seguro"],
  },
  {
    code: "626",
    terms: ["comisiones bancarias", "comision bancaria", "banco", "comisiones", "gastos bancarios", "mantenimiento cuenta", "tpv"],
    documentKeywords: ["comision bancaria", "comisiones bancarias"],
  },
  {
    code: "627",
    terms: ["publicidad", "marketing", "anuncios", "propaganda", "google ads", "redes sociales", "relaciones publicas", "regalos clientes"],
    documentKeywords: ["publicidad", "anuncios", "google ads", "facebook ads", "meta ads"],
  },
  {
    code: "628",
    terms: [
      "suministros", "luz", "electricidad", "agua", "gas", "telefono", "movil", "internet", "fibra",
      "gasolina", "gasoil", "diesel", "combustible", "carburante", "energia",
    ],
    documentKeywords: [
      "electricidad", "energia electrica", "kwh", "suministro de agua", "gas natural", "gasolina", "gasoil", "gasoleo",
      "diesel", "carburante", "combustible", "telefonia", "fibra optica", "movistar", "vodafone", "orange", "iberdrola", "endesa", "naturgy",
      "repsol", "cepsa",
    ],
  },
  {
    code: "629",
    terms: [
      "otros servicios", "material de oficina", "papeleria", "oficina", "viajes", "dietas", "hotel", "parking",
      "peajes", "software", "suscripcion", "suscripciones", "hosting", "dominio", "formacion",
    ],
    documentKeywords: ["papeleria", "material de oficina", "hotel", "parking", "peaje", "suscripcion", "hosting"],
  },
  { code: "631", terms: ["tributos", "impuestos", "ibi", "iae", "tasas", "basuras", "impuesto circulacion", "ivtm"] },
  { code: "640", terms: ["sueldos", "salarios", "nominas", "nomina", "sueldo"] },
  { code: "641", terms: ["indemnizaciones", "despido", "finiquito"] },
  { code: "642", terms: ["seguridad social", "cotizaciones", "seguros sociales", "cuota empresa"] },
  { code: "649", terms: ["otros gastos sociales", "formacion empleados", "comida empresa"] },
  { code: "650", terms: ["impagados", "incobrables", "clientes morosos"] },
  { code: "662", terms: ["intereses", "intereses prestamo", "prestamo", "hipoteca"] },
  { code: "669", terms: ["otros gastos financieros", "gastos financieros"] },
  { code: "678", terms: ["gastos excepcionales", "multas", "sanciones", "recargos"] },
  { code: "680", terms: ["amortizacion intangible", "amortizacion software"] },
  { code: "681", terms: ["amortizacion", "amortizaciones", "amortizacion inmovilizado", "depreciacion"] },
];

/** Minúsculas, sin tildes ni signos, espacios simples: "Teléfono  Móvil" → "telefono movil". */
export function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es-ES")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

function aliasMatchesCode(aliasCode: string, accountCode: string) {
  return accountCode === aliasCode || accountCode.startsWith(aliasCode);
}

/** Palabras llanas asociadas a una cuenta (para enseñarlas como ayuda junto al nombre). */
export function aliasTermsForCode(code: string) {
  return ACCOUNT_ALIASES.filter((alias) => aliasMatchesCode(alias.code, code)).flatMap((alias) => alias.terms);
}

export type RankedAccountGroup = "suggested" | "recent" | "match" | "all";

export type RankedAccount = AccountOption & {
  score: number;
  group: RankedAccountGroup;
  /** Palabra llana que ha hecho coincidir la cuenta (p. ej. "luz" para 628). */
  matchedAlias?: string;
};

type RankOptions = {
  recentIds?: readonly string[];
  suggestedIds?: readonly string[];
  limit?: number;
};

function textScore(account: AccountOption, query: string): { score: number; matchedAlias?: string } {
  const code = account.code.toLocaleLowerCase("es-ES");
  const name = normalizeSearchText(account.name);
  if (code === query) return { score: 1000 };
  if (/^\d+$/.test(query) && code.startsWith(query)) return { score: 900 - (code.length - query.length) };

  let best: { score: number; matchedAlias?: string } = { score: 0 };
  const consider = (score: number, matchedAlias?: string) => {
    if (score > best.score) best = { score, matchedAlias };
  };

  for (const alias of ACCOUNT_ALIASES) {
    if (!aliasMatchesCode(alias.code, account.code)) continue;
    for (const term of alias.terms) {
      if (term === query) consider(800, term);
      else if (term.startsWith(query) && query.length >= 2) consider(720 - Math.min(term.length - query.length, 40), term);
      else if (query.startsWith(`${term} `) || query.endsWith(` ${term}`)) consider(680, term);
      else if (query.length >= 3 && term.includes(query)) consider(600, term);
    }
  }

  if (name === query) consider(780);
  else if (name.startsWith(query)) consider(560);
  else if (name.split(" ").some((word) => word.startsWith(query))) consider(520);
  else if (query.length >= 3 && name.includes(query)) consider(440);

  if (best.score === 0) {
    // Consultas de varias palabras ("material oficina"): todas deben aparecer en nombre o alias.
    const tokens = query.split(" ").filter((token) => token.length >= 2);
    if (tokens.length > 1) {
      const haystack = [name, code, ...aliasTermsForCode(account.code)].join(" ");
      if (tokens.every((token) => haystack.includes(token))) consider(360);
    }
  }
  return best;
}

/**
 * Ordena cuentas para el selector. Sin texto: sugeridas, recientes y el resto por código.
 * Con texto: código exacto > prefijo de código > alias llano > nombre; las sugeridas y
 * recientes ganan un pequeño empuje para desempatar.
 */
export function rankAccounts(accounts: readonly AccountOption[], rawQuery: string, options: RankOptions = {}): RankedAccount[] {
  const query = normalizeSearchText(rawQuery);
  const suggested = new Set(options.suggestedIds ?? []);
  const recentOrder = new Map((options.recentIds ?? []).map((id, index) => [id, index]));
  const limit = options.limit ?? 60;

  if (!query) {
    const groupOf = (account: AccountOption): RankedAccountGroup =>
      suggested.has(account.id) ? "suggested" : recentOrder.has(account.id) ? "recent" : "all";
    const weight = { suggested: 0, recent: 1, match: 2, all: 2 } as const;
    return [...accounts]
      .map((account) => ({ ...account, score: 0, group: groupOf(account) }))
      .sort((left, right) =>
        weight[left.group] - weight[right.group] ||
        (recentOrder.get(left.id) ?? 0) - (recentOrder.get(right.id) ?? 0) ||
        left.code.localeCompare(right.code, "es-ES", { numeric: true }))
      .slice(0, limit);
  }

  return accounts
    .map((account) => {
      const { score, matchedAlias } = textScore(account, query);
      if (score === 0) return null;
      const boost = (suggested.has(account.id) ? 50 : 0) + (recentOrder.has(account.id) ? 25 : 0);
      const ranked: RankedAccount = { ...account, score: score + boost, group: "match", matchedAlias };
      return ranked;
    })
    .filter((account): account is RankedAccount => account !== null)
    .sort((left, right) => right.score - left.score || left.code.localeCompare(right.code, "es-ES", { numeric: true }))
    .slice(0, limit);
}

/**
 * Cuenta de la empresa para un código sugerido (por la IA, el OCR o una plantilla).
 * Acepta el código exacto, una subcuenta del código (628 → 6280001) o, si la sugerencia
 * viene más detallada que el plan de la empresa, su prefijo de 3 dígitos (6280001 → 628).
 */
export function findAccountForCode<T extends AccountOption>(accounts: readonly T[], code: string | null | undefined): T | undefined {
  const wanted = code?.trim();
  if (!wanted || !/^\d{2,}$/.test(wanted)) return undefined;
  const exact = accounts.find((account) => account.code === wanted);
  if (exact) return exact;
  const sorted = [...accounts].sort((left, right) => left.code.localeCompare(right.code, "es-ES", { numeric: true }));
  const child = sorted.find((account) => account.code.startsWith(wanted));
  if (child) return child;
  for (let length = wanted.length - 1; length >= 3; length -= 1) {
    const parent = accounts.find((account) => account.code === wanted.slice(0, length));
    if (parent) return parent;
  }
  return undefined;
}

/**
 * Sugiere una cuenta de gasto leyendo el texto de un documento. Solo responde cuando una
 * única cuenta tiene más coincidencias que las demás: ante la duda no sugiere nada y la
 * factura queda marcada para revisar la cuenta.
 */
export function suggestAccountCodeFromText(text: string | null | undefined): string | undefined {
  const normalized = ` ${normalizeSearchText(text)} `;
  if (normalized.trim().length === 0) return undefined;
  const hits = ACCOUNT_ALIASES
    .map((alias) => ({
      code: alias.code,
      count: (alias.documentKeywords ?? []).filter((keyword) => normalized.includes(` ${keyword} `)).length,
    }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count);
  if (hits.length === 0) return undefined;
  if (hits.length > 1 && hits[0].count === hits[1].count) return undefined;
  return hits[0].code;
}

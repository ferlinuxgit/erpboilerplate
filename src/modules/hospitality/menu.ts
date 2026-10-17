/**
 * Carta digital: alérgenos oficiales, etiquetas, horario de cada sección, filtros y textos de la
 * carta pública en español e inglés. Puro, sin base de datos.
 */

/** Los 14 alérgenos de declaración obligatoria (Reglamento UE 1169/2011, anexo II). */
// Cada alérgeno con su color (icono blanco sobre círculo de color, contraste ≥ 3:1) para
// reconocerlo de un vistazo, como en las tablas de alérgenos de las cocinas.
export const ALLERGENS = [
  { id: "GLUTEN", es: "Gluten", en: "Gluten", icon: "🌾", color: "#b45309" },
  { id: "CRUSTACEANS", es: "Crustáceos", en: "Crustaceans", icon: "🦐", color: "#0e7490" },
  { id: "EGGS", es: "Huevos", en: "Eggs", icon: "🥚", color: "#c2410c" },
  { id: "FISH", es: "Pescado", en: "Fish", icon: "🐟", color: "#1d4ed8" },
  { id: "PEANUTS", es: "Cacahuetes", en: "Peanuts", icon: "🥜", color: "#92400e" },
  { id: "SOY", es: "Soja", en: "Soy", icon: "🫘", color: "#4d7c0f" },
  { id: "MILK", es: "Lácteos", en: "Milk", icon: "🥛", color: "#0369a1" },
  { id: "NUTS", es: "Frutos de cáscara", en: "Tree nuts", icon: "🌰", color: "#7c2d12" },
  { id: "CELERY", es: "Apio", en: "Celery", icon: "🥬", color: "#15803d" },
  { id: "MUSTARD", es: "Mostaza", en: "Mustard", icon: "🟡", color: "#a16207" },
  { id: "SESAME", es: "Sésamo", en: "Sesame", icon: "⚪", color: "#57534e" },
  { id: "SULPHITES", es: "Sulfitos", en: "Sulphites", icon: "🍷", color: "#7e22ce" },
  { id: "LUPIN", es: "Altramuces", en: "Lupin", icon: "🌼", color: "#be185d" },
  { id: "MOLLUSCS", es: "Moluscos", en: "Molluscs", icon: "🐚", color: "#0f766e" },
] as const;
export type AllergenId = (typeof ALLERGENS)[number]["id"];
export const ALLERGEN_IDS = ALLERGENS.map((allergen) => allergen.id) as AllergenId[];

// Dietas primero (son lo que más se busca), luego destacados.
export const MENU_TAGS = [
  { id: "VEGAN", es: "Vegano", en: "Vegan", icon: "🌱", color: "#15803d", diet: true },
  { id: "VEGETARIAN", es: "Vegetariano", en: "Vegetarian", icon: "🥕", color: "#4d7c0f", diet: true },
  { id: "GLUTEN_FREE", es: "Apto celíacos", en: "Gluten free", icon: "🚫🌾", color: "#b45309", diet: true },
  { id: "LACTOSE_FREE", es: "Sin lactosa", en: "Lactose free", icon: "🚫🥛", color: "#0369a1", diet: true },
  { id: "PREGNANCY_SAFE", es: "Apto embarazadas", en: "Pregnancy safe", icon: "🤰", color: "#be185d", diet: true },
  { id: "PASTEURIZED", es: "Pasteurizado", en: "Pasteurised", icon: "🌡️", color: "#4338ca", diet: true },
  { id: "SPICY", es: "Picante", en: "Spicy", icon: "🌶️", color: "#b91c1c", diet: false },
  { id: "RECOMMENDED", es: "Recomendado", en: "Chef's pick", icon: "⭐", color: "#a16207", diet: false },
  { id: "NEW", es: "Novedad", en: "New", icon: "✨", color: "#7e22ce", diet: false },
] as const;
export type MenuTagId = (typeof MENU_TAGS)[number]["id"];
export const MENU_TAG_IDS = MENU_TAGS.map((tag) => tag.id) as MenuTagId[];

const ANIMAL: readonly string[] = ["FISH", "CRUSTACEANS", "MOLLUSCS"];

/** Incoherencias entre alérgenos y dietas (p. ej. «vegano» con huevo), para avisar al rellenar la ficha. */
export function dietConflicts(allergens: readonly string[], tags: readonly string[], traces: readonly string[] = []) {
  const names = (ids: readonly string[]) => ids.map((id) => ALLERGENS.find((allergen) => allergen.id === id)?.es.toLowerCase() ?? id).join(", ");
  const conflicts: string[] = [];
  const animal = allergens.filter((id) => ANIMAL.includes(id));
  const nonVegan = allergens.filter((id) => [...ANIMAL, "EGGS", "MILK"].includes(id));
  if (tags.includes("VEGAN") && nonVegan.length > 0) conflicts.push(`Marcado vegano pero lleva ${names(nonVegan)}.`);
  if (tags.includes("VEGETARIAN") && animal.length > 0) conflicts.push(`Marcado vegetariano pero lleva ${names(animal)}.`);
  if (tags.includes("GLUTEN_FREE") && allergens.includes("GLUTEN")) conflicts.push("Marcado apto celíacos pero lleva gluten.");
  if (tags.includes("GLUTEN_FREE") && traces.includes("GLUTEN")) conflicts.push("Marcado apto celíacos pero puede contener trazas de gluten.");
  // Embarazo: lácteos y huevo solo si están pasteurizados (riesgo de listeria y salmonela).
  const raw = allergens.filter((id) => id === "MILK" || id === "EGGS");
  if (tags.includes("PREGNANCY_SAFE") && raw.length > 0 && !tags.includes("PASTEURIZED")) conflicts.push(`Marcado apto embarazadas con ${names(raw)}: confirma que están pasteurizados y márcalo como «Pasteurizado».`);
  if (tags.includes("LACTOSE_FREE") && allergens.includes("MILK")) conflicts.push("Marcado sin lactosa pero lleva lácteos: revisa si es leche sin lactosa (sigue siendo alérgeno de la leche).");
  return conflicts;
}

/** Qué hay en un plato de lo que el cliente no puede tomar. */
export function dishWarnings(dish: { allergens: readonly string[]; traces?: readonly string[] }, avoid: readonly string[]) {
  return { contains: avoid.filter((id) => dish.allergens.includes(id)), traces: avoid.filter((id) => !dish.allergens.includes(id) && (dish.traces ?? []).includes(id)) };
}

export type MenuLang = "es" | "en";

export function pickLang(acceptLanguage: string | null | undefined, requested?: string | null): MenuLang {
  if (requested === "es" || requested === "en") return requested;
  const first = (acceptLanguage ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  return first && !first.startsWith("es") && !first.startsWith("ca") && !first.startsWith("gl") && !first.startsWith("eu") ? "en" : "es";
}

/** Texto en el idioma pedido, con el español como respaldo. */
export function localized(es: string | null | undefined, en: string | null | undefined, lang: MenuLang) {
  return (lang === "en" && en?.trim() ? en : es)?.trim() || null;
}

export type SectionSchedule = { weekdays: readonly number[]; fromTime: string | null; toTime: string | null };

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** ¿Se sirve ahora? Admite franjas que pasan de medianoche (20:00–02:00 cuenta como el día de inicio). */
export function isSectionAvailable(schedule: SectionSchedule, now: { weekday: number; time: string }) {
  const days = schedule.weekdays;
  const hasWindow = Boolean(schedule.fromTime && schedule.toTime);
  if (!hasWindow) return days.length === 0 || days.includes(now.weekday);
  const from = minutes(schedule.fromTime!);
  const to = minutes(schedule.toTime!);
  const current = minutes(now.time);
  const dayOk = (weekday: number) => days.length === 0 || days.includes(weekday);
  if (from <= to) return dayOk(now.weekday) && current >= from && current < to;
  // Franja nocturna: hoy desde «from» o, de madrugada, la franja que empezó ayer.
  return (dayOk(now.weekday) && current >= from) || (dayOk((now.weekday + 6) % 7) && current < to);
}

const WEEKDAY_SHORT: Record<MenuLang, string[]> = {
  es: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

/** «lun–vie · 13:00–16:00» o null si se sirve siempre. */
export function scheduleLabel(schedule: SectionSchedule, lang: MenuLang) {
  const parts: string[] = [];
  const days = [...new Set(schedule.weekdays)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (days.length > 0 && days.length < 7) {
    const order = days.map((day) => (day + 6) % 7);
    const consecutive = order.every((value, index) => index === 0 || value === order[index - 1] + 1);
    parts.push(consecutive && days.length > 2 ? `${WEEKDAY_SHORT[lang][days[0]]}–${WEEKDAY_SHORT[lang][days.at(-1)!]}` : days.map((day) => WEEKDAY_SHORT[lang][day]).join(", "));
  }
  if (schedule.fromTime && schedule.toTime) parts.push(`${schedule.fromTime}–${schedule.toTime}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export type FilterableDish = { allergens: readonly string[]; tags: readonly string[]; name: string; description: string | null };

/** Filtro del cliente: sin ciertos alérgenos, solo vegetariano/vegano y búsqueda por texto. */
export function matchesFilters(dish: FilterableDish, filters: { without: readonly string[]; diet: "ALL" | "VEGETARIAN" | "VEGAN"; query: string; pregnant?: boolean }) {
  if (filters.without.some((allergen) => dish.allergens.includes(allergen))) return false;
  // Embarazo: solo lo que el local ha marcado expresamente como apto.
  if (filters.pregnant && !dish.tags.includes("PREGNANCY_SAFE")) return false;
  if (filters.diet === "VEGAN" && !dish.tags.includes("VEGAN")) return false;
  if (filters.diet === "VEGETARIAN" && !dish.tags.includes("VEGETARIAN") && !dish.tags.includes("VEGAN")) return false;
  const query = normalize(filters.query);
  if (!query) return true;
  return normalize(`${dish.name} ${dish.description ?? ""}`).includes(query);
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Textos fijos de la carta pública. */
export const MENU_TEXT = {
  es: {
    menu: "Carta",
    search: "Buscar plato o bebida",
    filters: "Filtros",
    without: "Sin…",
    diet: "Dieta",
    all: "Todo",
    vegetarian: "Vegetariano",
    vegan: "Vegano",
    clear: "Quitar filtros",
    soldOut: "Agotado",
    notNow: "Ahora no se sirve",
    servedAt: "Se sirve",
    noResults: "Ningún plato cumple los filtros.",
    allergens: "Alérgenos",
    allergenInfo: "Si tienes alguna alergia o intolerancia, consulta al personal: te informaremos de los ingredientes de cada plato.",
    table: "Mesa",
    book: "Reservar mesa",
    priceIncludesTax: "Precios con IVA incluido.",
    perPerson: "por persona",
    sections: "Secciones",
    unavailableTitle: "Carta no disponible",
    unavailableBody: "Este local no tiene la carta online activada ahora mismo.",
    allergyQuestion: "¿Alergias o dieta?",
    allergyHelp: "Toca lo que no puedes tomar. Lo recordamos en este móvil.",
    hideConflicts: "Ocultar los platos que no puedo tomar",
    contains: "Contiene",
    mayContain: "Puede contener trazas de",
    traces: "Trazas",
    tracesHelp: "Icono con borde discontinuo: puede contener trazas.",
    askAllergens: "Pregunta por sus alérgenos",
    noAllergens: "Sin alérgenos declarados",
    allergenTable: "Tabla de alérgenos",
    dish: "Plato",
    avoiding: "Evitas",
    pregnant: "Estoy embarazada: solo platos aptos",
    pregnantHelp: "Se muestran solo los platos que el local marca como aptos para embarazadas. Ante la duda, consulta al personal.",
  },
  en: {
    menu: "Menu",
    search: "Search dishes or drinks",
    filters: "Filters",
    without: "Free from…",
    diet: "Diet",
    all: "All",
    vegetarian: "Vegetarian",
    vegan: "Vegan",
    clear: "Clear filters",
    soldOut: "Sold out",
    notNow: "Not served now",
    servedAt: "Served",
    noResults: "No dishes match the filters.",
    allergens: "Allergens",
    allergenInfo: "If you have any allergy or intolerance, please ask our staff about the ingredients of each dish.",
    table: "Table",
    book: "Book a table",
    priceIncludesTax: "Prices include VAT.",
    perPerson: "per person",
    sections: "Sections",
    unavailableTitle: "Menu not available",
    unavailableBody: "This venue does not have its online menu enabled right now.",
    allergyQuestion: "Allergies or diet?",
    allergyHelp: "Tap what you can't eat. We'll remember it on this phone.",
    hideConflicts: "Hide dishes I can't eat",
    contains: "Contains",
    mayContain: "May contain traces of",
    traces: "Traces",
    tracesHelp: "Dashed icon: may contain traces.",
    askAllergens: "Ask staff about allergens",
    noAllergens: "No declared allergens",
    allergenTable: "Allergen chart",
    dish: "Dish",
    avoiding: "Avoiding",
    pregnant: "I'm pregnant: only suitable dishes",
    pregnantHelp: "Only dishes the venue marks as safe during pregnancy are shown. If in doubt, ask our staff.",
  },
} as const satisfies Record<MenuLang, Record<string, string>>;

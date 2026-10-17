/**
 * Carta digital: alérgenos oficiales, etiquetas, horario de cada sección, filtros y textos de la
 * carta pública en español e inglés. Puro, sin base de datos.
 */

/** Los 14 alérgenos de declaración obligatoria (Reglamento UE 1169/2011, anexo II). */
export const ALLERGENS = [
  { id: "GLUTEN", es: "Gluten", en: "Gluten", icon: "🌾" },
  { id: "CRUSTACEANS", es: "Crustáceos", en: "Crustaceans", icon: "🦐" },
  { id: "EGGS", es: "Huevos", en: "Eggs", icon: "🥚" },
  { id: "FISH", es: "Pescado", en: "Fish", icon: "🐟" },
  { id: "PEANUTS", es: "Cacahuetes", en: "Peanuts", icon: "🥜" },
  { id: "SOY", es: "Soja", en: "Soy", icon: "🫘" },
  { id: "MILK", es: "Lácteos", en: "Milk", icon: "🥛" },
  { id: "NUTS", es: "Frutos de cáscara", en: "Tree nuts", icon: "🌰" },
  { id: "CELERY", es: "Apio", en: "Celery", icon: "🥬" },
  { id: "MUSTARD", es: "Mostaza", en: "Mustard", icon: "🟡" },
  { id: "SESAME", es: "Sésamo", en: "Sesame", icon: "⚪" },
  { id: "SULPHITES", es: "Sulfitos", en: "Sulphites", icon: "🍷" },
  { id: "LUPIN", es: "Altramuces", en: "Lupin", icon: "🌼" },
  { id: "MOLLUSCS", es: "Moluscos", en: "Molluscs", icon: "🐚" },
] as const;
export type AllergenId = (typeof ALLERGENS)[number]["id"];
export const ALLERGEN_IDS = ALLERGENS.map((allergen) => allergen.id) as AllergenId[];

export const MENU_TAGS = [
  { id: "RECOMMENDED", es: "Recomendado", en: "Chef's pick", icon: "⭐" },
  { id: "VEGETARIAN", es: "Vegetariano", en: "Vegetarian", icon: "🥕" },
  { id: "VEGAN", es: "Vegano", en: "Vegan", icon: "🌱" },
  { id: "SPICY", es: "Picante", en: "Spicy", icon: "🌶️" },
  { id: "NEW", es: "Novedad", en: "New", icon: "✨" },
] as const;
export type MenuTagId = (typeof MENU_TAGS)[number]["id"];
export const MENU_TAG_IDS = MENU_TAGS.map((tag) => tag.id) as MenuTagId[];

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
export function matchesFilters(dish: FilterableDish, filters: { without: readonly string[]; diet: "ALL" | "VEGETARIAN" | "VEGAN"; query: string }) {
  if (filters.without.some((allergen) => dish.allergens.includes(allergen))) return false;
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
  },
} as const satisfies Record<MenuLang, Record<string, string>>;

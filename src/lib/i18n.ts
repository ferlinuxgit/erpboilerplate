import es from "../../messages/es.json";
import en from "../../messages/en.json";

export type Locale = "es" | "en";

const dictionaries = { es, en };

export function getDictionary(locale: Locale) {
  return dictionaries[locale] ?? dictionaries.es;
}

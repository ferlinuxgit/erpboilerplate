import type { SpanishFiscalModelCode } from "@/lib/fiscal-spain";

/**
 * Modelos con fichero de presentación: los que tienen diseño de registro contrastado con el
 * publicado en la sede de la AEAT. Constantes sin dependencias de servidor: también las usa el
 * componente de cliente que pinta el botón de descarga.
 *
 * El 390 no se genera: el resumen anual del programa no lleva la numeración oficial de casillas y
 * su diseño exige datos (actividades, CNAE, prorratas) que el programa no tiene.
 */
export const PRESENTATION_FILE_MODELS = ["303", "111", "115", "130", "347", "349"] as const satisfies readonly SpanishFiscalModelCode[];
export type PresentationFileModel = (typeof PRESENTATION_FILE_MODELS)[number];

export function hasPresentationFile(code: string): code is PresentationFileModel {
  return (PRESENTATION_FILE_MODELS as readonly string[]).includes(code);
}

/** Diseño de registro con el que se genera cada fichero (se enseña junto al botón de descarga). */
export const PRESENTATION_FILE_DESIGNS: Record<PresentationFileModel, string> = {
  "303": "Diseño de registro del 303, versión 1.01 (ejercicio 2026 y siguientes)",
  "111": "Diseño de registro del 111 (ejercicios 2019 y siguientes, mayo de 2021)",
  "115": "Diseño de registro del 115, versión 1.3 (ejercicios 2019 y siguientes)",
  "130": "Diseño de registro del 130, versión 1.2 (ejercicios 2019 y siguientes)",
  "347": "Diseño lógico del 347 (ejercicio 2025 y siguientes, Orden HAC/1431/2025)",
  "349": "Diseño lógico del 349 (Orden HAC/174/2020, ejercicio 2020 y siguientes)",
};

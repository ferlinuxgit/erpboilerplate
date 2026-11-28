import type { SpanishFiscalModelCode } from "@/lib/fiscal-spain";

/**
 * Modelos con fichero de presentación: los que tienen diseño de registro contrastado con el
 * publicado en la sede de la AEAT. Constantes sin dependencias de servidor: también las usa el
 * componente de cliente que pinta el botón de descarga.
 */
export const PRESENTATION_FILE_MODELS = ["303", "111", "115", "123", "130", "347", "349", "190", "180", "193"] as const satisfies readonly SpanishFiscalModelCode[];
export type PresentationFileModel = (typeof PRESENTATION_FILE_MODELS)[number];

export function hasPresentationFile(code: string): code is PresentationFileModel {
  return (PRESENTATION_FILE_MODELS as readonly string[]).includes(code);
}

/** Diseño de registro con el que se genera cada fichero (se enseña junto al botón de descarga). */
export const PRESENTATION_FILE_DESIGNS: Record<PresentationFileModel, string> = {
  "303": "Diseño de registro del 303, versión 1.01 (ejercicio 2026 y siguientes)",
  "111": "Diseño de registro del 111 (ejercicios 2019 y siguientes, mayo de 2021)",
  "115": "Diseño de registro del 115, versión 1.3 (ejercicios 2019 y siguientes)",
  "123": "Diseño de registro del 123, versión 2.0 (ejercicio 2024 y siguientes)",
  "130": "Diseño de registro del 130, versión 1.2 (ejercicios 2019 y siguientes)",
  "347": "Diseño lógico del 347 (ejercicio 2025 y siguientes, Orden HAC/1431/2025)",
  "349": "Diseño lógico del 349 (Orden HAC/174/2020, ejercicio 2020 y siguientes)",
  "190": "Diseños de registro del 190 (ejercicio 2025, Orden HAC/1431/2025)",
  "180": "Diseños de registro del 180 (ejercicio 2023 y siguientes, Orden HFP/1284/2023)",
  "193": "Diseños de registro del 193 (ejercicio 2025)",
};

/**
 * Por qué el programa no genera el fichero del 390 (diseño «dr390e2026.xlsx», versión 1.00). Las
 * casillas numeradas que calcula el programa cabrían en el diseño, pero este exige además datos que
 * el programa no guarda y cuyo contenido no se puede deducir con seguridad: la identificación del
 * representante de las personas jurídicas, la descripción, el código y el epígrafe de cada
 * actividad, el reparto del resultado del último periodo entre «a compensar» (97) y «a devolver»
 * (98), y el apartado 8 de tributación por razón de territorio, que repite las casillas 658, 84 y
 * 659 por Administración. Un fichero a medias sería rechazado por la sede o, peor, importado con
 * datos equivocados.
 */
export const MODELO_390_FILE_REASON = "El programa no genera el fichero del 390: el diseño de registro de la AEAT exige datos que el programa no guarda (representante, descripción y epígrafe de cada actividad, reparto del saldo final entre compensar y devolver, tributación por territorios) y un fichero incompleto no pasaría la validación de la sede. Rellena el 390 en la sede con las casillas numeradas del resumen anual, que siguen la numeración oficial.";

import type { SpanishFiscalModelCode } from "@/lib/fiscal-spain";

/**
 * Modelos con fichero de presentación: los que tienen diseño de registro contrastado con el
 * publicado en la sede de la AEAT. Constantes sin dependencias de servidor: también las usa el
 * componente de cliente que pinta el botón de descarga.
 */
export const PRESENTATION_FILE_MODELS = ["303", "111", "115", "123", "130", "347", "349", "390", "190", "180", "193"] as const satisfies readonly SpanishFiscalModelCode[];
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
  "390": "Diseño de registro del 390, versión 1.00 (ejercicio 2026)",
  "190": "Diseños de registro del 190 (ejercicio 2025, Orden HAC/1431/2025)",
  "180": "Diseños de registro del 180 (ejercicio 2023 y siguientes, Orden HFP/1284/2023)",
  "193": "Diseños de registro del 193 (ejercicio 2025)",
};


/**
 * Códigos de actividad del 303 para los exonerados del 390 (instrucciones del 303, apartado
 * «Exclusivamente a cumplimentar en el último periodo…», letra B). También los usa el formulario
 * de la descarga.
 */
export const MODELO_303_ACTIVITY_LABELS = {
  A01: "Arrendadores de bienes inmuebles",
  A02: "Ganadería independiente",
  A03: "Resto de actividades empresariales",
  A04: "Actividades profesionales de carácter artístico o deportivo",
  A05: "Resto de actividades profesionales",
  B01: "Actividad agrícola",
  B02: "Actividad ganadera dependiente",
  B03: "Actividad forestal",
  B04: "Producción del mejillón en batea",
  B05: "Actividad pesquera (excepto mejillón en batea)",
  B06: "Otras actividades no sujetas al IAE",
  C: "Actividades no iniciadas",
} as const;
export const MODELO_303_ACTIVITY_CODES = Object.keys(MODELO_303_ACTIVITY_LABELS) as Array<keyof typeof MODELO_303_ACTIVITY_LABELS>;

/** Modelos informativos de retenciones: la descarga admite la provincia de los perceptores sin ficha. */
export const PROVINCE_PARAMETER_MODELS: readonly PresentationFileModel[] = ["190", "180", "193"];

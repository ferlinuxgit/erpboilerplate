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
 * Por qué el programa no genera el fichero del 390 (diseño «dr390e2026.xlsx», versión 1.00, de la
 * sede: https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_300_399/archivos_26/dr390e2026.xlsx).
 *
 * El diseño se podría rellenar: las casillas numeradas del resumen anual siguen la numeración
 * oficial, la actividad, el código y el epígrafe se podrían pedir al descargar (como en el 303) y el
 * representante y el apartado 8 (tributación por territorios) no son obligatorios para quien solo
 * tributa a la Administración del Estado. Lo que impide generarlo con seguridad es el apartado 9
 * del resumen, que no sigue todavía la definición de las instrucciones del 390:
 * - la casilla 85 debe ser lo compensado en el ejercicio de cuotas de años anteriores (la suma de
 *   las casillas 78 de los 303) y el resumen pone el saldo inicial entero;
 * - la 97 (o la 98 si se pidió la devolución) debe ser solo el resultado del último 303, y las cuotas
 *   del año que siguen pendientes van aparte en la 662; el resumen pone en la 97 todo el saldo
 *   pendiente al cerrar el año.
 * Un fichero con esas casillas pasaría la importación y llevaría a la AEAT importes que no cruzan con
 * los 303 presentados.
 */
export const MODELO_390_FILE_REASON = "El programa todavía no genera el fichero del 390: el resumen anual calcula las casillas 85 y 97 de forma simplificada (saldo inicial y saldo pendiente al cerrar el año) y el diseño de la AEAT pide lo compensado en el ejercicio (85), el resultado del último 303 (97 o 98) y aparte las cuotas pendientes del año (662). Rellena el 390 en la sede con las casillas numeradas del resumen anual y comprueba esas tres con tus 303 presentados.";

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

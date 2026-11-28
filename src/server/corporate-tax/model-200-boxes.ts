/**
 * Numeración de casillas del modelo 200 (Impuesto sobre Sociedades) para las líneas que calcula el
 * programa. Funciones puras.
 *
 * FUENTE (contrastada el 28-11-2026): diseño de registro del modelo 200, ejercicio 2025, versión
 * 1.02, publicado en la sede de la AEAT:
 *   https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_200_299/archivos_25/DR200e25.xls
 * (listado en https://sede.agenciatributaria.gob.es/Sede/ayuda/disenos-registro/modelos-200-299.html).
 *
 * Los números de casilla se repiten entre páginas (la [00301] es «Correcciones por Impuesto sobre
 * Sociedades» en la página 12 e «Ingresos financieros de valores negociables» en la 7), así que cada
 * casilla va con su página. Solo se numera lo que coincide sin ambigüedad con un epígrafe del modelo
 * abreviado o con una línea de la liquidación; el resto se deja sin número.
 *
 * Para ejercicios distintos de 2025 la AEAT puede renumerar: se avisa en pantalla.
 */

export const MODEL_200_BOXES_SOURCE = {
  year: 2025,
  version: "1.02",
  label: "Diseño de registro del modelo 200 del ejercicio 2025 (versión 1.02) de la AEAT",
  url: "https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_200_299/archivos_25/DR200e25.xls",
} as const;

export type Model200Box = { page: string; box: string };

const box = (page: string, code: string): Model200Box => ({ page, box: code });

/** «Casilla 00552 (pág. 14)». */
export function formatModel200Box(entry: Model200Box | null | undefined) {
  return entry ? `${entry.box} (pág. ${entry.page})` : "";
}

/**
 * Casillas de las líneas de la liquidación (claves de `liquidationRows`).
 * - [00501] «Resultado de la cuenta de pérdidas y ganancias antes de Impuesto sobre Sociedades e
 *   Impuesto Complementario» (pág. 12): el resultado de la cuenta [00500] más las correcciones por
 *   el propio impuesto [00301]/[00302]. Es lo que aquí se llama «resultado antes de impuestos».
 * - [00417]/[00418] (pág. 13): totales de las demás correcciones (aumentos y disminuciones).
 * - [00550] «B.I. antes de la compensación de bases imponibles negativas» (pág. 14), [01032] reserva
 *   de capitalización, [00547] compensación de bases negativas, [00552] base imponible, [01033] y
 *   [01034] reserva de nivelación (aumentos y disminuciones), [01330] base tras la nivelación,
 *   [00558] tipo de gravamen, [00562] cuota íntegra.
 * - Página 14 bis: [00592] cuota líquida, [01766] total retenciones e ingresos a cuenta efectuados
 *   a la entidad, [00599] cuota del ejercicio a ingresar o a devolver, [00601]/[00603]/[00605]
 *   pagos fraccionados (Estado), [00611] cuota diferencial, [01586] resultado de la autoliquidación.
 * Las bonificaciones y deducciones no se numeran: en el modelo van repartidas entre la página 14
 * (bonificaciones y doble imposición, hasta la cuota íntegra ajustada positiva [00582]) y la 14 bis
 * (otras deducciones), y aquí se recogen juntas.
 */
export const LIQUIDATION_BOXES: Readonly<Record<string, Model200Box>> = {
  "accounting-result": box("12", "00501"),
  increases: box("13", "00417"),
  decreases: box("13", "00418"),
  "prior-base": box("14", "00550"),
  capitalization: box("14", "01032"),
  losses: box("14", "00547"),
  "taxable-base": box("14", "00552"),
  "leveling-reduction": box("14", "01034"),
  "leveling-addition": box("14", "01033"),
  "rate-base": box("14", "01330"),
  "gross-quota": box("14", "00562"),
  "net-quota": box("14 bis", "00592"),
  withholdings: box("14 bis", "01766"),
  "quota-of-year": box("14 bis", "00599"),
  differential: box("14 bis", "00611"),
};

/** Casilla de cada pago fraccionado del ejercicio en la página 14 bis (columna «Estado»). */
export const INSTALLMENT_BOXES: Readonly<Record<"1P" | "2P" | "3P", Model200Box>> = {
  "1P": box("14 bis", "00601"),
  "2P": box("14 bis", "00603"),
  "3P": box("14 bis", "00605"),
};

/** Tipo de gravamen [00558]: 4 dígitos, «2500» para un tipo único del 25 %, «2122» para la escala 21/22 (nota 1 de la pág. 14). */
export const TAX_RATE_BOX = box("14", "00558");

export function taxRateBoxValue(ratesPct: readonly number[]) {
  const two = (value: number) => String(Math.max(Math.min(Math.round(value), 99), 0)).padStart(2, "0");
  const unique = [...new Set(ratesPct.map((value) => Math.round(value)))];
  if (unique.length === 0) return "";
  return `${two(unique[0])}${unique.length > 1 ? two(unique[1]) : "00"}`;
}

/** Resultado de la cuenta de pérdidas y ganancias [00500] y corrección por el Impuesto sobre Sociedades [00301]/[00302] (pág. 12). */
export const PROFIT_AND_LOSS_RESULT_BOX = box("12", "00500");
export const TAX_CORRECTION_BOXES = { increase: box("12", "00301"), decrease: box("12", "00302") } as const;

/**
 * Casillas de los ajustes del catálogo (detalle de correcciones, páginas 12 y 13). Solo los que
 * tienen una casilla propia sin ambigüedad; los demás («deterioros», «exención de dividendos»…)
 * tienen varias según el caso y se dejan sin número.
 */
export const ADJUSTMENT_BOXES: Readonly<Record<string, Model200Box>> = {
  fines: box("12", "01815"),
  gifts: box("12", "00339"),
  "depreciation-excess": box("12", "00303"),
  "depreciation-reversal": box("12", "00304"),
  provisions: box("12", "00337"),
  "financial-expenses": box("12", "00363"),
  "financial-expenses-reversal": box("12", "00364"),
  "other-increase": box("13", "00413"),
  "other-decrease": box("13", "00414"),
  unsupported: box("13", "00413"),
};

/**
 * Casillas del balance (páginas 3 a 6) y de la cuenta de pérdidas y ganancias (páginas 7 y 8) por
 * epígrafe del modelo abreviado (`official-statements-model.ts`). El modelo 200 sigue el modelo
 * normal con todos sus desgloses; los epígrafes abreviados que agrupan varias casillas del normal
 * («Otros deudores», «Otras deudas», «Otros acreedores») no se numeran.
 */
export const STATEMENT_BOXES: Readonly<Record<string, Model200Box>> = {
  // Activo (I), página 3
  A: box("3", "00101"),
  "A.I": box("3", "00102"),
  "A.II": box("3", "00111"),
  "A.III": box("3", "00115"),
  "A.IV": box("3", "00118"),
  "A.V": box("3", "00126"),
  "A.VI": box("3", "00134"),
  B: box("3", "00136"),
  "B.I": box("3", "00137"),
  "B.II": box("3", "00138"),
  // Activo (II), página 4
  "B.III": box("4", "00149"),
  "B.III.1": box("4", "00150"),
  "B.III.2": box("4", "00158"),
  "B.IV": box("4", "00160"),
  "B.V": box("4", "00168"),
  "B.VI": box("4", "00176"),
  "B.VII": box("4", "00177"),
  TOTAL_ACTIVO: box("4", "00180"),
  // Patrimonio neto y pasivo (I), página 5
  PN: box("5", "00185"),
  "PN.1": box("5", "00186"),
  "PN.1.I": box("5", "00187"),
  "PN.1.I.1": box("5", "00188"),
  "PN.1.I.2": box("5", "00189"),
  "PN.1.II": box("5", "00190"),
  "PN.1.III": box("5", "00191"),
  "PN.1.IV": box("5", "00194"),
  "PN.1.V": box("5", "00195"),
  "PN.1.VI": box("5", "00198"),
  "PN.1.VII": box("5", "00199"),
  "PN.1.VIII": box("5", "00200"),
  "PN.1.IX": box("5", "00201"),
  "PN.2": box("5", "00202"),
  "PN.3": box("5", "00209"),
  PNC: box("5", "00210"),
  "PNC.I": box("5", "00211"),
  "PNC.II": box("5", "00216"),
  "PNC.II.1": box("5", "00218"),
  "PNC.II.2": box("5", "00219"),
  "PNC.III": box("5", "00223"),
  "PNC.IV": box("5", "00224"),
  "PNC.V": box("5", "00225"),
  // Patrimonio neto y pasivo (II), página 6
  PC: box("6", "00228"),
  "PC.I": box("6", "00229"),
  "PC.II": box("6", "00230"),
  "PC.III": box("6", "00231"),
  "PC.III.1": box("6", "00233"),
  "PC.III.2": box("6", "00234"),
  "PC.IV": box("6", "00238"),
  "PC.V": box("6", "00239"),
  "PC.V.1": box("6", "00240"),
  "PC.VI": box("6", "00250"),
  TOTAL_PN_PASIVO: box("6", "00252"),
  // Cuenta de pérdidas y ganancias (I), página 7
  "PG.1": box("7", "00255"),
  "PG.2": box("7", "00258"),
  "PG.3": box("7", "00259"),
  "PG.4": box("7", "00260"),
  "PG.5": box("7", "00265"),
  "PG.6": box("7", "00270"),
  "PG.7": box("7", "00279"),
  "PG.8": box("7", "00284"),
  "PG.9": box("7", "00285"),
  "PG.10": box("7", "00286"),
  "PG.11": box("7", "00287"),
  "PG.OTROS": box("7", "00295"),
  "PG.A": box("7", "00296"),
  // Cuenta de pérdidas y ganancias (II), página 8
  "PG.12": box("8", "00297"),
  "PG.13": box("8", "00305"),
  "PG.14": box("8", "00309"),
  "PG.15": box("8", "00312"),
  "PG.16": box("8", "00313"),
  "PG.B": box("8", "00324"),
  "PG.C": box("8", "00325"),
  "PG.17": box("8", "00326"),
  // Sin operaciones interrumpidas, el resultado del ejercicio es también la casilla [00500].
  "PG.D": box("8", "00500"),
};

export function statementBox(lineId: string) {
  return STATEMENT_BOXES[lineId] ?? null;
}

/** Aviso cuando el ejercicio no es aquel cuya numeración se ha contrastado. */
export function model200BoxesWarning(startYear: number) {
  if (startYear === MODEL_200_BOXES_SOURCE.year) return null;
  return `La numeración de casillas es la del modelo 200 del ejercicio ${MODEL_200_BOXES_SOURCE.year}. Para el ejercicio que empieza en ${startYear} la AEAT puede haberla cambiado: compruébala en Sociedades WEB.`;
}

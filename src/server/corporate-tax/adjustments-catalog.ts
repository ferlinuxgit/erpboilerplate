/**
 * Ajustes extracontables habituales en una pyme (Ley 27/2014). Es una lista de ayuda: el usuario
 * elige el concepto y pone el importe; el programa solo propone el importe cuando puede sacarlo
 * de la contabilidad (cuenta 678, amortización por encima del coeficiente máximo de tablas).
 */

import type { AdjustmentNature, AdjustmentSign } from "@/server/corporate-tax/liquidation";

export type AdjustmentCatalogEntry = {
  key: string;
  label: string;
  sign: AdjustmentSign;
  /** Naturaleza habitual; el usuario puede cambiarla. */
  nature: AdjustmentNature;
  help: string;
};

export const ADJUSTMENT_CATALOG: readonly AdjustmentCatalogEntry[] = [
  { key: "fines", label: "Multas, sanciones y recargos", sign: "increase", nature: "permanent", help: "No son deducibles (art. 15.c). Suelen estar en la cuenta 678." },
  { key: "gifts", label: "Donativos y liberalidades", sign: "increase", nature: "permanent", help: "No son deducibles (art. 15.e). Las atenciones a clientes sí lo son hasta el 1 % de la cifra de negocios." },
  { key: "unsupported", label: "Gastos sin justificar o ajenos a la actividad", sign: "increase", nature: "permanent", help: "Gastos sin factura o que no corresponden a la actividad de la sociedad." },
  { key: "depreciation-excess", label: "Amortización contable superior a la fiscal", sign: "increase", nature: "temporaryOrigin", help: "Exceso sobre el coeficiente máximo de las tablas (art. 12.1.a). Se recupera cuando el bien termina de amortizarse fiscalmente." },
  { key: "depreciation-reversal", label: "Amortización fiscal superior a la contable", sign: "decrease", nature: "temporaryReversal", help: "Recuperación de excesos de años anteriores, o amortización acelerada y libertad de amortización (arts. 12.3, 102 y 103)." },
  { key: "impairment", label: "Deterioros no deducibles", sign: "increase", nature: "temporaryOrigin", help: "Deterioro de inmovilizado, de participaciones o de créditos que no cumplen los requisitos del art. 13." },
  { key: "impairment-reversal", label: "Reversión de deterioros que no fueron deducibles", sign: "decrease", nature: "temporaryReversal", help: "El ingreso contable por la reversión no tributa si el deterioro no se dedujo en su día." },
  { key: "provisions", label: "Provisiones no deducibles", sign: "increase", nature: "temporaryOrigin", help: "Provisiones por obligaciones implícitas o tácitas, retribuciones a largo plazo y otras del art. 14." },
  { key: "financial-expenses", label: "Limitación de gastos financieros", sign: "increase", nature: "temporaryOrigin", help: "Gastos financieros netos que superan el 30 % del beneficio operativo, con 1 millón deducible en todo caso (art. 16)." },
  { key: "exempt-dividends", label: "Exención de dividendos y plusvalías de participaciones", sign: "decrease", nature: "permanent", help: "Exención del 95 % de dividendos y rentas de participaciones significativas (art. 21)." },
  { key: "other-increase", label: "Otro ajuste positivo", sign: "increase", nature: "permanent", help: "Cualquier otro aumento al resultado contable." },
  { key: "other-decrease", label: "Otro ajuste negativo", sign: "decrease", nature: "permanent", help: "Cualquier otra disminución al resultado contable." },
];

const BY_KEY = new Map(ADJUSTMENT_CATALOG.map((entry) => [entry.key, entry]));

export function findAdjustmentCatalogEntry(key: string | null | undefined) {
  return (key && BY_KEY.get(key)) || null;
}

export const ADJUSTMENT_NATURE_LABELS: Record<AdjustmentNature, string> = {
  permanent: "Permanente",
  temporaryOrigin: "Temporaria (nace este año)",
  temporaryReversal: "Temporaria (revierte)",
};

/**
 * Exceso de la amortización contable de un bien sobre la máxima fiscal de tablas en el ejercicio:
 * dotación contabilizada − coste amortizable × coeficiente máximo × (días en uso / días del año).
 * Es una propuesta: no conoce la libertad de amortización, la amortización acelerada de las
 * empresas de reducida dimensión ni los bienes usados (que admiten el doble del coeficiente).
 */
export function depreciationExcessCents(input: { yearDepreciationCents: number; depreciableCents: number; maxPct: number; daysInUse: number; daysInYear: number }) {
  const fraction = input.daysInYear > 0 ? Math.min(Math.max(input.daysInUse / input.daysInYear, 0), 1) : 0;
  const fiscalMaximum = Math.round((input.depreciableCents * input.maxPct * fraction) / 100);
  return Math.max(input.yearDepreciationCents - fiscalMaximum, 0);
}

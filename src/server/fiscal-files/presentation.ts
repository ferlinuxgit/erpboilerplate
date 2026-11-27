import { FiscalFileError, normalizeSpanishNif, parseFilePeriod, toCents, type Declarant, type FiscalFile } from "@/server/fiscal-files/fields";
import { hasPresentationFile } from "@/server/fiscal-files/models";
import { buildModelo111File } from "@/server/fiscal-files/modelo-111";
import { buildModelo115File } from "@/server/fiscal-files/modelo-115";
import { buildModelo130File } from "@/server/fiscal-files/modelo-130";
import { buildModelo303File } from "@/server/fiscal-files/modelo-303";
import { buildModelo347File, type Modelo347Party } from "@/server/fiscal-files/modelo-347";
import { buildModelo349File } from "@/server/fiscal-files/modelo-349";
import type { SpanishFiscalSummary } from "@/server/fiscal/spain";

export { hasPresentationFile, PRESENTATION_FILE_DESIGNS, PRESENTATION_FILE_MODELS, type PresentationFileModel } from "@/server/fiscal-files/models";

/**
 * Del resumen de un modelo (el cálculo en vivo o la foto de lo presentado) al fichero que la sede
 * de la AEAT permite importar. Función pura: los datos que el resumen no trae (perceptores de las
 * retenciones, domicilio de los terceros del 347) llegan en `extras`.
 */
export type PresentationExtras = {
  /** 111 y 115: número de perceptores (proveedores distintos) con retención en el periodo. */
  withholdingRecipients?: number;
  /** 347: país y código postal de cada tercero, por NIF normalizado (sin prefijo ES ni separadores). */
  partyAddresses?: Map<string, { countryCode: string | null; postalCode: string | null }>;
};

export type PresentationOptions = {
  /** Tipo de declaración (forma de pago o de devolución); por defecto, el que corresponde al resultado. */
  declarationType?: string | null;
  iban?: string | null;
};

function boxesToCents(boxes: Array<{ box: string; amount: number }>) {
  const result: Record<string, number> = {};
  for (const entry of boxes) result[entry.box] = (result[entry.box] ?? 0) + toCents(entry.amount);
  return result;
}

function pickType<T extends string>(value: string | null | undefined, allowed: readonly T[]): T | undefined {
  const type = (value ?? "").trim().toUpperCase();
  if (!type) return undefined;
  if (!(allowed as readonly string[]).includes(type)) throw new FiscalFileError([`El tipo de declaración «${type}» no es válido para este modelo (admite ${allowed.join(", ")}).`]);
  return type as T;
}

export function buildPresentationFile(
  summary: SpanishFiscalSummary,
  reportPeriod: string,
  declarant: Declarant,
  extras: PresentationExtras = {},
  options: PresentationOptions = {},
): FiscalFile {
  if (!hasPresentationFile(summary.code)) {
    throw new FiscalFileError([summary.code === "390"
      ? "El programa no genera el fichero del 390: el resumen anual no lleva la numeración oficial de casillas. Usa el resumen como guía para rellenarlo en la sede."
      : `El modelo ${summary.code} no tiene fichero de presentación en el programa.`]);
  }
  const period = parseFilePeriod(reportPeriod);
  if (!period) throw new FiscalFileError([`No se reconoce el periodo «${reportPeriod}» del modelo.`]);
  const iban = options.iban ?? null;

  switch (summary.code) {
    case "303":
      return buildModelo303File({
        declarant,
        period,
        boxes: boxesToCents(summary.modelo303Boxes),
        cashAccounting: summary.fiscalProfile.fiscalRegime === "cash_accounting",
        noActivity: summary.salesInvoiceCount === 0 && summary.supplierInvoiceCount === 0 && summary.modelo303Boxes.every((box) => toCents(box.amount) === 0),
        declarationType: pickType(options.declarationType, ["C", "D", "G", "I", "N", "V", "U", "X"] as const),
        iban,
      });
    case "111":
      return buildModelo111File({
        declarant,
        period,
        professionals: { recipients: extras.withholdingRecipients ?? 0, baseCents: toCents(summary.withholdingBase), withheldCents: toCents(summary.withholdingAmount) },
        declarationType: pickType(options.declarationType, ["I", "U", "G", "N"] as const),
        iban,
      });
    case "115":
      return buildModelo115File({
        declarant,
        period,
        recipients: extras.withholdingRecipients ?? 0,
        baseCents: toCents(summary.withholdingBase),
        withheldCents: toCents(summary.withholdingAmount),
        declarationType: pickType(options.declarationType, ["I", "U", "G", "N"] as const),
        iban,
      });
    case "130": {
      if (!summary.modelo130) throw new FiscalFileError(["El modelo 130 no tiene casillas calculadas para este periodo."]);
      return buildModelo130File({
        declarant,
        period,
        boxes: boxesToCents(summary.modelo130.boxes),
        declarationType: pickType(options.declarationType, ["I", "U", "G", "N", "B"] as const),
        iban,
      });
    }
    case "347": {
      const parties: Modelo347Party[] = (summary.thirdPartyOperations ?? []).map((operation) => {
        const address = extras.partyAddresses?.get(normalizeSpanishNif(operation.taxId));
        return {
          key: operation.type === "supplier" ? "A" : "B",
          taxId: operation.taxId,
          name: operation.name,
          countryCode: address?.countryCode ?? "ES",
          postalCode: address?.postalCode ?? null,
          amountCents: toCents(operation.amount),
          quartersCents: operation.quarters.map((amount) => toCents(amount)) as [number, number, number, number],
          cashCents: toCents(operation.cashAmount),
        };
      });
      return buildModelo347File({ declarant, year: period.year, parties });
    }
    case "349": {
      const modelo349 = summary.modelo349;
      if (!modelo349) throw new FiscalFileError(["El modelo 349 no tiene operadores calculados para este periodo."]);
      return buildModelo349File({
        declarant,
        period,
        operators: modelo349.operators.map((operator) => ({ key: operator.key, taxId: operator.taxId, name: operator.name, amountCents: toCents(operator.amount) })),
        rectificationCount: modelo349.rectifications.length,
      });
    }
  }
}

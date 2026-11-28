import { FiscalFileError, normalizeSpanishNif, parseFilePeriod, toCents, type Declarant, type FiscalFile } from "@/server/fiscal-files/fields";
import { hasPresentationFile, MODELO_390_FILE_REASON } from "@/server/fiscal-files/models";
import { buildModelo111File } from "@/server/fiscal-files/modelo-111";
import { buildModelo115File } from "@/server/fiscal-files/modelo-115";
import { buildModelo123File } from "@/server/fiscal-files/modelo-123";
import { buildModelo130File } from "@/server/fiscal-files/modelo-130";
import { buildModelo180File } from "@/server/fiscal-files/modelo-180";
import { buildModelo190File } from "@/server/fiscal-files/modelo-190";
import { buildModelo193File } from "@/server/fiscal-files/modelo-193";
import { buildModelo303File } from "@/server/fiscal-files/modelo-303";
import { buildModelo347File, type Modelo347Party } from "@/server/fiscal-files/modelo-347";
import { buildModelo349File } from "@/server/fiscal-files/modelo-349";
import type { SpanishFiscalSummary } from "@/server/fiscal/spain";

export { hasPresentationFile, PRESENTATION_FILE_DESIGNS, PRESENTATION_FILE_MODELS, type PresentationFileModel } from "@/server/fiscal-files/models";

/**
 * Del resumen de un modelo (el cálculo en vivo o la foto de lo presentado) al fichero que la sede
 * de la AEAT permite importar. Función pura: los datos que el resumen no trae (domicilio de los
 * terceros, fechas de los dividendos) llegan en `extras`, y los que el programa no guarda
 * (provincia de los trabajadores, actividad, CNAE) en `options`, como parámetros de la descarga.
 */
export type PresentationExtras = {
  /** 111 y 115 de fotos antiguas (sin `withholdingModel`): proveedores distintos con retención en el periodo. */
  withholdingRecipients?: number;
  /** 347, 190, 180 y 193: país y código postal de cada tercero, por NIF normalizado (sin prefijo ES ni separadores). */
  partyAddresses?: Map<string, { countryCode: string | null; postalCode: string | null }>;
  /**
   * 190: cotizaciones a la Seguridad Social a cargo del trabajador en las nóminas del año
   * (céntimos), por «NIF normalizado|clave» (A empleados, E administradores).
   */
  employeeSocialSecurity?: Map<string, number>;
  /** 193: fechas de pago (AAAA-MM-DD) de los dividendos del año a cada perceptor, por NIF normalizado. */
  dividendDates?: Map<string, string[]>;
};

export type PresentationOptions = {
  /** Tipo de declaración (forma de pago o de devolución); por defecto, el que corresponde al resultado. */
  declarationType?: string | null;
  iban?: string | null;
  /** 190, 180 y 193: provincia (dos dígitos) de los perceptores sin ficha de tercero con código postal. */
  defaultProvince?: string | null;
  /** 303 del último periodo: exonerado de presentar el 390 (viaja el volumen de operaciones). */
  exemptFrom390?: boolean;
  /** 303 exonerado del 390: código de la actividad principal (A01…C), epígrafe del IAE y marca del 347. */
  activityCode?: string | null;
  iaeCode?: string | null;
  has347Operations?: boolean;
  /** 303 del último periodo con prorrata: código CNAE-2025 de la actividad (cuatro dígitos). */
  cnae?: string | null;
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

const WITHHOLDING_TYPES = ["I", "U", "G", "N"] as const;
const NOT_CALCULATED = (code: string) => `El modelo ${code} guardado no tiene el detalle de perceptores (se calculó con una versión anterior del programa). Vuelve a abrirlo en borrador para recalcularlo.`;

/**
 * Resumen anual que no cuadra con las autoliquidaciones del año (190 con 111, 180 con 115, 193 con
 * 123): el fichero se genera, porque lo que se declara es lo pagado, pero se avisa de que la AEAT
 * cruza ambos importes.
 */
function withReconciliationWarning(file: FiscalFile, code: string, reconciliation: { balanced: boolean; differenceCents: number } | undefined) {
  if (reconciliation && !reconciliation.balanced) {
    const difference = (reconciliation.differenceCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    file.warnings.unshift(`El ${code} no cuadra con las autoliquidaciones del año (diferencia de ${difference} €). La AEAT cruza ambos importes: revísalo en el modelo antes de presentar.`);
  }
  return file;
}

/** Código postal de cada tercero por NIF, a partir de las direcciones cargadas. */
function postalCodesOf(extras: PresentationExtras) {
  const postalCodes = new Map<string, string | null>();
  for (const [taxId, address] of extras.partyAddresses ?? []) postalCodes.set(taxId, address.postalCode);
  return postalCodes;
}

export function buildPresentationFile(
  summary: SpanishFiscalSummary,
  reportPeriod: string,
  declarant: Declarant,
  extras: PresentationExtras = {},
  options: PresentationOptions = {},
): FiscalFile {
  if (!hasPresentationFile(summary.code)) {
    throw new FiscalFileError([summary.code === "390" ? MODELO_390_FILE_REASON : `El modelo ${summary.code} no tiene fichero de presentación en el programa.`]);
  }
  const period = parseFilePeriod(reportPeriod);
  if (!period) throw new FiscalFileError([`No se reconoce el periodo «${reportPeriod}» del modelo.`]);
  const iban = options.iban ?? null;
  const withholding = summary.withholdingModel;

  switch (summary.code) {
    case "303": {
      const cash = summary.cashAccounting;
      // Fotos anteriores al soporte del régimen: se calcularon por devengo aunque la empresa estuviera acogida.
      if (summary.fiscalProfile.fiscalRegime === "cash_accounting" && !cash) {
        throw new FiscalFileError(["La empresa está en el régimen especial del criterio de caja y este modelo se calculó antes de que el programa lo liquidara por cobros y pagos: no se puede generar el fichero. Si no está presentado, vuelve a abrirlo para recalcularlo."]);
      }
      const prorrata = summary.prorrata;
      const finalPct = prorrata?.confirmedPct ?? null;
      const cnae = (options.cnae ?? "").trim();
      const file = buildModelo303File({
        declarant,
        period,
        boxes: boxesToCents(summary.modelo303Boxes),
        cashAccounting: cash?.ownRegime ?? false,
        cashAccountingRecipient: cash ? toCents(cash.purchaseBase) !== 0 || toCents(cash.purchaseTax) !== 0 : undefined,
        noActivity: summary.salesInvoiceCount === 0 && summary.supplierInvoiceCount === 0 && summary.modelo303Boxes.every((box) => toCents(box.amount) === 0),
        declarationType: pickType(options.declarationType, ["C", "D", "G", "I", "N", "V", "U", "X"] as const),
        iban,
        exemptFrom390: options.exemptFrom390 ? { activityCode: options.activityCode ?? "", iaeCode: options.iaeCode, has347Operations: options.has347Operations } : null,
        prorrata: prorrata && finalPct !== null && cnae
          ? { cnae, totalCents: toCents(prorrata.totalOperations), deductibleCents: toCents(prorrata.deductibleOperations), pct: finalPct }
          : null,
      });
      if (prorrata && period.isLastOfYear) {
        if (finalPct === null) file.warnings.push("La prorrata definitiva del año no está confirmada: el fichero no lleva la regularización (casillas 43 y 44) ni la página de prorratas. Confírmala en el modelo antes de presentar.");
        else if (!cnae) file.warnings.push("Aplicas prorrata: indica el código CNAE de la actividad al descargar para que viaje la página de prorratas (casillas 500 a 504), o complétala en la sede.");
      }
      return file;
    }
    case "111": {
      const modelo111 = withholding?.modelo111;
      const common = { declarant, period, declarationType: pickType(options.declarationType, WITHHOLDING_TYPES), iban };
      if (modelo111) return buildModelo111File({ ...common, blocks: modelo111.blocks, previousCents: modelo111.previousCents });
      return buildModelo111File({ ...common, professionals: { recipients: extras.withholdingRecipients ?? 0, baseCents: toCents(summary.withholdingBase), withheldCents: toCents(summary.withholdingAmount) } });
    }
    case "115": {
      const modelo115 = withholding?.modelo115;
      if (modelo115 && modelo115.previousCents !== 0) throw new FiscalFileError(["El modelo tiene importe en la casilla 04 (autoliquidación complementaria): preséntala directamente en la sede."]);
      return buildModelo115File({
        declarant,
        period,
        recipients: modelo115?.recipients ?? extras.withholdingRecipients ?? 0,
        baseCents: modelo115?.baseCents ?? toCents(summary.withholdingBase),
        withheldCents: modelo115?.withheldCents ?? toCents(summary.withholdingAmount),
        declarationType: pickType(options.declarationType, WITHHOLDING_TYPES),
        iban,
      });
    }
    case "123": {
      const modelo123 = withholding?.modelo123;
      if (!modelo123) throw new FiscalFileError(["El modelo 123 no tiene casillas calculadas para este periodo."]);
      return buildModelo123File({
        declarant,
        period,
        dividends: modelo123.dividends,
        other: modelo123.other,
        previousCents: modelo123.previousCents,
        declarationType: pickType(options.declarationType, WITHHOLDING_TYPES),
        iban,
      });
    }
    case "190": {
      const modelo190 = withholding?.modelo190;
      if (!modelo190) throw new FiscalFileError([NOT_CALCULATED("190")]);
      return withReconciliationWarning(buildModelo190File({
        declarant,
        year: period.year,
        recipients: modelo190.recipients.map((recipient) => ({
          ...recipient,
          deductibleExpensesCents: extras.employeeSocialSecurity?.get(`${normalizeSpanishNif(recipient.taxId)}|${recipient.key}`) ?? 0,
        })),
        postalCodes: postalCodesOf(extras),
        defaultProvince: options.defaultProvince,
      }), "190", modelo190.reconciliation);
    }
    case "180": {
      const modelo180 = withholding?.modelo180;
      if (!modelo180) throw new FiscalFileError([NOT_CALCULATED("180")]);
      return withReconciliationWarning(
        buildModelo180File({ declarant, year: period.year, recipients: modelo180.recipients, postalCodes: postalCodesOf(extras), defaultProvince: options.defaultProvince }),
        "180",
        modelo180.reconciliation,
      );
    }
    case "193": {
      const modelo193 = withholding?.modelo193;
      if (!modelo193) throw new FiscalFileError([NOT_CALCULATED("193")]);
      return withReconciliationWarning(buildModelo193File({
        declarant,
        year: period.year,
        recipients: modelo193.recipients.map((recipient) => {
          const dates = [...(extras.dividendDates?.get(normalizeSpanishNif(recipient.taxId)) ?? [])].sort();
          return {
            taxId: recipient.taxId,
            name: recipient.name,
            key: recipient.key,
            nature: recipient.nature,
            incomeCents: recipient.incomeCents,
            baseCents: recipient.baseCents,
            rate: recipient.rate,
            withheldCents: recipient.withheldCents,
            accrualDate: recipient.kind === "dividend" ? dates.at(-1) ?? null : null,
            severalDates: recipient.kind === "dividend" && new Set(dates).size > 1,
          };
        }),
        postalCodes: postalCodesOf(extras),
        defaultProvince: options.defaultProvince,
      }), "193", modelo193.reconciliation);
    }
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

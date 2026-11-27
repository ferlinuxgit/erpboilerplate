"use client";

import { useController, useWatch, type Control, type FieldValues, type Path } from "react-hook-form";

import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { INVOICE_DOCUMENT_CLASSES, documentClassHelp, documentClassLabels, isInvoiceDocumentClass } from "@/server/invoices/document-class";
import { LEGAL_MENTION_PRESETS, appendLegalMention } from "@/server/invoices/legal-mentions";

const EXEMPT_CAUSES = [
  ["E1", "Art. 20: sanidad, educación, seguros, alquiler de vivienda…"],
  ["E2", "Art. 21: exportaciones"],
  ["E3", "Art. 22: operaciones asimiladas a exportaciones"],
  ["E4", "Arts. 23 y 24: zonas francas y regímenes aduaneros"],
  ["E5", "Art. 25: entregas intracomunitarias"],
  ["E6", "Otras causas"],
] as const;
const NOT_SUBJECT_CAUSES = [
  ["N2", "Por reglas de localización (se entiende realizada fuera)"],
  ["N1", "Por los arts. 7, 14 y otros (p. ej. transmisión de un negocio)"],
] as const;
/** Causa habitual de cada tratamiento: es la que se comunica si no se elige otra. */
const DEFAULT_CAUSE: Record<string, string> = { EXEMPT: "E1", DOMESTIC: "E1", EXPORT: "E2", INTRA_EU: "E5", NOT_SUBJECT: "N2" };

type Props<T extends FieldValues> = {
  control: Control<T>;
  operationDateName: Path<T>;
  exemptionCodeName: Path<T>;
  treatmentName: Path<T>;
  operationDateError?: string;
  /** Clase de documento (completa / simplificada). Sin este campo no se ofrece la elección. */
  documentClassName?: Path<T>;
  /** Menciones legales propias de la factura. Sin este campo no se ofrecen. */
  legalMentionsName?: Path<T>;
  legalMentionsError?: string;
  /** Ofrece las menciones habituales de la normativa española (regímenes especiales, art. 20 de la Ley del IVA). */
  legalMentionPresets?: boolean;
};

/**
 * Datos fiscales poco habituales de la factura, plegados para no estorbar: la fecha de la operación
 * (solo si no coincide con la de emisión), la causa de exención o de no sujeción que se comunica a
 * la AEAT en el registro VERI*FACTU, la clase de documento y las menciones legales que deben
 * imprimirse (regímenes especiales, artículo de la exención…).
 */
export function InvoiceFiscalExtrasFields<T extends FieldValues>({
  control,
  documentClassName,
  exemptionCodeName,
  legalMentionPresets = false,
  legalMentionsError,
  legalMentionsName,
  operationDateError,
  operationDateName,
  treatmentName,
}: Props<T>) {
  const operationDate = useController({ control, name: operationDateName });
  const exemptionCode = useController({ control, name: exemptionCodeName });
  // Sin nombre propio se reutiliza el de la causa de exención solo para cumplir las reglas de los hooks; no se pinta.
  const documentClass = useController({ control, name: documentClassName ?? exemptionCodeName });
  const legalMentions = useController({ control, name: legalMentionsName ?? exemptionCodeName });
  const treatment = String(useWatch({ control, name: treatmentName }) ?? "DOMESTIC");
  const causes = treatment === "NOT_SUBJECT" ? NOT_SUBJECT_CAUSES : treatment === "EXEMPT" || treatment === "DOMESTIC" ? EXEMPT_CAUSES : null;
  const allowed = causes?.some(([code]) => code === exemptionCode.field.value);
  const selected = allowed ? String(exemptionCode.field.value) : "";
  const selectedClass = documentClassName && isInvoiceDocumentClass(documentClass.field.value) ? documentClass.field.value : "";
  const mentions = legalMentionsName ? String(legalMentions.field.value ?? "") : "";
  const filled = Boolean(operationDate.field.value) || Boolean(selected) || Boolean(selectedClass) || Boolean(mentions.trim());

  return (
    <details className="rounded-surface border px-3 py-2 text-sm sm:col-span-2" open={filled || undefined}>
      <summary className="cursor-pointer font-mono text-xs font-bold">
        {documentClassName || legalMentionsName ? "Más datos fiscales: fecha de operación, exención, clase de factura y menciones legales (opcional)" : "Fecha de operación y causa de exención (opcional)"}
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <AccessibleField
          error={operationDateError}
          helperText="Solo si entregaste o prestaste el servicio en una fecha distinta de la de emisión."
          id="invoice-operation-date"
          label="Fecha de operación"
        >
          <Input
            name={operationDate.field.name}
            onBlur={operationDate.field.onBlur}
            onChange={(event) => operationDate.field.onChange(event.target.value)}
            type="date"
            value={(operationDate.field.value as string | undefined) ?? ""}
          />
        </AccessibleField>
        {causes ? (
          <AccessibleField
            helperText={treatment === "DOMESTIC" ? "Solo se usa si alguna línea va sin impuesto: se comunica a la AEAT y se imprime en la factura." : "Es la causa que se comunica a la AEAT con la factura."}
            id="invoice-exemption-code"
            label={treatment === "NOT_SUBJECT" ? "Causa de no sujeción" : "Causa de exención"}
          >
            <Select
              name={exemptionCode.field.name}
              onBlur={exemptionCode.field.onBlur}
              onChange={(event) => exemptionCode.field.onChange(event.target.value || null)}
              value={selected}
            >
              <option value="">Habitual ({DEFAULT_CAUSE[treatment] ?? "E1"})</option>
              {causes.map(([code, label]) => <option key={code} value={code}>{code} · {label}</option>)}
            </Select>
          </AccessibleField>
        ) : null}
        {documentClassName ? (
          <AccessibleField
            className="sm:col-span-2"
            helperText={selectedClass ? documentClassHelp[selectedClass] : "Automática: factura completa si el cliente tiene NIF y simplificada si no lo tiene."}
            id="invoice-document-class"
            label="Clase de factura"
          >
            <Select
              data-testid="invoice-document-class"
              name={documentClass.field.name}
              onBlur={documentClass.field.onBlur}
              onChange={(event) => documentClass.field.onChange(event.target.value || null)}
              value={selectedClass}
            >
              <option value="">Automática</option>
              {INVOICE_DOCUMENT_CLASSES.map((value) => <option key={value} value={value}>{documentClassLabels[value]}</option>)}
            </Select>
          </AccessibleField>
        ) : null}
        {legalMentionsName ? (
          <div className="space-y-2 sm:col-span-2">
            {legalMentionPresets ? <AccessibleField
              helperText="Elige una mención habitual para añadirla al texto de abajo. Puedes retocarlo."
              id="invoice-legal-mention-preset"
              label="Añadir una mención habitual"
            >
              <Select
                data-testid="invoice-legal-mention-preset"
                onChange={(event) => {
                  const preset = LEGAL_MENTION_PRESETS.find((entry) => entry.id === event.target.value);
                  if (preset) legalMentions.field.onChange(appendLegalMention(mentions, preset.text));
                  event.target.value = "";
                }}
                value=""
              >
                <option value="">Elegir…</option>
                {LEGAL_MENTION_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              </Select>
            </AccessibleField> : null}
            <AccessibleField
              error={legalMentionsError}
              helperText="Se imprime en la factura y queda fijado al emitirla. Ejemplos: régimen especial aplicado o artículo de la exención."
              id="invoice-legal-mentions"
              label="Menciones legales"
            >
              <Textarea
                data-testid="invoice-legal-mentions"
                name={legalMentions.field.name}
                onBlur={legalMentions.field.onBlur}
                onChange={(event) => legalMentions.field.onChange(event.target.value)}
                rows={3}
                value={mentions}
              />
            </AccessibleField>
          </div>
        ) : null}
      </div>
    </details>
  );
}

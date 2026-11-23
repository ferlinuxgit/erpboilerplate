"use client";

import { useController, useWatch, type Control, type FieldValues, type Path } from "react-hook-form";

import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

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
};

/**
 * Datos fiscales poco habituales de la factura, plegados para no estorbar: la fecha de la operación
 * (solo si no coincide con la de emisión) y la causa de exención o de no sujeción que se comunica a
 * la AEAT en el registro VERI*FACTU.
 */
export function InvoiceFiscalExtrasFields<T extends FieldValues>({ control, exemptionCodeName, operationDateError, operationDateName, treatmentName }: Props<T>) {
  const operationDate = useController({ control, name: operationDateName });
  const exemptionCode = useController({ control, name: exemptionCodeName });
  const treatment = String(useWatch({ control, name: treatmentName }) ?? "DOMESTIC");
  const causes = treatment === "NOT_SUBJECT" ? NOT_SUBJECT_CAUSES : treatment === "EXEMPT" || treatment === "DOMESTIC" ? EXEMPT_CAUSES : null;
  const allowed = causes?.some(([code]) => code === exemptionCode.field.value);
  const selected = allowed ? String(exemptionCode.field.value) : "";
  const filled = Boolean(operationDate.field.value) || Boolean(selected);

  return (
    <details className="rounded-surface border px-3 py-2 text-sm sm:col-span-2" open={filled || undefined}>
      <summary className="cursor-pointer font-mono text-xs font-bold">Fecha de operación y causa de exención (opcional)</summary>
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
            helperText={treatment === "DOMESTIC" ? "Solo se usa si alguna línea va sin impuesto." : "Es la causa que se comunica a la AEAT con la factura."}
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
      </div>
    </details>
  );
}

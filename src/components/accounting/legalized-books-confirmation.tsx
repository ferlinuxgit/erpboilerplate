"use client";

import { InlineAlert } from "@/components/ui/page";
import { legalizedBooksWarning } from "@/server/accounting/books/legalization-model";

/**
 * Aviso de ejercicio con libros presentados a legalizar, con la casilla de confirmación expresa que
 * exige el servidor antes de modificar su contabilidad.
 */
export function LegalizedBooksConfirmation({
  checked,
  disabled,
  id,
  label = "Lo entiendo y quiero continuar igualmente",
  notice,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  id: string;
  label?: string;
  notice: { code: string; submittedAt: string | null; registryName?: string | null };
  onChange: (checked: boolean) => void;
}) {
  return (
    <InlineAlert role="alert" title={`Ejercicio ${notice.code} con libros legalizados`} tone="warning">
      <p>{legalizedBooksWarning({ yearCode: notice.code, submittedAt: notice.submittedAt, registryName: notice.registryName })}</p>
      <label className="mt-2 flex items-start gap-2 font-bold" htmlFor={id}>
        <input checked={checked} className="mt-0.5" disabled={disabled} id={id} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
        <span>{label}</span>
      </label>
    </InlineAlert>
  );
}

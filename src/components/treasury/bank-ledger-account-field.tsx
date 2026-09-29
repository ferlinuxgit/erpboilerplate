"use client";

import { AccessibleField } from "@/components/ui/form";
import { Select } from "@/components/ui/select";

export type LedgerAccountOption = { id: string; code: string; name: string };

/** Selector de la subcuenta contable (grupo 57) donde se registran cobros, pagos y movimientos del banco. */
export function BankLedgerAccountField({
  id,
  onChange,
  options,
  value,
}: {
  id: string;
  onChange: (value: string) => void;
  options: LedgerAccountOption[];
  value: string;
}) {
  return (
    <AccessibleField
      helperText="Subcuenta de tesorería donde se contabilizan los cobros, pagos y movimientos de este banco. Si no eliges ninguna, el banco tiene su propia subcuenta 572 (57200001, 57200002…) con su nombre."
      id={id}
      label="Cuenta contable"
    >
      <Select id={id} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">Subcuenta propia del banco (automática)</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.code} · {option.name}
          </option>
        ))}
      </Select>
    </AccessibleField>
  );
}

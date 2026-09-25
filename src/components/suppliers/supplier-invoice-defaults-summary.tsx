import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { PageSection } from "@/components/ui/page";
import type { SupplierVatTreatment } from "@/lib/fiscal-spain";
import { formatPercent } from "@/lib/format";
import { supplierDefaultsFromRow } from "@/lib/supplier-defaults";

/** Tratamiento de IVA explicado para quien no es contable. */
const vatTreatmentPlain: Record<SupplierVatTreatment, string> = {
  DOMESTIC: "Nacional: sus facturas llevan IVA español normal.",
  INTRA_EU: "Compra a otro país de la UE: la factura llega sin IVA y lo declaras tú (se suma y se resta en el 303).",
  REVERSE_CHARGE: "Inversión del sujeto pasivo: la factura llega sin IVA y lo declaras tú.",
  IMPORT: "Importación: el IVA se paga en la aduana (DUA), no al proveedor.",
  NOT_SUBJECT: "No sujeta: sus facturas no llevan IVA.",
};

type SupplierDefaultsRow = Parameters<typeof supplierDefaultsFromRow>[0];

/**
 * Resumen de solo lectura de los valores que se proponen al registrar facturas de este
 * proveedor (cuenta de gasto, IRPF, IVA deducible, tratamiento de IVA y días de pago).
 */
export function SupplierInvoiceDefaultsSummary({
  editHref,
  expenseAccount,
  supplier,
}: {
  editHref: string;
  expenseAccount: { code: string; name: string } | null;
  supplier: SupplierDefaultsRow;
}) {
  const defaults = supplierDefaultsFromRow(supplier);
  const days = defaults.paymentTermsDays;
  const rows: Array<{ label: string; value: string; empty: boolean }> = [
    {
      label: "Cuenta de gasto habitual",
      value: expenseAccount ? `${expenseAccount.code} · ${expenseAccount.name}` : "Sin cuenta habitual: se elige en cada factura",
      empty: !expenseAccount,
    },
    {
      label: "Retención IRPF",
      value: defaults.defaultRetentionRate ? formatPercent(defaults.defaultRetentionRate) : "Sin retención",
      empty: !defaults.defaultRetentionRate,
    },
    {
      label: "IVA deducible",
      value: defaults.defaultTaxDeductiblePct === null ? "100 % (todo el IVA se recupera)" : formatPercent(defaults.defaultTaxDeductiblePct),
      empty: defaults.defaultTaxDeductiblePct === null,
    },
    {
      label: "Tratamiento de IVA",
      value: defaults.defaultVatTreatment ? vatTreatmentPlain[defaults.defaultVatTreatment] : "Automático según el país del proveedor.",
      empty: !defaults.defaultVatTreatment,
    },
    {
      label: "Días de pago",
      value:
        days === null
          ? "Sin días de pago: no se calcula el vencimiento"
          : days === 0
            ? "Al contado (vence el mismo día de la factura)"
            : `${days} días desde la fecha de la factura`,
      empty: days === null,
    },
  ];

  return (
    <PageSection
      actions={
        <Link aria-label="Editar los valores habituales del proveedor" className={buttonVariants({ variant: "outline", size: "sm" })} href={editHref}>
          Editar
        </Link>
      }
      description="Se proponen solos al registrar sus facturas, con OCR o a mano; siempre puedes cambiarlos en cada factura."
      title="Valores habituales de sus facturas"
    >
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        {rows.map((row) => (
          <div className="contents" key={row.label}>
            <dt className="text-xs font-semibold text-muted-foreground sm:pt-0.5">{row.label}</dt>
            <dd className={row.empty ? "text-muted-foreground" : undefined}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </PageSection>
  );
}

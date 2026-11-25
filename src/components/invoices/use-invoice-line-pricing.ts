"use client";

import { useRef } from "react";
import type { FieldValues, UseFormGetValues, UseFormRegister, UseFormSetValue } from "react-hook-form";
import { toast } from "sonner";

import { useCustomerPricing } from "@/components/invoices/use-customer-pricing";
import { describeCustomerPricing, resolveLinePrice, type SaleCatalogEntry } from "@/lib/pricing";

type PricedLine = { itemId?: string | null; unitPrice?: number; discountPct?: number };
type LinesForm = { lines: Array<PricedLine & { description: string; unitPrice: number; discountPct?: number }> };

/**
 * Artículo y precio en las líneas de factura (formularios con react-hook-form):
 * - elegir un artículo rellena el concepto, el precio de la tarifa del cliente y su descuento de grupo;
 * - al cambiar de cliente se recalculan las líneas que tienen artículo.
 */
export function useInvoiceLinePricing<T extends FieldValues>({
  catalog,
  customerId,
  getValues,
  initialCustomerId,
  register,
  setValue,
}: {
  catalog: SaleCatalogEntry[];
  customerId: string | null | undefined;
  getValues: UseFormGetValues<T>;
  initialCustomerId?: string | null;
  register: UseFormRegister<T>;
  setValue: UseFormSetValue<T>;
}) {
  // Los tipos de los dos formularios de factura difieren; las líneas comparten forma.
  const set = setValue as unknown as UseFormSetValue<LinesForm>;
  const get = getValues as unknown as UseFormGetValues<LinesForm>;
  const reg = register as unknown as UseFormRegister<LinesForm>;
  const pricedCustomerRef = useRef<string | null>(initialCustomerId ?? null);
  const options = { shouldDirty: true, shouldValidate: true } as const;

  const { pricing } = useCustomerPricing(customerId, (loaded, loadedFor) => {
    if (pricedCustomerRef.current === loadedFor) return;
    pricedCustomerRef.current = loadedFor;
    let changed = 0;
    (get("lines") ?? []).forEach((line, index) => {
      const entry = line?.itemId ? catalog.find((candidate) => candidate.id === line.itemId) : undefined;
      if (!entry) return;
      const resolved = resolveLinePrice(entry, loaded);
      if (resolved.unitPrice === Number(line.unitPrice) && resolved.discountPct === Number(line.discountPct ?? 0)) return;
      changed += 1;
      set(`lines.${index}.unitPrice`, resolved.unitPrice, options);
      set(`lines.${index}.discountPct`, resolved.discountPct, options);
    });
    if (changed) toast.info(`Precios de ${changed} línea(s) actualizados para este cliente.`);
  });

  const applyItem = (index: number, itemId: string) => {
    const entry = catalog.find((candidate) => candidate.id === itemId);
    if (!entry) return;
    const resolved = resolveLinePrice(entry, pricing);
    set(`lines.${index}.description`, entry.name, options);
    set(`lines.${index}.unitPrice`, resolved.unitPrice, options);
    set(`lines.${index}.discountPct`, resolved.discountPct, options);
  };

  return {
    itemOptions: catalog.map((entry) => ({ id: entry.id, label: `${entry.sku} · ${entry.name}` })),
    pricingHint: catalog.length ? describeCustomerPricing(pricing) : null,
    itemBinding: (index: number) =>
      reg(`lines.${index}.itemId`, {
        setValueAs: (value: unknown) => (typeof value === "string" && value ? value : null),
        onChange: (event: { target: { value: string } }) => applyItem(index, event.target.value),
      }),
  };
}

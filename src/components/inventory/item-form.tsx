"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput, QuantityInput } from "@/components/ui/number-input";
import { getCsrfHeader } from "@/lib/csrf-client";
import { parseDecimalInput } from "@/lib/format";

export type ItemFormValues = { name: string; sku: string; isService: boolean; salePrice: string; costPrice: string; minimumStock: string };
type ItemFieldErrors = Partial<Record<"name" | "sku" | "salePrice" | "costPrice" | "minimumStock", string>>;

const defaults: ItemFormValues = { name: "", sku: "", isService: false, salePrice: "0", costPrice: "0", minimumStock: "0" };

function parseMoney(raw: string) {
  return parseDecimalInput(raw, { maximumFractionDigits: 2 });
}

export function ItemForm({ id, initialValues = defaults }: { id?: string; initialValues?: ItemFormValues }) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ItemFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (key: keyof ItemFormValues, value: string | boolean) => setValues((current) => ({ ...current, [key]: value }));

  const validate = () => {
    const next: ItemFieldErrors = {};
    if (!values.name.trim()) next.name = "Indica el nombre del artículo.";
    if (!values.sku.trim()) next.sku = "Indica un SKU (código interno del artículo).";
    const salePrice = parseMoney(values.salePrice);
    if (salePrice === null || salePrice < 0) next.salePrice = "Introduce un precio válido igual o mayor que 0 (por ejemplo, 12,50).";
    const costPrice = parseMoney(values.costPrice);
    if (costPrice === null || costPrice < 0) next.costPrice = "Introduce un coste válido igual o mayor que 0.";
    const minimumStock = parseDecimalInput(values.minimumStock);
    if (!values.isService && (minimumStock === null || minimumStock < 0)) next.minimumStock = "Introduce una cantidad válida igual o mayor que 0.";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!validate()) {
      toast.error("Revisa los campos marcados antes de guardar.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(id ? `/api/items/${id}` : "/api/items", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          ...values,
          salePrice: parseMoney(values.salePrice) ?? 0,
          costPrice: parseMoney(values.costPrice) ?? 0,
          minimumStock: parseDecimalInput(values.minimumStock) ?? 0,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar el artículo."));
      const payload = (await response.json().catch(() => ({}))) as { id?: string };
      toast.success(id ? "Artículo actualizado correctamente." : "Artículo creado correctamente.");
      router.push(`/inventory/items/${payload.id ?? id}`);
      router.refresh();
    } catch (error) {
      const message = errorMessage(error, "No se pudo guardar el artículo.");
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="space-y-3" noValidate onSubmit={submit}>
      <RequiredFieldsNote />
      <div className="grid gap-3 md:grid-cols-2">
        <AccessibleField error={fieldErrors.name} id="item-name" label="Nombre" required>
          <Input id="item-name" autoFocus onChange={(event) => set("name", event.target.value)} required value={values.name} />
        </AccessibleField>
        <AccessibleField error={fieldErrors.sku} helperText="Código interno único; se muestra en documentos y movimientos." id="item-sku" label="SKU" required>
          <Input id="item-sku" className="font-mono" onChange={(event) => set("sku", event.target.value.toUpperCase())} required value={values.sku} />
        </AccessibleField>
        <AccessibleField error={fieldErrors.salePrice} helperText="Precio sin impuestos." id="item-sale-price" label="Precio de venta" required>
          <MoneyInput id="item-sale-price" onChange={(event) => set("salePrice", event.target.value)} required value={values.salePrice} />
        </AccessibleField>
        <AccessibleField error={fieldErrors.costPrice} helperText="Coste unitario orientativo para márgenes." id="item-cost-price" label="Coste de referencia" required>
          <MoneyInput id="item-cost-price" onChange={(event) => set("costPrice", event.target.value)} required value={values.costPrice} />
        </AccessibleField>
        <AccessibleField
          error={fieldErrors.minimumStock}
          helperText={values.isService ? "Los servicios no controlan stock." : "Por debajo de esta cantidad aparecerá una alerta."}
          id="item-minimum-stock"
          label="Stock mínimo"
          required={!values.isService}
        >
          <QuantityInput id="item-minimum-stock" disabled={values.isService} onChange={(event) => set("minimumStock", event.target.value)} required={!values.isService} value={values.minimumStock} />
        </AccessibleField>
        <label className="flex cursor-pointer items-center gap-2 self-end border border-window-dark-shadow bg-window-panel p-2.5 font-mono text-xs font-bold shadow-[inset_1px_1px_0_var(--window-highlight)]" htmlFor="item-is-service">
          <input checked={values.isService} id="item-is-service" onChange={(event) => set("isService", event.target.checked)} type="checkbox" />
          Es un servicio sin control de stock
        </label>
      </div>
      <FormErrorMessage>{formError}</FormErrorMessage>
      <FormActions>
        <SubmitButton aria-keyshortcuts="Control+Enter Meta+Enter" pending={loading}>
          {id ? "Guardar cambios" : "Crear artículo"}
        </SubmitButton>
      </FormActions>
    </form>
  );
}

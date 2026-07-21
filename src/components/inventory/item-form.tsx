"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";

export type ItemFormValues = { name: string; sku: string; isService: boolean; salePrice: string; costPrice: string; minimumStock: string };
const defaults: ItemFormValues = { name: "", sku: "", isService: false, salePrice: "0", costPrice: "0", minimumStock: "0" };

export function ItemForm({ id, initialValues = defaults }: { id?: string; initialValues?: ItemFormValues }) {
  const router = useRouter(); const [values, setValues] = useState(initialValues); const [loading, setLoading] = useState(false);
  const set = (key: keyof ItemFormValues, value: string | boolean) => setValues((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setLoading(true); try { const response = await fetch(id ? `/api/items/${id}` : "/api/items", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify({ ...values, salePrice: Number(values.salePrice), costPrice: Number(values.costPrice), minimumStock: Number(values.minimumStock) }) }); const payload = (await response.json()) as { id?: string; message?: string }; if (!response.ok) throw new Error(payload.message ?? "No se pudo guardar el artículo."); toast.success(id ? "Artículo actualizado." : "Artículo creado."); router.push(`/inventory/items/${payload.id ?? id}`); router.refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : "Error inesperado."); } finally { setLoading(false); } };
  return <form className="space-y-3" onSubmit={submit}><div className="grid gap-4 md:grid-cols-2"><label className="space-y-1.5 text-sm font-medium">Nombre<Input autoFocus onChange={(event) => set("name", event.target.value)} required value={values.name} /></label><label className="space-y-1.5 text-sm font-medium">SKU<Input className="font-mono" onChange={(event) => set("sku", event.target.value.toUpperCase())} required value={values.sku} /></label><label className="space-y-1.5 text-sm font-medium">Precio de venta<Input min="0" onChange={(event) => set("salePrice", event.target.value)} required step="0.01" type="number" value={values.salePrice} /></label><label className="space-y-1.5 text-sm font-medium">Coste de referencia<Input min="0" onChange={(event) => set("costPrice", event.target.value)} required step="0.01" type="number" value={values.costPrice} /></label><label className="space-y-1.5 text-sm font-medium">Stock mínimo<Input disabled={values.isService} min="0" onChange={(event) => set("minimumStock", event.target.value)} required step="0.001" type="number" value={values.minimumStock} /></label><label className="flex items-center gap-3 self-end rounded-[2px] border p-3 text-sm font-medium"><input checked={values.isService} onChange={(event) => set("isService", event.target.checked)} type="checkbox" />Es un servicio sin control de stock</label></div><div className="flex justify-end border-t pt-5"><Button disabled={loading} type="submit">{loading ? "Guardando…" : id ? "Guardar cambios" : "Crear artículo"}</Button></div></form>;
}

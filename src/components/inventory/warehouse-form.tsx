"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";

export function WarehouseForm({ id, initialValues = { name: "", code: "" } }: { id?: string; initialValues?: { name: string; code: string } }) {
  const router = useRouter(); const [name, setName] = useState(initialValues.name); const [code, setCode] = useState(initialValues.code); const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setLoading(true); try { const response = await fetch(id ? `/api/warehouses/${id}` : "/api/warehouses", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify({ name, code }) }); const payload = (await response.json()) as { id?: string; message?: string }; if (!response.ok) throw new Error(payload.message ?? "No se pudo guardar el almacén."); toast.success(id ? "Almacén actualizado." : "Almacén creado."); router.push(`/inventory/warehouses/${payload.id ?? id}`); router.refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : "Error inesperado."); } finally { setLoading(false); } };
  return <form className="space-y-6" onSubmit={submit}><div className="grid gap-4 md:grid-cols-2"><label className="space-y-1.5 text-sm font-medium">Código<Input autoFocus className="font-mono" onChange={(event) => setCode(event.target.value.toUpperCase())} required value={code} /></label><label className="space-y-1.5 text-sm font-medium">Nombre<Input onChange={(event) => setName(event.target.value)} required value={name} /></label></div><div className="flex justify-end border-t pt-5"><Button disabled={loading} type="submit">{loading ? "Guardando…" : id ? "Guardar cambios" : "Crear almacén"}</Button></div></form>;
}

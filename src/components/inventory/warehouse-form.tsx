"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";

type WarehouseFieldErrors = Partial<Record<"code" | "name", string>>;

export function WarehouseForm({ id, initialValues = { name: "", code: "" } }: { id?: string; initialValues?: { name: string; code: string } }) {
  const router = useRouter();
  const [name, setName] = useState(initialValues.name);
  const [code, setCode] = useState(initialValues.code);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<WarehouseFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const validate = () => {
    const next: WarehouseFieldErrors = {};
    if (!code.trim()) next.code = "Indica un código corto para el almacén (por ejemplo, CENTRAL).";
    if (!name.trim()) next.name = "Indica el nombre del almacén.";
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
      const response = await fetch(id ? `/api/warehouses/${id}` : "/api/warehouses", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ name, code }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar el almacén."));
      const payload = (await response.json().catch(() => ({}))) as { id?: string };
      toast.success(id ? "Almacén actualizado correctamente." : "Almacén creado correctamente.");
      router.push(`/inventory/warehouses/${payload.id ?? id}`);
      router.refresh();
    } catch (error) {
      const message = errorMessage(error, "No se pudo guardar el almacén.");
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
        <AccessibleField error={fieldErrors.code} helperText="Código corto que verás en documentos y filtros." id="warehouse-code" label="Código" required>
          <Input
            id="warehouse-code"
            autoFocus
            className="font-mono"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            required
            value={code}
          />
        </AccessibleField>
        <AccessibleField error={fieldErrors.name} id="warehouse-name" label="Nombre" required>
          <Input id="warehouse-name" onChange={(event) => setName(event.target.value)} required value={name} />
        </AccessibleField>
      </div>
      <FormErrorMessage>{formError}</FormErrorMessage>
      <FormActions>
        <SubmitButton aria-keyshortcuts="Control+Enter Meta+Enter" pending={loading}>
          {id ? "Guardar cambios" : "Crear almacén"}
        </SubmitButton>
      </FormActions>
    </form>
  );
}

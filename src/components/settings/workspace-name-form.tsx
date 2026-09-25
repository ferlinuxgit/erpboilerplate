"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AccessibleField, SubmitButton, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { invalidateActiveContext } from "@/lib/active-context-client";
import { getCsrfHeader } from "@/lib/csrf-client";

/** Renombra el espacio de trabajo (lo ven los invitados en el correo y en el selector de espacios). */
export function WorkspaceNameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setError("El nombre debe tener al menos 2 caracteres.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/tenant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo renombrar el espacio de trabajo."));
      invalidateActiveContext();
      toast.success("Nombre del espacio de trabajo actualizado.");
      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "No se pudo renombrar el espacio de trabajo.";
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void submit(event)}>
      <AccessibleField
        className="min-w-64 flex-1"
        error={error ?? undefined}
        helperText="Lo verán las personas que invites. Suele coincidir con el nombre de tu empresa o asesoría."
        id="workspace-name"
        label="Nombre del espacio de trabajo"
        required
      >
        <Input maxLength={80} onChange={(event) => setName(event.target.value)} value={name} />
      </AccessibleField>
      <SubmitButton disabled={name.trim() === initialName.trim()} pending={pending}>Guardar nombre</SubmitButton>
    </form>
  );
}

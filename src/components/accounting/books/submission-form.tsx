"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FAILURE = "No se pudo anotar la presentación.";

/** Anota la presentación en el Registro Mercantil de un juego de libros ya generado. */
export function SubmissionForm({ submissionId, today }: { submissionId: string; today: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/accounting/books/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          submittedAt: String(form.get("submittedAt") ?? ""),
          registryName: String(form.get("registryName") ?? ""),
          submissionReference: String(form.get("submissionReference") ?? ""),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, FAILURE));
      toast.success("Presentación anotada.");
      router.refresh();
    } catch (cause) {
      const message = errorMessage(cause, FAILURE);
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void submit(event)}>
      <div className="space-y-1">
        <Label htmlFor={`submitted-at-${submissionId}`}>Fecha de presentación</Label>
        <Input className="w-40" defaultValue={today} id={`submitted-at-${submissionId}`} max={today} name="submittedAt" required type="date" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`registry-${submissionId}`}>Registro Mercantil</Label>
        <Input className="w-48" id={`registry-${submissionId}`} maxLength={120} name="registryName" placeholder="Madrid" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`reference-${submissionId}`}>N.º de entrada o referencia</Label>
        <Input className="w-48" id={`reference-${submissionId}`} maxLength={120} name="submissionReference" />
      </div>
      <Button aria-busy={pending} disabled={pending} type="submit">{pending ? "Guardando…" : "Anotar presentación"}</Button>
      {error ? <p className="w-full text-sm text-danger-text" role="alert">{error}</p> : null}
    </form>
  );
}

/** Deshace una presentación anotada por error. */
export function UndoSubmissionButton({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function undo() {
    if (!window.confirm("¿Deshacer la anotación de esta presentación? Los ficheros y sus huellas se conservan.")) return;
    setPending(true);
    try {
      const response = await fetch(`/api/accounting/books/submissions?id=${encodeURIComponent(submissionId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo deshacer la anotación."));
      toast.success("Anotación deshecha.");
      router.refresh();
    } catch (cause) {
      toast.error(errorMessage(cause, "No se pudo deshacer la anotación."));
    } finally {
      setPending(false);
    }
  }

  return <Button disabled={pending} onClick={() => void undo()} size="sm" type="button" variant="ghost">Deshacer anotación</Button>;
}

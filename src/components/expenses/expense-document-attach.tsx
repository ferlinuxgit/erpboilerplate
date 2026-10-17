"use client";

import { Paperclip } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";

/**
 * Adjunta el documento de una factura ya registrada. Si su documento se perdió, el archivo nuevo
 * ocupa su lugar (los enlaces de la ficha y de la exportación siguen funcionando).
 */
export function ExpenseDocumentAttach({ expenseId, replacesMissing }: { expenseId: string; replacesMissing: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch(`/api/expenses/${expenseId}/document`, { method: "POST", headers: getCsrfHeader(), body: formData });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo adjuntar el documento."));
      const result = (await response.json()) as { mode: "restored" | "added" };
      toast.success(result.mode === "restored" ? "Documento repuesto." : "Documento adjuntado.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo adjuntar el documento."));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="sr-only"
        data-testid="expense-document-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      <Button aria-busy={uploading} disabled={uploading} onClick={() => inputRef.current?.click()} size="sm" type="button" variant={replacesMissing ? "default" : "outline"}>
        <Paperclip aria-hidden="true" /> {uploading ? "Subiendo…" : replacesMissing ? "Reponer documento" : "Adjuntar documento"}
      </Button>
    </>
  );
}

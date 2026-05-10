"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { getCsrfHeader } from "@/lib/csrf-client";

type DeleteButtonProps = {
  url: string;
  label?: string;
  title?: string;
  description?: string;
  successMessage?: string;
};

export function DeleteButton({
  url,
  label = "Eliminar",
  title = "Eliminar registro",
  description = "Esta acción no se puede deshacer. Confirma que quieres eliminar este registro.",
  successMessage = "Registro eliminado correctamente.",
}: DeleteButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch(url, { method: "DELETE", headers: getCsrfHeader() });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "No se pudo eliminar el registro.");
      }
      setIsOpen(false);
      toast.success(successMessage);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error inesperado al eliminar.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button type="button" variant="destructive" size="sm" onClick={() => setIsOpen(true)} disabled={isSubmitting}>
        {label}
      </Button>
      <DestructiveActionDialog
        open={isOpen}
        title={title}
        description={description}
        confirmLabel={label}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        onCancel={() => {
          if (!isSubmitting) {
            setIsOpen(false);
            setErrorMessage(null);
          }
        }}
        onConfirm={handleConfirm}
      />
    </>
  );
}

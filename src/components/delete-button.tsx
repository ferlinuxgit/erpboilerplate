"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { errorMessage as describeError, readApiError } from "@/components/ui/form";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { getCsrfHeader } from "@/lib/csrf-client";

type DeleteButtonProps = {
  url: string;
  redirectTo?: string;
  label?: string;
  title?: string;
  description?: string;
  successMessage?: string;
  /** Render the trigger as an item of a `DropdownMenu` ("Más" menu). */
  asMenuItem?: boolean;
  testId?: string;
};

export function DeleteButton({
  url,
  redirectTo,
  label = "Eliminar",
  title = "Eliminar registro",
  description = "Esta acción no se puede deshacer. Confirma que quieres eliminar este registro.",
  successMessage = "Registro eliminado correctamente.",
  asMenuItem = false,
  testId,
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
        throw new Error(await readApiError(response, `No se pudo ${label.toLocaleLowerCase()} el registro.`));
      }
      setIsOpen(false);
      toast.success(successMessage);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } catch (error) {
      const message = describeError(error, `No se pudo ${label.toLocaleLowerCase()} el registro.`);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {asMenuItem ? (
        <DropdownMenuItem data-testid={testId} destructive disabled={isSubmitting} onClick={() => setIsOpen(true)}>
          {label}…
        </DropdownMenuItem>
      ) : (
        <Button aria-label={title !== "Eliminar registro" ? title : undefined} data-testid={testId} type="button" variant="destructive" size="sm" onClick={() => setIsOpen(true)} disabled={isSubmitting}>
          {label}
        </Button>
      )}
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

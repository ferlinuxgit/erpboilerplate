"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type DeleteButtonProps = {
  url: string;
  label?: string;
};

export function DeleteButton({ url, label = "Eliminar" }: DeleteButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDelete = async () => {
    const confirmed = window.confirm("Esta acción no se puede deshacer. ¿Continuar?");
    if (!confirmed) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(url, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("No se pudo eliminar el registro.");
      }
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Error inesperado al eliminar.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Button type="button" variant="destructive" size="sm" onClick={handleDelete} disabled={isSubmitting}>
      {isSubmitting ? "Eliminando..." : label}
    </Button>
  );
}

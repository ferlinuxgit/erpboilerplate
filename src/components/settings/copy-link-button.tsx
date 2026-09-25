"use client";

import { Copy } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/** Copia un enlace (p. ej. de invitación) para compartirlo por otro canal. */
export function CopyLinkButton({ label = "Copiar enlace", size = "sm", url }: { label?: string; size?: "xs" | "sm" | "default"; url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Enlace copiado. Pégalo en un correo o mensaje.");
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("No se pudo copiar automáticamente. Selecciona el enlace y cópialo a mano.");
    }
  }

  return (
    <Button onClick={() => void copy()} size={size} type="button" variant="outline">
      <Copy aria-hidden="true" />
      {copied ? "Copiado" : label}
    </Button>
  );
}

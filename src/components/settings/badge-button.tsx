"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function BadgeButton({ value }: { value: string }) {
  async function copy() {
    await navigator.clipboard.writeText(value);
    toast.success("Copiado.");
  }

  return (
    <Button onClick={copy} size="sm" type="button" variant="outline">
      <Copy aria-hidden="true" />
      Copiar
    </Button>
  );
}

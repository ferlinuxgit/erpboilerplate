"use client";

import { Power } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { invalidateActiveContext } from "@/lib/active-context-client";
import { getCsrfHeader } from "@/lib/csrf-client";
import type { ModuleId } from "@/modules/registry";

/** Activa el módulo y vuelve a la página que se quería abrir. */
export function ActivateModuleButton({ moduleId, moduleName, returnTo }: { moduleId: ModuleId; moduleName: string; returnTo: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function activate() {
    setSaving(true);
    try {
      const response = await fetch("/api/modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ moduleId, enabled: true }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo activar el módulo."));
      invalidateActiveContext();
      toast.success(`«${moduleName}» activado.`);
      router.replace(returnTo);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo activar el módulo."));
      setSaving(false);
    }
  }

  return (
    <Button data-testid="activate-module" disabled={saving} onClick={() => void activate()} type="button">
      <Power aria-hidden="true" /> {saving ? "Activando…" : `Activar ${moduleName}`}
    </Button>
  );
}

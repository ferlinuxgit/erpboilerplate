"use client";

import { useState } from "react";
import { toast } from "sonner";

import { errorMessage, readApiError } from "@/components/ui/form";
import { InlineAlert } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCsrfHeader } from "@/lib/csrf-client";

/** Permiso de empresa para leer facturas recibidas con OpenAI (servicio externo). */
export function ExternalAiSetting({ configured, initialEnabled }: { configured: boolean; initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    setSaving(true);
    try {
      const response = await fetch("/api/expenses/ocr/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ externalAiEnabled: next }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la preferencia."));
      setEnabled(next);
      toast.success(next ? "Lectura con OpenAI permitida para la empresa." : "Lectura con OpenAI desactivada: solo se usará el OCR local.");
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo guardar la preferencia."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Por defecto las facturas recibidas se leen con OCR local, en tu servidor. Con OpenAI la lectura es más precisa, pero el
          documento completo (datos del proveedor, importes y cualquier dato personal) se envía a un proveedor externo con servidores
          fuera de la UE.
        </p>
        <StatusBadge tone={configured && enabled ? "info" : "neutral"}>
          {!configured ? "No disponible" : enabled ? "Permitida" : "Solo OCR local"}
        </StatusBadge>
      </div>
      {configured ? (
        <label className="flex items-center gap-3 rounded-surface border px-3 py-2 text-sm" htmlFor="external-ai-enabled">
          <input
            aria-busy={saving || undefined}
            checked={enabled}
            className="size-4"
            disabled={saving}
            id="external-ai-enabled"
            onChange={(event) => void toggle(event.target.checked)}
            role="switch"
            type="checkbox"
          />
          <span className="font-medium">Permitir leer facturas con OpenAI en esta empresa</span>
        </label>
      ) : (
        <InlineAlert tone="neutral">
          La lectura con OpenAI no está disponible en esta instalación: falta configurar la clave en el servidor (OPENAI_API_KEY).
        </InlineAlert>
      )}
    </div>
  );
}

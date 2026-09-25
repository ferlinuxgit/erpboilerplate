"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { readApiError } from "@/components/ui/form";
import { invalidateActiveContext } from "@/lib/active-context-client";
import { BUSINESS_TYPES, businessTypeDescriptions, businessTypeLabels, type BusinessType } from "@/lib/company-readiness";
import { getCsrfHeader } from "@/lib/csrf-client";
import { cn } from "@/lib/utils";

/** "¿Qué vendes?": adapta el menú y los avisos del panel. Se guarda al elegir. */
export function BusinessTypeForm({ initialValue }: { initialValue: BusinessType }) {
  const router = useRouter();
  const [value, setValue] = useState<BusinessType>(initialValue);
  const [pending, setPending] = useState(false);

  async function choose(next: BusinessType) {
    if (next === value || pending) return;
    const previous = value;
    setValue(next);
    setPending(true);
    try {
      const response = await fetch("/api/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ businessType: next }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar qué vendes."));
      invalidateActiveContext();
      toast.success(`Guardado: ${businessTypeLabels[next].toLocaleLowerCase("es-ES")}. El menú se ha adaptado.`);
      router.refresh();
    } catch (error) {
      setValue(previous);
      toast.error(error instanceof Error ? error.message : "No se pudo guardar qué vendes.");
    } finally {
      setPending(false);
    }
  }

  return (
    <fieldset aria-busy={pending || undefined} className="space-y-1" disabled={pending}>
      <legend className="text-sm font-medium">¿Vendes productos, servicios o ambos?</legend>
      <div className="grid gap-1 sm:grid-cols-3">
        {BUSINESS_TYPES.map((type) => (
          <label
            className={cn(
              "flex cursor-pointer items-start gap-2 border p-2 text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus",
              value === type ? "border-primary bg-primary/10" : "border-window-dark-shadow bg-card hover:bg-window-highlight",
            )}
            key={type}
          >
            <input checked={value === type} className="mt-0.5" name="company-business-type" onChange={() => void choose(type)} type="radio" value={type} />
            <span>
              <span className="block font-mono font-bold">{businessTypeLabels[type]}</span>
              <span className="block text-muted-foreground">{businessTypeDescriptions[type]}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

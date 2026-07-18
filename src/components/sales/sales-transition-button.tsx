"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getCsrfHeader } from "@/lib/csrf-client";

export function SalesTransitionButton({ label, targetBasePath, url }: { label: string; targetBasePath: string; url: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() } });
      const payload = (await response.json()) as { id?: string; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "No se pudo completar la transición.");
      toast.success("Documento actualizado.");
      if (payload.id) router.push(`${targetBasePath}/${payload.id}`);
      else router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  };

  return <Button disabled={loading} onClick={run} type="button">{loading ? "Procesando…" : label}<ArrowRight aria-hidden="true" /></Button>;
}

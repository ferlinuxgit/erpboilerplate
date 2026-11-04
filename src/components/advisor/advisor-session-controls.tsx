"use client";

import { SignOut } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { readApiError } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";

/** Empresa activa (si la gestoría lleva varias con el mismo acceso) y cierre de sesión. */
export function AdvisorSessionControls({ companies, activeAccessId }: { companies: Array<{ accessId: string; companyName: string }>; activeAccessId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function switchCompany(accessId: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/advisor/company", { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify({ accessId }) });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo cambiar de empresa."));
      // El periodo de otra empresa no vale: se vuelve al resumen con su periodo por defecto.
      router.push("/asesor");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar de empresa.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    await fetch("/api/advisor/logout", { method: "POST", headers: getCsrfHeader() }).catch(() => undefined);
    router.push("/asesor/acceso");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {companies.length > 1 ? (
        <label className="flex items-center gap-1.5 text-xs">
          <span className="font-mono font-bold">Empresa</span>
          <Select aria-label="Empresa" className="h-8 w-56" disabled={busy} onChange={(event) => void switchCompany(event.target.value)} value={activeAccessId}>
            {companies.map((entry) => <option key={entry.accessId} value={entry.accessId}>{entry.companyName}</option>)}
          </Select>
        </label>
      ) : null}
      <Button disabled={busy} onClick={() => void signOut()} size="sm" type="button" variant="outline">
        <SignOut aria-hidden="true" />
        Salir
      </Button>
    </div>
  );
}

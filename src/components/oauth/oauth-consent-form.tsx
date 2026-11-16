"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AccessibleField } from "@/components/ui/form";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";

type Company = { tenantId: string; tenantName: string; companyId: string; companyName: string; role: string };

/** Elegir empresa y nivel de acceso y permitir (o denegar) la conexión. */
export function OAuthConsentForm({ clientName, companies, params, requestedScope, userEmail }: {
  clientName: string;
  companies: Company[];
  params: string;
  requestedScope: "read" | "write";
  userEmail: string;
}) {
  const [companyKey, setCompanyKey] = useState(companies[0] ? `${companies[0].tenantId}:${companies[0].companyId}` : "");
  const [scope, setScope] = useState<"read" | "write">(requestedScope);
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "allow" | "deny") {
    setPending(decision);
    setError(null);
    try {
      const [tenantId, companyId] = companyKey.split(":");
      const response = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ params, decision, tenantId, companyId, scope }),
      });
      const body = (await response.json().catch(() => ({}))) as { redirectTo?: string; message?: string };
      if (!response.ok || !body.redirectTo) throw new Error(body.message ?? "No se pudo completar la conexión.");
      window.location.assign(body.redirectTo);
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : "Error inesperado.");
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-mono text-lg font-bold">Conectar {clientName} con tu ERP</h1>
        <p className="mt-1 text-sm text-window-muted">
          {clientName} podrá consultar {scope === "write" ? "y gestionar " : ""}los datos de la empresa que elijas, con tus mismos permisos ({userEmail}).
          Puedes desconectarlo cuando quieras en Configuración › Conectar con IA.
        </p>
      </div>
      {companies.length === 0 ? (
        <InlineAlert tone="warning">No perteneces a ninguna empresa todavía.</InlineAlert>
      ) : (
        <>
          <AccessibleField id="oauth-company" label="Empresa">
            <Select value={companyKey} onChange={(event) => setCompanyKey(event.target.value)}>
              {companies.map((entry) => (
                <option key={`${entry.tenantId}:${entry.companyId}`} value={`${entry.tenantId}:${entry.companyId}`}>
                  {entry.companyName}{entry.tenantName !== entry.companyName ? ` · ${entry.tenantName}` : ""}
                </option>
              ))}
            </Select>
          </AccessibleField>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Qué puede hacer</legend>
            <label className="flex items-start gap-2 text-sm" htmlFor="oauth-scope-read">
              <input checked={scope === "read"} className="mt-1" id="oauth-scope-read" name="scope" onChange={() => setScope("read")} type="radio" />
              <span><span className="block font-medium">Solo consultar</span><span className="text-xs text-window-muted">Ver facturas, clientes, informes, impuestos… sin cambiar nada.</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm" htmlFor="oauth-scope-write">
              <input checked={scope === "write"} className="mt-1" id="oauth-scope-write" name="scope" onChange={() => setScope("write")} type="radio" />
              <span><span className="block font-medium">Consultar y gestionar</span><span className="text-xs text-window-muted">También crear y modificar (facturas, clientes, gastos…), siempre dentro de los permisos de tu rol.</span></span>
            </label>
          </fieldset>
        </>
      )}
      {error ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending !== null || companies.length === 0} onClick={() => void decide("allow")} type="button">
          {pending === "allow" ? "Conectando…" : "Permitir"}
        </Button>
        <Button disabled={pending !== null} onClick={() => void decide("deny")} type="button" variant="outline">
          Cancelar
        </Button>
      </div>
    </div>
  );
}

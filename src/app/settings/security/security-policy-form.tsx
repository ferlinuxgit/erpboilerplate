"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineAlert, PageSection } from "@/components/ui/page";
import { StatusBadge as SharedStatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import type { SecurityPolicyState } from "@/server/security-policy";

type Props = {
  initialPolicy: SecurityPolicyState;
  canManage: boolean;
};

type SubmitState =
  | { type: "idle" }
  | { type: "success"; message: string }
  | { type: "error"; message: string };

type ControlStatus = SecurityPolicyState["controls"][number]["status"];

const statusCopy: Record<ControlStatus, { label: string; tone: "success" | "neutral" | "warning" }> = {
  enabled: {
    label: "Activo",
    tone: "success",
  },
  disabled: {
    label: "Inactivo",
    tone: "neutral",
  },
  not_configured: {
    label: "Sin configurar",
    tone: "warning",
  },
};

function StatusBadge({ status }: { status: ControlStatus }) {
  const copy = statusCopy[status];

  return <SharedStatusBadge tone={copy.tone}>{copy.label}</SharedStatusBadge>;
}

export function SecurityPolicyForm({ initialPolicy, canManage }: Props) {
  const router = useRouter();
  const [policy, setPolicy] = useState(initialPolicy);
  const [state, setState] = useState<SubmitState>({ type: "idle" });
  const [isPending, startTransition] = useTransition();

  const controlRows = policy.controls;

  async function onSubmit(formData: FormData) {
    setState({ type: "idle" });

    const blankToNull = (value: FormDataEntryValue | null) => {
      const text = typeof value === "string" ? value.trim() : "";
      return text.length > 0 ? text : null;
    };

    const numberOrNull = (value: FormDataEntryValue | null) => {
      const text = typeof value === "string" ? value.trim() : "";
      return text.length > 0 ? Number(text) : null;
    };

    const response = await fetch("/api/security-policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...getCsrfHeader() },
      body: JSON.stringify({
        sessionTimeoutMinutes: numberOrNull(formData.get("sessionTimeoutMinutes")),
        requireTwoFactor:
          formData.get("requireTwoFactor") === "not_configured" ? null : formData.get("requireTwoFactor") === "enabled",
        apiKeyRotationDays: numberOrNull(formData.get("apiKeyRotationDays")),
        allowedDomains: blankToNull(formData.get("allowedDomains")),
        allowedIpNotes: blankToNull(formData.get("allowedIpNotes")),
      }),
    });

    const body = (await response.json()) as { error?: string; policy?: SecurityPolicyState; changes?: unknown[] };

    if (!response.ok || !body.policy) {
      setState({ type: "error", message: body.error ?? "No se pudo guardar la política de seguridad." });
      return;
    }

    setPolicy(body.policy);
    setState({ type: "success", message: body.changes?.length ? "Política actualizada y auditada." : "No se detectaron cambios." });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-3">
        {controlRows.map((control) => (
          <div key={control.key} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">{control.label}</h2>
              <StatusBadge status={control.status} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{control.summary}</p>
          </div>
        ))}
      </section>

      <form
        action={(formData) => {
          startTransition(() => {
            void onSubmit(formData);
          });
        }}
        className="space-y-5 rounded-lg border bg-card p-4"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium">Tiempo de sesión (minutos)</span>
            <Input
              name="sessionTimeoutMinutes"
              type="number"
              min={5}
              max={1440}
              defaultValue={policy.record.sessionTimeoutMinutes ?? ""}
              placeholder="Sin configurar"
              disabled={!canManage || isPending}
            />
            <span className="text-xs text-muted-foreground">Déjalo vacío para marcar el control como no configurado.</span>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium">Rotación de claves API (días)</span>
            <Input
              name="apiKeyRotationDays"
              type="number"
              min={1}
              max={365}
              defaultValue={policy.record.apiKeyRotationDays ?? ""}
              placeholder="Sin configurar"
              disabled={!canManage || isPending}
            />
            <span className="text-xs text-muted-foreground">Define un valor para exigir rotación periódica.</span>
          </label>
        </div>

        <fieldset className="space-y-2" disabled={!canManage || isPending}>
          <legend className="text-sm font-medium">Doble factor obligatorio</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <input type="radio" name="requireTwoFactor" value="not_configured" defaultChecked={policy.record.requireTwoFactor === null} />
              Sin configurar
            </label>
            <label className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <input type="radio" name="requireTwoFactor" value="enabled" defaultChecked={policy.record.requireTwoFactor === true} />
              Activo
            </label>
            <label className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <input type="radio" name="requireTwoFactor" value="disabled" defaultChecked={policy.record.requireTwoFactor === false} />
              Inactivo
            </label>
          </div>
        </fieldset>

        <label className="space-y-2 block">
          <span className="text-sm font-medium">Dominios de email permitidos</span>
          <Textarea
            name="allowedDomains"
            defaultValue={policy.record.allowedDomains ?? ""}
            placeholder="example.com, customer.example"
            disabled={!canManage || isPending}
          />
          <span className="text-xs text-muted-foreground">Dominios separados por coma o salto de línea. Vacío significa sin configurar.</span>
        </label>

        <label className="space-y-2 block">
          <span className="text-sm font-medium">Notas de política IP</span>
          <Textarea
            name="allowedIpNotes"
            defaultValue={policy.record.allowedIpNotes ?? ""}
            placeholder="CIDR de VPN, IPs de oficina, notas de revisión..."
            disabled={!canManage || isPending}
          />
          <span className="text-xs text-muted-foreground">Documenta restricciones IP o déjalo vacío si aún no aplica.</span>
        </label>

        {state.type !== "idle" ? (
          <InlineAlert tone={state.type === "success" ? "success" : "danger"}>{state.message}</InlineAlert>
        ) : null}

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {canManage ? "Guardar crea una entrada de auditoría por cada campo modificado." : "Solo lectura: necesitas rol admin u owner para cambiar controles."}
          </p>
          <Button type="submit" disabled={!canManage || isPending}>
            {isPending ? "Guardando..." : "Guardar política"}
          </Button>
        </div>
      </form>

      <PageSection title="Estado actual" description="Resumen auditable de los controles aplicados al tenant.">
        <dl className="grid gap-3 md:grid-cols-2">
          {controlRows.map((control) => (
            <div key={control.key} className="rounded-lg border p-3">
              <dt className="flex items-center justify-between gap-3 text-sm font-medium">
                {control.label}
                <StatusBadge status={control.status} />
              </dt>
              <dd className="mt-1 text-sm text-muted-foreground">{control.summary}</dd>
            </div>
          ))}
        </dl>
      </PageSection>
    </div>
  );
}

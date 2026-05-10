"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const statusCopy: Record<ControlStatus, { label: string; className: string }> = {
  enabled: {
    label: "Enabled",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  disabled: {
    label: "Disabled",
    className: "border-zinc-200 bg-zinc-50 text-zinc-600",
  },
  not_configured: {
    label: "Not configured",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
};

function StatusBadge({ status }: { status: ControlStatus }) {
  const copy = statusCopy[status];

  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${copy.className}`}>{copy.label}</span>;
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
      setState({ type: "error", message: body.error ?? "Could not save the security policy." });
      return;
    }

    setPolicy(body.policy);
    setState({ type: "success", message: body.changes?.length ? "Security policy updated and audited." : "No policy changes detected." });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-3">
        {controlRows.map((control) => (
          <div key={control.key} className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-zinc-900">{control.label}</h2>
              <StatusBadge status={control.status} />
            </div>
            <p className="mt-2 text-sm text-zinc-600">{control.summary}</p>
          </div>
        ))}
      </section>

      <form
        action={(formData) => {
          startTransition(() => {
            void onSubmit(formData);
          });
        }}
        className="space-y-5 rounded-2xl border bg-white p-6 shadow-sm"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-zinc-800">Session timeout (minutes)</span>
            <Input
              name="sessionTimeoutMinutes"
              type="number"
              min={5}
              max={1440}
              defaultValue={policy.record.sessionTimeoutMinutes ?? ""}
              placeholder="Not configured"
              disabled={!canManage || isPending}
            />
            <span className="text-xs text-zinc-500">Leave blank to mark this control as not configured.</span>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-zinc-800">API key rotation (days)</span>
            <Input
              name="apiKeyRotationDays"
              type="number"
              min={1}
              max={365}
              defaultValue={policy.record.apiKeyRotationDays ?? ""}
              placeholder="Not configured"
              disabled={!canManage || isPending}
            />
            <span className="text-xs text-zinc-500">Set a value to require periodic API key rotation.</span>
          </label>
        </div>

        <fieldset className="space-y-2" disabled={!canManage || isPending}>
          <legend className="text-sm font-medium text-zinc-800">Require two-factor authentication</legend>
          <div className="flex flex-wrap gap-3 text-sm text-zinc-700">
            <label className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <input type="radio" name="requireTwoFactor" value="not_configured" defaultChecked={policy.record.requireTwoFactor === null} />
              Not configured
            </label>
            <label className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <input type="radio" name="requireTwoFactor" value="enabled" defaultChecked={policy.record.requireTwoFactor === true} />
              Enabled
            </label>
            <label className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <input type="radio" name="requireTwoFactor" value="disabled" defaultChecked={policy.record.requireTwoFactor === false} />
              Disabled
            </label>
          </div>
        </fieldset>

        <label className="space-y-2 block">
          <span className="text-sm font-medium text-zinc-800">Allowed email domains</span>
          <Textarea
            name="allowedDomains"
            defaultValue={policy.record.allowedDomains ?? ""}
            placeholder="example.com, customer.example"
            disabled={!canManage || isPending}
          />
          <span className="text-xs text-zinc-500">Comma or newline separated domains. Blank means not configured.</span>
        </label>

        <label className="space-y-2 block">
          <span className="text-sm font-medium text-zinc-800">Allowed IP policy notes</span>
          <Textarea
            name="allowedIpNotes"
            defaultValue={policy.record.allowedIpNotes ?? ""}
            placeholder="VPN CIDRs, office IPs, review notes…"
            disabled={!canManage || isPending}
          />
          <span className="text-xs text-zinc-500">Document IP restrictions or leave blank when not configured.</span>
        </label>

        {state.type !== "idle" ? (
          <p className={state.type === "success" ? "text-sm text-emerald-700" : "text-sm text-red-700"}>{state.message}</p>
        ) : null}

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-zinc-500">
            {canManage ? "Saving creates an audit log entry for every changed field." : "Read-only: admin or owner access is required to change controls."}
          </p>
          <Button type="submit" disabled={!canManage || isPending}>
            {isPending ? "Saving…" : "Save security policy"}
          </Button>
        </div>
      </form>

      <section className="rounded-2xl border bg-white p-6 shadow-sm" aria-label="Current security policy state">
        <h2 className="text-lg font-semibold text-zinc-900">Current policy state</h2>
        <dl className="mt-4 grid gap-3 md:grid-cols-2">
          {controlRows.map((control) => (
            <div key={control.key} className="rounded-lg border p-3">
              <dt className="flex items-center justify-between gap-3 text-sm font-medium text-zinc-800">
                {control.label}
                <StatusBadge status={control.status} />
              </dt>
              <dd className="mt-1 text-sm text-zinc-600">{control.summary}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

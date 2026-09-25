"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import type { AccountOption } from "@/components/treasury/split-allocation-dialog";
import { AccountPicker } from "@/components/ui/account-picker";
import { Button } from "@/components/ui/button";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { EmptyState, InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate, formatMoney, parseDecimalInput } from "@/lib/format";

export type RuleRow = {
  id: string;
  name: string;
  conceptContains: string;
  direction: string;
  minAmount: string | null;
  maxAmount: string | null;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  partnerId: string | null;
  partnerName: string | null;
  autoApply: boolean;
  isActive: boolean;
  timesApplied: number;
  lastAppliedAt: Date | string | null;
};

type Partner = { id: string; name: string };

const directionLabels: Record<string, string> = { ANY: "Ingresos y cargos", IN: "Solo ingresos", OUT: "Solo cargos" };

type Draft = {
  id: string | null;
  name: string;
  conceptContains: string;
  direction: "ANY" | "IN" | "OUT";
  minAmount: string;
  maxAmount: string;
  target: "account" | "partner";
  accountId: string;
  partnerId: string;
  autoApply: boolean;
  isActive: boolean;
};

const emptyDraft: Draft = { id: null, name: "", conceptContains: "", direction: "OUT", minAmount: "", maxAmount: "", target: "account", accountId: "", partnerId: "", autoApply: false, isActive: true };

function draftFrom(rule: RuleRow): Draft {
  return {
    id: rule.id,
    name: rule.name,
    conceptContains: rule.conceptContains,
    direction: (rule.direction as Draft["direction"]) ?? "ANY",
    minAmount: rule.minAmount ? rule.minAmount.replace(".", ",") : "",
    maxAmount: rule.maxAmount ? rule.maxAmount.replace(".", ",") : "",
    target: rule.accountId ? "account" : "partner",
    accountId: rule.accountId ?? "",
    partnerId: rule.partnerId ?? "",
    autoApply: rule.autoApply,
    isActive: rule.isActive,
  };
}

async function saveRule(draft: Draft) {
  const body = {
    name: draft.name.trim() || null,
    conceptContains: draft.conceptContains,
    direction: draft.direction,
    minAmount: parseDecimalInput(draft.minAmount),
    maxAmount: parseDecimalInput(draft.maxAmount),
    accountId: draft.target === "account" ? draft.accountId || null : null,
    partnerId: draft.target === "partner" ? draft.partnerId || null : null,
    autoApply: draft.target === "account" && draft.autoApply,
    isActive: draft.isActive,
  };
  const response = await fetch(draft.id ? `/api/treasury/rules/${draft.id}` : "/api/treasury/rules", {
    method: draft.id ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json", ...getCsrfHeader() },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la regla."));
}

/** Reglas "el concepto contiene X → cuenta o cliente/proveedor", con alta, edición y borrado. */
export function ReconciliationRulesManager({ accounts, canWrite, currencyCode, partners, rules }: { accounts: AccountOption[]; canWrite: boolean; currencyCode: string; partners: Partner[]; rules: RuleRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RuleRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function submit() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await saveRule(draft);
      toast.success(draft.id ? "Regla actualizada." : "Regla creada.", { description: "Se tendrá en cuenta en las próximas propuestas de conciliación." });
      setDraft(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar la regla.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(rule: RuleRow) {
    setDeleteBusy(true);
    setDeleteError(null);
    const response = await fetch(`/api/treasury/rules/${rule.id}`, { method: "DELETE", headers: getCsrfHeader() });
    setDeleteBusy(false);
    if (!response.ok) {
      setDeleteError(await readApiError(response, "No se pudo borrar la regla."));
      return;
    }
    toast.success("Regla borrada.");
    setDeleting(null);
    router.refresh();
  }

  async function toggle(rule: RuleRow, patch: Partial<Draft>) {
    try {
      await saveRule({ ...draftFrom(rule), ...patch });
      router.refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "No se pudo guardar la regla.");
    }
  }

  const range = (rule: RuleRow) => {
    if (!rule.minAmount && !rule.maxAmount) return "Cualquier importe";
    if (rule.minAmount && rule.maxAmount) return `Entre ${formatMoney(rule.minAmount, currencyCode)} y ${formatMoney(rule.maxAmount, currencyCode)}`;
    return rule.minAmount ? `Desde ${formatMoney(rule.minAmount, currencyCode)}` : `Hasta ${formatMoney(rule.maxAmount ?? 0, currencyCode)}`;
  };

  return (
    <div className="space-y-3">
      {canWrite ? <Button data-testid="new-reconciliation-rule" onClick={() => { setError(null); setDraft({ ...emptyDraft }); }} type="button">Nueva regla</Button> : null}
      {rules.length === 0 ? (
        <EmptyState title="Todavía no hay reglas" description="Crea una aquí o marca «Recordar para la próxima vez» al asignar un movimiento a una cuenta en la conciliación." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Si el concepto contiene</TableHead>
                <TableHead>Condiciones</TableHead>
                <TableHead>Entonces</TableHead>
                <TableHead>Uso</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow data-testid="reconciliation-rule-row" key={rule.id}>
                  <TableCell>
                    <p className="font-mono font-bold">«{rule.conceptContains}»</p>
                    {rule.name !== rule.conceptContains ? <p className="text-xs text-muted-foreground">{rule.name}</p> : null}
                  </TableCell>
                  <TableCell className="text-sm">{directionLabels[rule.direction] ?? rule.direction}<br /><span className="text-xs text-muted-foreground">{range(rule)}</span></TableCell>
                  <TableCell className="text-sm">
                    {rule.accountId ? `Asignar a ${rule.accountCode} · ${rule.accountName}` : `Buscar facturas de ${rule.partnerName ?? "—"}`}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {!rule.isActive ? <StatusBadge>Desactivada</StatusBadge> : null}
                      {rule.autoApply ? <StatusBadge tone="info">Se aplica sola al importar</StatusBadge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{rule.timesApplied} {rule.timesApplied === 1 ? "vez" : "veces"}{rule.lastAppliedAt ? ` · última ${formatDate(rule.lastAppliedAt)}` : ""}</TableCell>
                  <TableCell className="text-right">
                    {canWrite ? (
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button onClick={() => { setError(null); setDraft(draftFrom(rule)); }} size="sm" type="button" variant="outline">Editar</Button>
                        <Button onClick={() => void toggle(rule, { isActive: !rule.isActive })} size="sm" type="button" variant="ghost">{rule.isActive ? "Desactivar" : "Activar"}</Button>
                        <Button onClick={() => { setDeleteError(null); setDeleting(rule); }} size="sm" type="button" variant="ghost">Borrar</Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <DestructiveActionDialog
        confirmLabel="Borrar regla"
        description={deleting ? `Se borrará la regla «${deleting.name}». Los movimientos ya conciliados con ella no cambian.` : ""}
        errorMessage={deleteError}
        isSubmitting={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
        open={deleting !== null}
        title="Borrar regla"
      />
      {draft ? (
        <Dialog description="Cuando un movimiento del banco cumpla la condición, la conciliación te lo propondrá." onClose={() => { if (!saving) setDraft(null); }} open size="lg" title={draft.id ? "Editar regla" : "Nueva regla de conciliación"}>
          <div className="grid gap-3 sm:grid-cols-2">
            <AccessibleField className="sm:col-span-2" helperText="Sin distinguir mayúsculas ni tildes. P. ej. «COMISION», «TGSS», «AEAT»." id="rule-concept" label="El concepto contiene" required>
              <Input onChange={(event) => setDraft({ ...draft, conceptContains: event.target.value })} value={draft.conceptContains} />
            </AccessibleField>
            <AccessibleField id="rule-direction" label="Tipo de movimiento">
              <Select onChange={(event) => setDraft({ ...draft, direction: event.target.value as Draft["direction"] })} value={draft.direction}>
                <option value="OUT">Solo cargos (sale dinero)</option>
                <option value="IN">Solo ingresos (entra dinero)</option>
                <option value="ANY">Ingresos y cargos</option>
              </Select>
            </AccessibleField>
            <AccessibleField id="rule-name" label="Nombre (opcional)">
              <Input onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Comisiones del banco" value={draft.name} />
            </AccessibleField>
            <AccessibleField helperText="Sin signo." id="rule-min" label="Importe desde (opcional)">
              <MoneyInput onChange={(event) => setDraft({ ...draft, minAmount: event.target.value })} value={draft.minAmount} />
            </AccessibleField>
            <AccessibleField id="rule-max" label="Importe hasta (opcional)">
              <MoneyInput onChange={(event) => setDraft({ ...draft, maxAmount: event.target.value })} value={draft.maxAmount} />
            </AccessibleField>
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-bold">Entonces</legend>
              <div className="mt-1 flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-1"><input checked={draft.target === "account"} name="rule-target" onChange={() => setDraft({ ...draft, target: "account" })} type="radio" /> Asignar a una cuenta</label>
                <label className="flex items-center gap-1"><input checked={draft.target === "partner"} name="rule-target" onChange={() => setDraft({ ...draft, target: "partner", autoApply: false })} type="radio" /> Buscar facturas de un cliente/proveedor</label>
              </div>
            </fieldset>
            {draft.target === "account" ? (
              <>
                <AccessibleField className="sm:col-span-2" id="rule-account" label="Cuenta" required>
                  <AccountPicker accounts={accounts} id="rule-account" onChange={(accountId) => setDraft({ ...draft, accountId })} recentKey="bank-assign" value={draft.accountId} />
                </AccessibleField>
                <label className="flex items-start gap-2 text-sm sm:col-span-2">
                  <input checked={draft.autoApply} className="mt-1" onChange={(event) => setDraft({ ...draft, autoApply: event.target.checked })} type="checkbox" />
                  <span>Aplicarla sola al importar extractos <span className="block text-xs text-muted-foreground">Solo si ninguna otra regla coincide. Podrás deshacerlo desde la ficha del movimiento.</span></span>
                </label>
              </>
            ) : (
              <AccessibleField className="sm:col-span-2" id="rule-partner" label="Cliente o proveedor" required>
                <Select onChange={(event) => setDraft({ ...draft, partnerId: event.target.value })} value={draft.partnerId}>
                  <option value="">Elige…</option>
                  {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
                </Select>
              </AccessibleField>
            )}
          </div>
          {error ? <InlineAlert className="mt-2" tone="danger">{error}</InlineAlert> : null}
          <DialogFooter>
            <Button disabled={saving} onClick={() => setDraft(null)} type="button" variant="outline">Cancelar</Button>
            <Button disabled={saving} onClick={() => void submit()} type="button">{saving ? "Guardando…" : "Guardar regla"}</Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </div>
  );
}

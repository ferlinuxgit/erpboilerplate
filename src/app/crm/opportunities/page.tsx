import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader, PageShell } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { formatDate, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { CRM_STAGE_KINDS, crmStatusLabels, type CrmStageKind } from "@/modules/crm/model";
import { ensureStages, listOpportunities } from "@/server/crm/service";

export const metadata: Metadata = { title: "Oportunidades" };

const statusTone = { OPEN: "info", WON: "success", LOST: "neutral" } as const;

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; mine?: string }> }) {
  const ctx = await requireContext("crm.read");
  const params = await searchParams;
  const status = CRM_STAGE_KINDS.includes(params.status as CrmStageKind) ? (params.status as CrmStageKind) : "ALL";
  const [rows, stages] = await Promise.all([
    listOpportunities(ctx.company.id, { status, q: params.q, ownerUserId: params.mine === "1" ? ctx.user.id : undefined }),
    ensureStages(ctx.company.id),
  ]);
  const stageName = new Map(stages.map((stage) => [stage.id, stage.name]));
  const currency = ctx.company.baseCurrencyCode;
  const total = rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100;

  return (
    <PageShell>
      <PageHeader
        title="Oportunidades"
        description="Todas las oportunidades, abiertas y cerradas, con filtros."
        actions={can(ctx.membership.role, "crm.write") ? <Link className={buttonVariants()} href="/crm/opportunities/new">Nueva oportunidad</Link> : null}
      />
      <form className="flex flex-wrap items-end gap-2" method="get">
        <label className="grid gap-1 text-xs font-medium">Buscar<Input defaultValue={params.q ?? ""} name="q" placeholder="Título, cliente o contacto" /></label>
        <label className="grid gap-1 text-xs font-medium">Estado
          <Select defaultValue={status} name="status">
            <option value="ALL">Todas</option>
            {CRM_STAGE_KINDS.map((kind) => <option key={kind} value={kind}>{crmStatusLabels[kind]}</option>)}
          </Select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs font-medium"><input defaultChecked={params.mine === "1"} name="mine" type="checkbox" value="1" /> Solo las mías</label>
        <button className={buttonVariants({ variant: "outline" })} type="submit">Filtrar</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState description="Crea la primera o cambia los filtros." title="Sin oportunidades" />
      ) : (
        <div className="overflow-x-auto border border-window-shadow">
          <table className="w-full text-sm" data-testid="crm-opportunities-table">
            <thead className="bg-window-panel text-left font-mono text-xs uppercase">
              <tr><th className="p-2">Oportunidad</th><th className="p-2">Cliente / contacto</th><th className="p-2">Etapa</th><th className="p-2">Responsable</th><th className="p-2">Cierre</th><th className="p-2 text-right">Importe</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-t border-window-shadow" key={row.id}>
                  <td className="p-2"><Link className="font-semibold text-link hover:underline" href={`/crm/opportunities/${row.id}`}>{row.title}</Link></td>
                  <td className="p-2">{row.customerName ?? row.contactName ?? "—"}</td>
                  <td className="p-2"><StatusBadge tone={statusTone[row.status]}>{stageName.get(row.stageId) ?? crmStatusLabels[row.status]}</StatusBadge></td>
                  <td className="p-2 text-muted-foreground">{row.ownerName ?? "—"}</td>
                  <td className="p-2 font-mono text-xs">{row.closedAt ? formatDate(row.closedAt) : row.expectedCloseDate ? formatDate(row.expectedCloseDate) : "—"}</td>
                  <td className="p-2 text-right font-mono tabular-nums">{formatMoney(row.amount, currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-window-shadow bg-window-panel font-mono text-xs"><td className="p-2" colSpan={5}>{rows.length} oportunidades</td><td className="p-2 text-right font-bold">{formatMoney(total, currency)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </PageShell>
  );
}

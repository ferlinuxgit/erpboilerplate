import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/rbac";
import { listRegisters } from "@/server/pos/service";

export const metadata: Metadata = { title: "TPV" };

/** Elegir caja (si solo hay una activa, se entra directamente). */
export default async function PosHomePage({ searchParams }: { searchParams: Promise<{ choose?: string }> }) {
  const ctx = await requireContext("pos.read");
  const registers = (await listRegisters(ctx.company.id)).filter((register) => register.isActive);
  const canManage = can(ctx.membership.role, "pos.manage");
  if (registers.length === 1 && (await searchParams).choose !== "1" && can(ctx.membership.role, "pos.sell")) redirect(`/pos/${registers[0].id}`);

  return (
    <PageShell>
      <PageHeader
        title="TPV"
        description="Venta en mostrador con tickets (factura simplificada), cobro en efectivo o tarjeta y cierre de caja."
        actions={canManage ? <Link className={buttonVariants({ variant: "outline" })} href="/pos/settings">Configurar cajas</Link> : null}
      />
      {registers.length === 0 ? (
        <EmptyState
          action={canManage ? <Link className={buttonVariants()} data-testid="pos-setup-link" href="/pos/settings">Crear la primera caja</Link> : undefined}
          description={canManage ? "Crea una caja: su serie de tickets, el almacén y el banco de la tarjeta." : "Pide a un administrador que cree una caja en Configuración → TPV."}
          title="Aún no hay cajas"
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {registers.map((register) => (
            <li className="flex flex-col gap-2 border border-window-shadow bg-card p-3" key={register.id}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-mono text-base font-bold">{register.name}</h2>
                <StatusBadge tone={register.openSession ? "success" : "neutral"}>{register.openSession ? "Abierta" : "Cerrada"}</StatusBadge>
              </div>
              {register.openSession ? <p className="text-xs text-muted-foreground">Abierta por {register.openSession.openedByName ?? "—"} · {formatDateTime(register.openSession.openedAt)}</p> : null}
              <Link className={buttonVariants({ className: "mt-auto" })} href={`/pos/${register.id}`}>{register.openSession ? "Vender" : "Abrir caja"}</Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

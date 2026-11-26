"use client";

import { Check, CreditCard, Lightning, Sparkle } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { InlineAlert, PageSection } from "@/components/ui/page";
import { formatEuros } from "@/lib/billing/catalog";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ModuleId } from "@/modules/registry";
import type { BillingOverview } from "@/server/billing/overview";

async function postForUrl(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => ({}))) as { url?: string; message?: string };
  if (!response.ok) throw new Error(payload.message ?? "No se pudo completar la operación.");
  return payload;
}

const STATE_LABEL: Record<string, { title: string; tone: "info" | "success" | "warning" | "danger" | "neutral" }> = {
  disabled: { title: "Cobro no activado en este servidor", tone: "neutral" },
  exempt: { title: "Cuenta de cortesía: todo incluido", tone: "success" },
  trial: { title: "Prueba gratuita: todo incluido", tone: "info" },
  active: { title: "Suscripción activa", tone: "success" },
  grace: { title: "Pago pendiente", tone: "warning" },
  past_due: { title: "Suscripción impagada: solo lectura", tone: "danger" },
  trial_expired: { title: "Prueba terminada: solo lectura", tone: "danger" },
  canceled: { title: "Suscripción terminada: solo lectura", tone: "danger" },
  suspended: { title: "Cuenta suspendida", tone: "danger" },
};

const KIND_LABEL: Record<string, string> = { TRIAL: "Bienvenida", PURCHASE: "Compra", USAGE: "Lectura", ADJUSTMENT: "Ajuste", REFUND: "Devolución" };

/** Plan, módulos con precio, créditos de IA y pago. Solo el propietario puede contratar y pagar. */
export function BillingDashboard({ canManage, overview }: { canManage: boolean; overview: BillingOverview }) {
  const live = Boolean(overview.subscription?.live);
  const [selected, setSelected] = useState<Set<ModuleId>>(() => new Set(overview.modules.filter((entry) => (live ? entry.contracted : entry.selected)).map((entry) => entry.id)));
  const [busy, setBusy] = useState<string | null>(null);
  const status = STATE_LABEL[overview.access.state] ?? STATE_LABEL.disabled;
  // El plan se paga por años; los módulos, cada mes en su propia suscripción.
  const modulesTotal = overview.modules.filter((entry) => selected.has(entry.id)).reduce((sum, entry) => sum + entry.priceCents, 0);
  const contracted = new Set(overview.modules.filter((entry) => entry.contracted).map((entry) => entry.id));
  const changed = live && (selected.size !== contracted.size || [...selected].some((id) => !contracted.has(id)));
  const canPay = canManage && overview.stripeConfigured;

  const toggle = (id: ModuleId, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
        // Sus dependencias (Hostelería necesita TPV) se marcan con él.
        for (const dependency of overview.modules.find((entry) => entry.id === id)?.dependsOn ?? []) next.add(dependency);
      } else {
        next.delete(id);
        for (const entry of overview.modules) if (entry.dependsOn.includes(id)) next.delete(entry.id);
      }
      return next;
    });

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo completar la operación.");
    } finally {
      setBusy(null);
    }
  };

  const subscribe = () => run("checkout", async () => {
    const { url } = await postForUrl("/api/billing/checkout", { modules: [...selected] });
    if (url) window.location.href = url;
  });
  const saveModules = () => run("modules", async () => {
    const { url } = await postForUrl("/api/billing/modules", { modules: [...selected] });
    // El banco pide confirmar el pago de los módulos: se abre la factura de Stripe para pagarla.
    if (url) {
      window.location.href = url;
      return;
    }
    toast.success(contracted.size === 0 ? "Módulos contratados: se cobran cada mes con la tarjeta del plan." : "Módulos actualizados: el cambio se prorratea en tu próxima factura mensual.");
    window.location.reload();
  });
  const buyCredits = (packCode: string) => run(packCode, async () => {
    const { url } = await postForUrl("/api/billing/credits", { packCode });
    if (url) window.location.href = url;
  });
  const openPortal = () => run("portal", async () => {
    const { url } = await postForUrl("/api/billing/portal", {});
    if (url) window.location.href = url;
  });

  return (
    <div className="space-y-4">
      <InlineAlert data-testid="billing-state" title={status.title} tone={status.tone}>
        {overview.access.message ?? (
          overview.access.state === "trial" && overview.access.trialEndsAt
            ? `Puedes usar todos los módulos hasta el ${formatDate(overview.access.trialEndsAt)}. Elige abajo tu plan para seguir después sin interrupciones.`
            : overview.access.state === "active" && overview.subscription?.currentPeriodEndsAt
              ? `${overview.subscription.cancelAtPeriodEnd ? "Se cancela" : "Se renueva"} el ${formatDate(overview.subscription.currentPeriodEndsAt)}.`
              : overview.access.state === "disabled"
                ? "Este servidor no tiene el cobro configurado: todo está disponible sin suscripción."
                : null
        )}
      </InlineAlert>

      {overview.subscription?.modulesPaymentPending ? (
        <InlineAlert data-testid="billing-modules-pending" title="Pago de módulos pendiente" tone="warning">
          Los módulos se activarán cuando se pague su primera cuota. Revísalo en «Gestionar pago y facturas».
        </InlineAlert>
      ) : null}

      <PageSection title="Tu plan" description="IVA no incluido. El plan base se paga por años; los módulos, mes a mes y sin permanencia.">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.45fr)]">
          <div className="space-y-3">
            <div className="rounded-surface border-2 border-primary bg-card p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-mono text-sm font-bold">{overview.base.name}</h3>
                <p className="text-right font-mono text-lg font-bold">
                  {formatEuros(overview.base.yearlyCents)}<span className="text-xs font-normal text-muted-foreground"> /año</span>
                  <span className="block text-xs font-normal text-muted-foreground">equivale a {formatEuros(overview.base.monthlyEquivalentCents)}/mes · pago anual</span>
                </p>
              </div>
              <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                {overview.base.features.map((feature) => (
                  <li className="flex items-start gap-1.5" key={feature}><Check aria-hidden="true" className="mt-0.5 shrink-0 text-success-text" />{feature}</li>
                ))}
              </ul>
            </div>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 font-mono text-xs font-bold uppercase tracking-[0.04em]">Módulos opcionales · al mes</legend>
              <ul className="divide-y divide-window-shadow rounded-surface border border-window-dark-shadow" data-testid="billing-modules">
                {overview.modules.map((entry) => (
                  <li className={cn("p-2.5", selected.has(entry.id) && "bg-window-panel")} key={entry.id}>
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        checked={selected.has(entry.id)}
                        className="mt-0.5 size-4 shrink-0 accent-primary"
                        disabled={!canManage || busy !== null}
                        onChange={(event) => toggle(entry.id, event.target.checked)}
                        type="checkbox"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-mono text-sm font-bold">{entry.name}{entry.contracted ? <span className="ml-1.5 font-normal text-success-text">· contratado</span> : null}</span>
                          <span className="font-mono text-sm">+{formatEuros(entry.priceCents)}<span className="text-xs text-muted-foreground"> /mes</span></span>
                        </span>
                        <span className="block text-xs text-muted-foreground">{entry.description}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          </div>
          <aside aria-label="Resumen del plan" className="h-fit space-y-2 border-l-4 border-l-primary bg-window-panel p-3 lg:sticky lg:top-4">
            <p className="font-mono text-xs font-bold uppercase">Plan base</p>
            <p className="font-mono text-2xl font-bold" data-testid="billing-plan-total">{formatEuros(overview.base.yearlyCents)}<span className="text-sm font-normal text-muted-foreground"> /año</span></p>
            <p className="font-mono text-xs font-bold uppercase">Módulos</p>
            <p className="font-mono text-2xl font-bold" data-testid="billing-total">{formatEuros(modulesTotal)}<span className="text-sm font-normal text-muted-foreground"> /mes</span></p>
            <p className="text-xs text-muted-foreground">
              + IVA. {selected.size === 0 ? "Sin módulos." : `${selected.size} módulo${selected.size === 1 ? "" : "s"}, cobrado${selected.size === 1 ? "" : "s"} cada mes aparte con la misma tarjeta.`}
            </p>
            {live ? (
              <Button className="w-full" disabled={!canPay || !changed || busy !== null} onClick={() => void saveModules()} type="button">
                {busy === "modules" ? "Guardando…" : "Guardar cambios de módulos"}
              </Button>
            ) : (
              <Button className="w-full" data-testid="billing-subscribe" disabled={!canPay || busy !== null} onClick={() => void subscribe()} type="button">
                <Lightning aria-hidden="true" />
                {busy === "checkout" ? "Abriendo el pago…" : `Contratar el plan por ${formatEuros(overview.base.yearlyCents)}/año`}
              </Button>
            )}
            {!live && selected.size > 0 ? <p className="text-xs text-muted-foreground">Primero pagas el año del plan; al confirmarse, los módulos elegidos empiezan a cobrarse al mes con la misma tarjeta.</p> : null}
            {!overview.stripeConfigured ? <p className="text-xs text-muted-foreground">El pago se activará cuando el servidor tenga Stripe configurado.</p> : null}
            {!canManage ? <p className="text-xs text-muted-foreground">Solo el propietario del espacio puede contratar.</p> : null}
          </aside>
        </div>
      </PageSection>

      <PageSection title="Lectura de facturas con IA" description="Cada lectura gasta créditos según su tamaño: una factura normal (1-3 páginas) gasta 1 crédito; un PDF largo, algo más.">
        <div className="grid gap-3 md:grid-cols-[minmax(12rem,0.4fr)_minmax(0,1fr)]">
          <div className="rounded-surface border border-window-dark-shadow bg-card p-3">
            <p className="font-mono text-xs font-bold uppercase">Saldo</p>
            <p className="font-mono text-3xl font-bold" data-testid="billing-credits">{overview.credits.balance}</p>
            <p className="text-xs text-muted-foreground">créditos disponibles</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {overview.credits.packs.map((pack) => (
              <div className="flex flex-col justify-between gap-2 rounded-surface border border-window-dark-shadow bg-card p-3" key={pack.code}>
                <div>
                  <p className="flex items-center gap-1.5 font-mono text-sm font-bold"><Sparkle aria-hidden="true" />{pack.credits.toLocaleString("es-ES")} créditos</p>
                  <p className="font-mono text-lg font-bold">{formatEuros(pack.cents)}</p>
                  <p className="text-xs text-muted-foreground">{formatEuros(Math.round(pack.cents / pack.credits * 100) / 100)} por factura · + IVA</p>
                </div>
                <Button disabled={!canPay || busy !== null} onClick={() => void buyCredits(pack.code)} size="sm" type="button" variant="outline">
                  {busy === pack.code ? "Abriendo…" : "Comprar"}
                </Button>
              </div>
            ))}
          </div>
        </div>
        {overview.credits.movements.length > 0 ? (
          <ul className="mt-3 divide-y divide-window-shadow rounded-surface border border-window-shadow text-xs">
            {overview.credits.movements.map((movement) => (
              <li className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5" key={movement.id}>
                <span className="min-w-0"><span className="font-bold">{KIND_LABEL[movement.kind] ?? movement.kind}</span> · {movement.description} · {formatDate(movement.createdAt)}</span>
                <span className={cn("font-mono font-bold", movement.delta < 0 ? "text-danger-text" : "text-success-text")}>{movement.delta > 0 ? "+" : ""}{movement.delta}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </PageSection>

      <PageSection title="Pago y facturas" description="Cambia la tarjeta, descarga tus facturas o cancela la suscripción en el portal seguro de Stripe.">
        <Button disabled={!canPay || !overview.subscription?.hasCustomer || busy !== null} onClick={() => void openPortal()} type="button" variant="outline">
          <CreditCard aria-hidden="true" />
          {busy === "portal" ? "Abriendo…" : "Gestionar pago y facturas"}
        </Button>
      </PageSection>
    </div>
  );
}

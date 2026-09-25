import type { Metadata } from "next";
import Link from "next/link";

import { CollectionsList } from "@/components/dunning/collections-list";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { listCollections } from "@/server/dunning/service";
import { AGING_BUCKETS, agingBucketLabels, type AgingBucket } from "@/server/dunning/schedule";
import { getInvoiceEmailSettings } from "@/server/invoice-email/service";
import { isEmailDeliveryConfigured } from "@/server/email/send";

export const metadata: Metadata = { title: "Cobros pendientes" };

const bucketTone: Record<AgingBucket, "neutral" | "info" | "warning" | "danger"> = {
  CURRENT: "neutral",
  D0_30: "info",
  D31_60: "warning",
  D61_90: "danger",
  D90_PLUS: "danger",
};

export default async function CollectionsPage() {
  await requireUserSession();
  const ctx = await requireContext("invoice.read");
  const timeZone = ctx.company.timezone || undefined;
  const currencyCode = ctx.company.baseCurrencyCode;
  const [rows, settings] = await Promise.all([listCollections(ctx.company.id, { timeZone }), getInvoiceEmailSettings(ctx.company.id)]);
  const canRemind = can(ctx.membership.role, "invoice.write");
  const smtpConfigured = isEmailDeliveryConfigured();

  const totals: Record<AgingBucket, { cents: number; count: number }> = {
    CURRENT: { cents: 0, count: 0 },
    D0_30: { cents: 0, count: 0 },
    D31_60: { cents: 0, count: 0 },
    D61_90: { cents: 0, count: 0 },
    D90_PLUS: { cents: 0, count: 0 },
  };
  for (const row of rows) {
    totals[row.bucket].cents += Math.round(row.outstandingAmount * 100);
    totals[row.bucket].count += 1;
  }
  const overdueCents = AGING_BUCKETS.filter((bucket) => bucket !== "CURRENT").reduce((sum, bucket) => sum + totals[bucket].cents, 0);

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Comercial" }, { label: "Facturas", href: "/invoices" }, { label: "Cobros pendientes" }]}
        title="Cobros pendientes"
        description="Lo que te deben tus clientes, ordenado por antigüedad. Selecciona facturas vencidas para enviar recordatorios en bloque."
        actions={
          <Link className={buttonVariants({ variant: "outline" })} href="/invoices/collections/settings">
            Plantillas y recordatorios automáticos
          </Link>
        }
      />

      {!smtpConfigured ? (
        <InlineAlert title="El correo no está configurado" tone="warning">
          Para enviar recordatorios hay que configurar el servidor de correo (SMTP) en Configuración. Mientras tanto puedes consultar la antigüedad de la deuda.
        </InlineAlert>
      ) : null}
      <p className="text-xs text-muted-foreground" data-testid="dunning-schedule-status">
        Recordatorios automáticos: {settings.dunning.enabled
          ? `activados (el primero ${settings.dunning.firstDelayDays} días tras el vencimiento, luego cada ${settings.dunning.intervalDays} días, máximo ${settings.dunning.maxReminders}).`
          : "desactivados."}{" "}
        <Link className="underline" href="/invoices/collections/settings">Cambiar</Link>
      </p>

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="aging-summary">
        <MetricCard helper={`${rows.length - totals.CURRENT.count} facturas vencidas`} label="Total vencido" tone={overdueCents > 0 ? "danger" : "success"} value={formatMoney(overdueCents / 100, currencyCode)} />
        {AGING_BUCKETS.map((bucket) => (
          <MetricCard
            helper={`${totals[bucket].count} ${totals[bucket].count === 1 ? "factura" : "facturas"}`}
            key={bucket}
            label={agingBucketLabels[bucket]}
            tone={totals[bucket].cents > 0 ? bucketTone[bucket] : "neutral"}
            value={formatMoney(totals[bucket].cents / 100, currencyCode)}
          />
        ))}
      </div>

      <PageSection title="Facturas pendientes de cobro" description="Importe pendiente neto de cobros parciales y rectificativas. No incluye borradores.">
        <CollectionsList
          canRemind={canRemind}
          currencyCode={currencyCode}
          rows={rows.map((row) => ({
            invoiceId: row.invoiceId,
            number: row.number,
            customerId: row.customerId,
            customerName: row.customerName,
            customerEmail: row.customerEmail,
            optedOut: row.optedOut,
            dueDate: row.dueDate,
            outstandingAmount: row.outstandingAmount,
            daysOverdue: row.daysOverdue,
            bucket: row.bucket,
            remindersSent: row.remindersSent,
            lastReminderLabel: row.lastReminderLabel,
            nextLevel: row.nextLevel,
          }))}
        />
      </PageSection>
    </PageShell>
  );
}

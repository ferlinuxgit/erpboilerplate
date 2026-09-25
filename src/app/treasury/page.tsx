import { and, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";

import { FiscalYearLifecyclePanel } from "@/components/accounting/fiscal-year-lifecycle-panel";
import { CustomerCashActions } from "@/components/treasury/customer-cash-actions";
import { buttonVariants } from "@/components/ui/button";
import {
  EmptyState,
  MetricCard,
  PageHeader,
  PageSection,
  PageShell,
} from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { customer, invoice, paymentMethod } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { getFiscalYearLifecycle } from "@/server/accounting/fiscal-years";
import {
  creditedByInvoiceSubquery,
  invoiceIsIssuedSql,
  netOutstandingSql,
  paidByInvoiceSubquery,
} from "@/server/invoices/sql";
import { bankTransactionStats } from "@/server/treasury/bank-transaction-list";
import { getCurrentBankBalances } from "@/server/treasury/forecast";
import { listBankAccounts } from "@/server/treasury/service";

const areas = [
  {
    href: "/treasury/import",
    title: "Importar extracto",
    description: "CSV, Excel o Norma 43 de tu banco.",
  },
  {
    href: "/treasury/reconciliation",
    title: "Conciliación",
    description: "Di a qué corresponde cada movimiento.",
  },
  {
    href: "/treasury/forecast",
    title: "Previsión",
    description: "¿Cuánto dinero tendré en 30, 60 o 90 días?",
  },
  {
    href: "/treasury/remittances",
    title: "Remesas SEPA",
    description: "Paga varias facturas de proveedor a la vez.",
  },
  {
    href: "/treasury/bank-accounts",
    title: "Cuentas bancarias",
    description: "Bancos, IBAN y saldos.",
  },
  {
    href: "/treasury/bank-transactions",
    title: "Movimientos",
    description: "Histórico del banco con su estado.",
  },
  {
    href: "/treasury/rules",
    title: "Reglas de conciliación",
    description: "«Si el concepto dice COMISION → 626».",
  },
];

export default async function TreasuryPage() {
  const ctx = await requireContext("treasury.read");
  const companyId = ctx.company.id;
  // Issued ordinary invoices only (no drafts, voided invoices or credit notes), with the
  // net outstanding (total + credit notes − payments), aggregated in SQL.
  const paidByInvoice = paidByInvoiceSubquery(companyId);
  const creditedByInvoice = creditedByInvoiceSubquery(companyId);
  const outstanding = netOutstandingSql(paidByInvoice, creditedByInvoice);
  const trackedInvoice = and(eq(invoice.companyId, companyId), invoiceIsIssuedSql, eq(invoice.invoiceType, "INVOICE"));
  const [accounts, stats, [invoiceCounts], [selected], methods, lifecycle, balances] = await Promise.all([
    listBankAccounts(companyId),
    bankTransactionStats(companyId),
    db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        paid: sql<number>`count(*) filter (where ${invoice.paymentStatus} = 'PAID')`.mapWith(Number),
        open: sql<number>`count(*) filter (where ${outstanding} > 0)`.mapWith(Number),
      })
      .from(invoice)
      .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, invoice.id))
      .leftJoin(creditedByInvoice, eq(creditedByInvoice.invoiceId, invoice.id))
      .where(trackedInvoice),
    // Next invoice to collect: the most recent issued invoice with something left to pay.
    db
      .select({
        id: invoice.id,
        number: invoice.number,
        totalAmount: invoice.totalAmount,
        paymentStatus: invoice.paymentStatus,
        outstandingAmount: outstanding.mapWith(Number),
        customerName: customer.name,
      })
      .from(invoice)
      .innerJoin(customer, eq(invoice.customerId, customer.id))
      .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, invoice.id))
      .leftJoin(creditedByInvoice, eq(creditedByInvoice.invoiceId, invoice.id))
      .where(and(trackedInvoice, sql`${outstanding} > 0`))
      .orderBy(desc(invoice.createdAt), desc(invoice.id))
      .limit(1),
    db
      .select({ id: paymentMethod.id, name: paymentMethod.name })
      .from(paymentMethod)
      .where(eq(paymentMethod.companyId, companyId))
      .orderBy(paymentMethod.name),
    getFiscalYearLifecycle(companyId, ctx.fiscalYear.id),
    getCurrentBankBalances(companyId),
  ]);
  const canWrite = can(ctx.membership.role, "treasury.write");
  const pending = stats.pending;
  const paidInvoices = invoiceCounts?.paid ?? 0;
  const trackedInvoices = invoiceCounts?.total ?? 0;
  const openInvoices = invoiceCounts?.open ?? 0;
  const balance = balances.reduce((sum, account) => sum + account.balance, 0);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Tesorería y bancos"
        description="Caja, bancos, conciliación y previsión de cobros y pagos."
        backHref="/dashboard"
        backLabel="Volver al panel"
        meta={
          <StatusBadge tone={canWrite ? "success" : "warning"}>
            {canWrite ? "Gestión habilitada" : "Solo lectura"}
          </StatusBadge>
        }
        actions={
          canWrite ? (
            <Link
              className={buttonVariants()}
              href="/treasury/bank-transactions/new"
            >
              Nuevo movimiento
            </Link>
          ) : null
        }
      />
      {lifecycle ? (
        <FiscalYearLifecyclePanel canWrite={can(ctx.membership.role, "accounting.write")} lifecycle={{ ...lifecycle, companyId: ctx.company.id }} variant="alert" />
      ) : null}
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard
          href="/treasury/forecast"
          label="Saldo en bancos"
          value={formatMoney(balance, ctx.company.baseCurrencyCode)}
          helper={`${accounts.filter((account) => account.isActive).length} cuentas activas · ver previsión`}
        />
        <MetricCard
          label="Movimientos"
          value={stats.total}
          helper="Transacciones bancarias"
        />
        <MetricCard
          href="/treasury/reconciliation"
          label="Pendientes de conciliar"
          value={pending}
          helper={pending ? `${formatMoney(stats.pendingAmount, ctx.company.baseCurrencyCode)} pendientes de identificar` : "Todo identificado"}
          tone={pending ? "warning" : "success"}
        />
        <MetricCard
          href="/treasury/forecast"
          label="Facturas pendientes"
          value={openInvoices}
          helper="Cobros en seguimiento"
        />
      </section>
      <div data-testid="customer-to-cash-report" id="customer-to-cash-report">
        <MetricCard label="Facturas cobradas" value={paidInvoices} helper={`${trackedInvoices} facturas en seguimiento`} />
      </div>
      <PageSection
        title="Áreas de tesorería"
        description="Accede al espacio de trabajo correspondiente."
      >
        <div className="grid gap-px overflow-hidden border bg-border sm:grid-cols-2 xl:grid-cols-4" data-testid="treasury-areas">
          {areas.map((area) => (
            <Link
              className="bg-background p-3 hover:bg-muted/40"
              href={area.href}
              key={area.href}
            >
              <h2 className="font-semibold">{area.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {area.description}
              </p>
              <span className="mt-5 block text-sm font-medium text-primary">
                Abrir
              </span>
            </Link>
          ))}
        </div>
      </PageSection>
      <PageSection
        title="Registrar cobro"
        description="Aplica un cobro a la siguiente factura pendiente. Se contabiliza en el banco de la forma de pago elegida (o en 572) contra el cliente."
      >
        {selected && canWrite ? (
          <CustomerCashActions
            invoice={{
              id: selected.id,
              number: selected.number,
              customerName: selected.customerName,
              totalAmount: Number(selected.totalAmount),
              totalAmountLabel: formatMoney(
                selected.totalAmount,
                ctx.company.baseCurrencyCode,
              ),
              paymentStatus: selected.paymentStatus,
              outstandingAmount: Math.round(selected.outstandingAmount * 100) / 100,
            }}
            paymentMethods={methods}
          />
        ) : (
          <EmptyState
            title={selected ? "Solo lectura" : "Sin cobros pendientes"}
            description={
              selected
                ? "Tu rol no permite registrar cobros."
                : "Todas las facturas disponibles están cobradas."
            }
          />
        )}
      </PageSection>
    </PageShell>
  );
}

import { desc, eq } from "drizzle-orm";
import Link from "next/link";

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
import {
  listBankAccounts,
  listBankTransactions,
} from "@/server/treasury/service";

const areas = [
  {
    href: "/treasury/bank-accounts",
    title: "Cuentas bancarias",
    description: "Bancos e IBAN operativos.",
  },
  {
    href: "/treasury/bank-transactions",
    title: "Movimientos",
    description: "Extractos y transacciones.",
  },
  {
    href: "/treasury/reconciliation",
    title: "Conciliación",
    description: "Cruce de cobros y pagos.",
  },
  {
    href: "/treasury/forecast",
    title: "Previsión",
    description: "Calendario de caja futura.",
  },
];

export default async function TreasuryPage() {
  const ctx = await requireContext("treasury.read");
  const [accounts, rows, invoices, methods] = await Promise.all([
    listBankAccounts(ctx.company.id),
    listBankTransactions(ctx.company.id),
    db
      .select({
        id: invoice.id,
        number: invoice.number,
        totalAmount: invoice.totalAmount,
        paymentStatus: invoice.paymentStatus,
        customerName: customer.name,
      })
      .from(invoice)
      .innerJoin(customer, eq(invoice.customerId, customer.id))
      .where(eq(invoice.companyId, ctx.company.id))
      .orderBy(desc(invoice.createdAt)),
    db
      .select({ id: paymentMethod.id, name: paymentMethod.name })
      .from(paymentMethod)
      .where(eq(paymentMethod.companyId, ctx.company.id))
      .orderBy(paymentMethod.name),
  ]);
  const canWrite = can(ctx.membership.role, "treasury.write");
  const pending = rows.filter(
    (row) => row.reconciliationStatus === "PENDING",
  ).length;
  const selected = invoices.find((row) => row.paymentStatus !== "PAID");
  const paidInvoices = invoices.filter((row) => row.paymentStatus === "PAID").length;
  const balance = rows.reduce((sum, row) => sum + Number(row.amount), 0);

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
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard
          label="Saldo registrado"
          value={formatMoney(balance, ctx.company.baseCurrencyCode)}
          helper={`${accounts.length} cuentas`}
        />
        <MetricCard
          label="Movimientos"
          value={rows.length}
          helper="Transacciones bancarias"
        />
        <MetricCard
          href="/treasury/reconciliation"
          label="Por conciliar"
          value={pending}
          helper="Movimientos pendientes"
          tone={pending ? "warning" : "success"}
        />
        <MetricCard
          href="/treasury/forecast"
          label="Facturas pendientes"
          value={invoices.filter((row) => row.paymentStatus !== "PAID").length}
          helper="Cobros en seguimiento"
        />
      </section>
      <div data-testid="customer-to-cash-report" id="customer-to-cash-report">
        <MetricCard label="Facturas cobradas" value={paidInvoices} helper={`${invoices.length} facturas en seguimiento`} />
      </div>
      <PageSection
        title="Áreas de tesorería"
        description="Accede al espacio de trabajo correspondiente."
      >
        <div className="grid gap-px overflow-hidden border bg-border sm:grid-cols-2 xl:grid-cols-4">
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
        description="Aplica un cobro a la siguiente factura pendiente."
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

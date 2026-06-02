import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";

import { customer, invoice } from "@/db/schema";
import { CreateInvoiceForm } from "@/components/create-invoice-form";
import { InvoicesList } from "@/components/invoices/invoices-list";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { canManageInvoices } from "@/lib/rbac";

export default async function InvoicesPage() {
  await requireUserSession();
  const tenantContext = await requireContext("invoice.read");

  const customers = await db
    .select({
      id: customer.id,
      name: customer.name,
    })
    .from(customer)
    .where(and(eq(customer.companyId, tenantContext.company.id), eq(customer.status, "ACTIVE")))
    .orderBy(asc(customer.name));

  const invoices = await db
    .select({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      paymentStatus: invoice.paymentStatus,
      totalAmount: invoice.totalAmount,
      issueDate: invoice.issueDate,
      customerName: customer.name,
    })
    .from(invoice)
    .innerJoin(customer, eq(invoice.customerId, customer.id))
    .where(eq(invoice.companyId, tenantContext.company.id))
    .orderBy(desc(invoice.createdAt));

  const canCreateInvoice = canManageInvoices(tenantContext.membership.role);

  return (
    <main className="container mx-auto space-y-6 px-4 py-10">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Facturas</CardTitle>
            <CardDescription>
              Empresa: {tenantContext.company.name} ({tenantContext.membership.role})
            </CardDescription>
          </div>
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver al dashboard
          </Link>
        </CardHeader>
        <CardContent>
          {!canCreateInvoice ? (
            <p className="text-sm text-muted-foreground">Tu rol actual es de solo lectura para facturas.</p>
          ) : customers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Necesitas al menos un cliente activo para crear facturas.
            </p>
          ) : (
            <CreateInvoiceForm customers={customers} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
          <CardDescription>Todas las facturas de tu empresa activa.</CardDescription>
        </CardHeader>
        <CardContent>
          <InvoicesList
            rows={invoices.map((invoice) => ({
              id: invoice.id,
              number: invoice.number,
              status: invoice.paymentStatus,
              totalAmount: invoice.totalAmount,
              totalAmountLabel: formatMoney(invoice.totalAmount.toString(), tenantContext.company.baseCurrencyCode),
              issueDate: invoice.issueDate,
              issueDateLabel: formatDate(invoice.issueDate),
              customerName: invoice.customerName,
            }))}
          />
        </CardContent>
      </Card>
    </main>
  );
}

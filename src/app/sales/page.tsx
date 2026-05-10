import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { customer, deliveryNote, invoice, salesOrder, salesQuote } from "@/db/schema";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";
import { SalesFlowActions } from "@/components/sales/sales-flow-actions";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string | string[] }>;
}) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const params = await searchParams;
  const requestedCustomerId = Array.isArray(params.customerId) ? params.customerId[0] : params.customerId;

  const customers = await db
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(eq(customer.companyId, ctx.company.id));

  const quotes = await db
    .select({ id: salesQuote.id, number: salesQuote.number, status: salesQuote.status })
    .from(salesQuote)
    .where(eq(salesQuote.companyId, ctx.company.id))
    .orderBy(desc(salesQuote.createdAt));

  const orders = await db
    .select({ id: salesOrder.id, number: salesOrder.number, status: salesOrder.status })
    .from(salesOrder)
    .where(eq(salesOrder.companyId, ctx.company.id))
    .orderBy(desc(salesOrder.createdAt));

  const deliveryNotes = await db
    .select({ id: deliveryNote.id, number: deliveryNote.number, status: deliveryNote.status })
    .from(deliveryNote)
    .where(eq(deliveryNote.companyId, ctx.company.id))
    .orderBy(desc(deliveryNote.createdAt));

  const invoices = await db
    .select({ id: invoice.id })
    .from(invoice)
    .where(eq(invoice.companyId, ctx.company.id));

  return (
    <main className="container mx-auto space-y-6 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Ciclo de ventas</CardTitle>
          <CardDescription>
            Flujo presupuesto → pedido → albarán → factura con acciones bloqueadas cuando falta el prerrequisito.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver al dashboard
          </Link>
          <SalesFlowActions
            customers={customers}
            deliveryNotes={deliveryNotes}
            initialCustomerId={requestedCustomerId}
            invoicesCount={invoices.length}
            orders={orders}
            quotes={quotes}
          />
        </CardContent>
      </Card>
    </main>
  );
}

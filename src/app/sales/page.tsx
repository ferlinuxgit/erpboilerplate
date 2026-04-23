import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { customer, deliveryNote, salesOrder, salesQuote } from "@/db/schema";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";
import { SalesFlowActions } from "@/components/sales/sales-flow-actions";

export default async function SalesPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });

  const customers = await db
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(eq(customer.companyId, ctx.company.id));

  const quotes = await db
    .select()
    .from(salesQuote)
    .where(eq(salesQuote.companyId, ctx.company.id))
    .orderBy(desc(salesQuote.createdAt));

  const orders = await db
    .select()
    .from(salesOrder)
    .where(eq(salesOrder.companyId, ctx.company.id))
    .orderBy(desc(salesOrder.createdAt));

  const deliveryNotes = await db
    .select()
    .from(deliveryNote)
    .where(eq(deliveryNote.companyId, ctx.company.id))
    .orderBy(desc(deliveryNote.createdAt));

  return (
    <main className="container mx-auto space-y-6 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Ciclo de ventas</CardTitle>
          <CardDescription>Flujo presupuesto → pedido → albarán → factura.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver al dashboard
          </Link>
          <SalesFlowActions customers={customers} deliveryNotes={deliveryNotes} orders={orders} quotes={quotes} />
        </CardContent>
      </Card>
    </main>
  );
}

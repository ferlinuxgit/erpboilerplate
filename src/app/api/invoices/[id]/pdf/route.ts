import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { customer, invoice } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";
import { renderInvoicePdf } from "@/server/pdf/render";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const { id } = await params;

  const rows = await db
    .select({ number: invoice.number, amount: invoice.totalAmount, customerName: customer.name })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id)))
    .limit(1);
  if (!rows[0]) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });

  const pdf = await renderInvoicePdf({
    number: rows[0].number,
    customerName: rows[0].customerName,
    amount: rows[0].amount.toString(),
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${rows[0].number}.pdf"`,
    },
  });
}

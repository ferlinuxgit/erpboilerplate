import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { EditInvoiceForm } from "@/components/invoices/edit-invoice-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { invoice } from "@/db/schema";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const { id } = await params;
  const rows = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id))).limit(1);
  if (!rows[0]) notFound();
  const data = rows[0];

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader><CardTitle>Editar factura</CardTitle></CardHeader>
        <CardContent>
          <EditInvoiceForm id={data.id} defaultNumber={data.number} defaultStatus={data.status} defaultNotes={data.notes} />
        </CardContent>
      </Card>
    </main>
  );
}

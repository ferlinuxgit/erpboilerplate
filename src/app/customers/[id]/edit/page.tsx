import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { EditCustomerForm } from "@/components/customers/edit-customer-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { customer } from "@/db/schema";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const { id } = await params;
  const rows = await db.select().from(customer).where(and(eq(customer.id, id), eq(customer.companyId, ctx.company.id))).limit(1);
  if (!rows[0]) notFound();
  const data = rows[0];

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader><CardTitle>Editar cliente</CardTitle></CardHeader>
        <CardContent>
          <EditCustomerForm id={data.id} defaultName={data.name} defaultEmail={data.email} defaultPhone={data.phone} defaultStatus={data.status} />
        </CardContent>
      </Card>
    </main>
  );
}

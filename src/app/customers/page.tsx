import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { CustomersTable } from "@/components/customers/customers-table";
import { customer } from "@/db/schema";
import { CreateCustomerForm } from "@/components/create-customer-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { canManageCustomers } from "@/lib/rbac";

export default async function CustomersPage() {
  await requireUserSession();
  const tenantContext = await requireContext("customer.read");

  const customers = await db
    .select()
    .from(customer)
    .where(eq(customer.companyId, tenantContext.company.id))
    .orderBy(desc(customer.createdAt));

  const canCreateCustomer = canManageCustomers(tenantContext.membership.role);

  return (
    <main className="container mx-auto space-y-6 px-4 py-10">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Clientes</CardTitle>
            <CardDescription>
              Empresa: {tenantContext.company.name} ({tenantContext.membership.role})
            </CardDescription>
          </div>
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver al dashboard
          </Link>
        </CardHeader>
        <CardContent>
          {canCreateCustomer ? (
            <CreateCustomerForm />
          ) : (
            <p className="text-sm text-muted-foreground">
              Tu rol actual es de solo lectura para clientes.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
          <CardDescription>Todos los clientes de tu empresa activa.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {customers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay clientes registrados.</p>
          ) : (
            <CustomersTable rows={customers} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}

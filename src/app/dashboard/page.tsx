import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";

export default async function DashboardPage() {
  const session = await requireUserSession();

  const tenantContext = await ensureUserTenant({
    id: session.user.id,
    name: session.user.name,
  });

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Panel ERP SaaS</CardTitle>
          <CardDescription>Base multi-tenant inicial lista para empezar módulos de negocio.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p>Usuario: {session.user.name}</p>
          <p>Email: {session.user.email}</p>
          <p>Tenant activo: {tenantContext.tenant.name}</p>
          <p>Empresa activa: {tenantContext.company.name}</p>
          <p>Ejercicio activo: {tenantContext.fiscalYear.code}</p>
          <p>Rol: {tenantContext.membership.role}</p>
          <Link className={buttonVariants({ variant: "secondary" })} href="/customers">
            Ir a clientes
          </Link>
          <Link className={buttonVariants({ variant: "secondary" })} href="/sales">
            Ir a ciclo de ventas
          </Link>
          <Link className={buttonVariants({ variant: "secondary" })} href="/invoices">
            Ir a facturas
          </Link>
          <Link className={buttonVariants({ variant: "secondary" })} href="/purchases">
            Ir a compras
          </Link>
          <Link className={buttonVariants({ variant: "secondary" })} href="/inventory">
            Ir a inventario
          </Link>
          <Link className={buttonVariants({ variant: "secondary" })} href="/accounting">
            Ir a contabilidad
          </Link>
          <Link className={buttonVariants({ variant: "secondary" })} href="/treasury">
            Ir a tesorería
          </Link>
          <Link className={buttonVariants({ variant: "secondary" })} href="/fiscal">
            Ir a fiscal
          </Link>
          <Link className={buttonVariants({ variant: "secondary" })} href="/reporting">
            Ir a reporting
          </Link>
          <Link className={buttonVariants({ variant: "secondary" })} href="/billing">
            Ir a operación SaaS
          </Link>
          <Link className={buttonVariants({ variant: "secondary" })} href="/settings/security">
            Ir a hardening
          </Link>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  );
}

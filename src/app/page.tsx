import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="container mx-auto flex min-h-[80vh] items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader className="space-y-4">
          <CardTitle className="text-3xl">ERP SaaS Starter</CardTitle>
          <CardDescription>
            Base con Next.js, Tailwind, shadcn/ui, better-auth y PostgreSQL para empezar tu producto.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Link className={buttonVariants({ variant: "default" })} href="/auth/register">
            Crear cuenta
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/auth/login">
            Iniciar sesión
          </Link>
          <Link className={buttonVariants({ variant: "secondary" })} href="/dashboard">
            Ir al dashboard
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/customers">
            Ver clientes
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/invoices">
            Ver facturas
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}

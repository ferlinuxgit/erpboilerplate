"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ActiveContextSwitcher } from "@/components/layout/active-context-switcher";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { buttonVariants } from "@/components/ui/button";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/customers", label: "Clientes" },
  { href: "/invoices", label: "Facturas" },
  { href: "/purchases", label: "Compras" },
  { href: "/inventory", label: "Inventario" },
  { href: "/accounting", label: "Contabilidad" },
  { href: "/treasury", label: "Tesoreria" },
  { href: "/fiscal", label: "Fiscal" },
  { href: "/reporting", label: "Reporting" },
  { href: "/billing", label: "Billing" },
  { href: "/settings/security", label: "Seguridad" },
  { href: "/settings/team", label: "Equipo" },
  { href: "/settings/masters", label: "Maestros" },
];

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const isPublicRoute = pathname === "/" || pathname.startsWith("/auth");

  if (isPublicRoute) {
    return <div className="flex-1">{children}</div>;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-semibold">ERP SaaS</p>
          <LanguageSwitcher />
        </div>
        <div className="mb-3">
          <ActiveContextSwitcher />
        </div>
        <nav className="flex flex-col gap-2">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={buttonVariants({ variant: "ghost" })}>
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex-1">{children}</div>
    </div>
  );
}

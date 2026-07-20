"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type ContextGroup = {
  root: string;
  label: string;
  links: Array<{ href: string; label: string; exact?: boolean }>;
};

const groups: ContextGroup[] = [
  {
    root: "/inventory",
    label: "Inventario",
    links: [
      { href: "/inventory", label: "Existencias", exact: true },
      { href: "/inventory/items", label: "Artículos" },
      { href: "/inventory/warehouses", label: "Almacenes" },
      { href: "/inventory/movements", label: "Movimientos" },
    ],
  },
  {
    root: "/accounting",
    label: "Contabilidad",
    links: [
      { href: "/accounting", label: "Resumen", exact: true },
      { href: "/accounting/accounts", label: "Plan contable" },
      { href: "/accounting/entries", label: "Asientos" },
      { href: "/accounting/reports", label: "Estados financieros" },
    ],
  },
  {
    root: "/treasury",
    label: "Tesorería",
    links: [
      { href: "/treasury", label: "Resumen", exact: true },
      { href: "/treasury/bank-accounts", label: "Cuentas" },
      { href: "/treasury/bank-transactions", label: "Movimientos" },
      { href: "/treasury/reconciliation", label: "Conciliación" },
      { href: "/treasury/forecast", label: "Previsión" },
    ],
  },
  {
    root: "/fiscal",
    label: "Fiscalidad",
    links: [
      { href: "/fiscal", label: "Modelos", exact: true },
      { href: "/fiscal/calendar", label: "Calendario" },
      { href: "/fiscal/settings", label: "Configuración" },
    ],
  },
  {
    root: "/settings",
    label: "Administración",
    links: [
      { href: "/settings/company", label: "Empresa" },
      { href: "/settings/masters", label: "Maestros" },
      { href: "/settings/team", label: "Equipo" },
      { href: "/settings/security", label: "Seguridad" },
      { href: "/settings/api-keys", label: "API" },
      { href: "/settings/audit", label: "Auditoría" },
    ],
  },
];

function isLinkActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ContextNavigation() {
  const pathname = usePathname();
  const group = groups.find(
    (candidate) =>
      pathname === candidate.root || pathname.startsWith(`${candidate.root}/`),
  );
  if (!group) return null;

  return (
    <div
      className="sticky top-16 z-20 border-b border-border/80 bg-background/96 px-2 backdrop-blur lg:top-0 lg:px-4"
      data-testid="context-navigation"
    >
      <div className="mx-auto flex h-11 max-w-[1480px] items-center gap-2 overflow-x-auto px-2 [mask-image:linear-gradient(to_right,black_calc(100%-1.25rem),transparent)] lg:h-12 lg:gap-5 lg:px-4 lg:[mask-image:none]">
        <p className="hidden shrink-0 text-xs font-semibold text-muted-foreground lg:block">
          {group.label}
        </p>
        <nav
          aria-label={`Secciones de ${group.label}`}
          className="flex h-full items-center gap-1"
        >
          <span className="sr-only">Desplaza horizontalmente para ver todas las secciones.</span>
          {group.links.map((link) => {
            const active = isLinkActive(pathname, link.href, link.exact);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-full shrink-0 items-center px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active &&
                    "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary",
                )}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

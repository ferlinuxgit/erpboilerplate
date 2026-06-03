"use client";

import { Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { ActiveContextSwitcher } from "@/components/layout/active-context-switcher";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const navGroups = [
  {
    label: "Inicio",
    links: [{ href: "/dashboard", label: "Panel" }],
  },
  {
    label: "Operación",
    links: [
      { href: "/customers", label: "Clientes" },
      { href: "/invoices", label: "Facturas" },
      { href: "/purchases", label: "Compras" },
      { href: "/expenses", label: "Gastos" },
      { href: "/inventory", label: "Inventario" },
      { href: "/accounting", label: "Contabilidad" },
      { href: "/treasury", label: "Tesorería" },
      { href: "/fiscal", label: "Fiscal" },
      { href: "/reporting", label: "Informes" },
    ],
  },
  {
    label: "Administración",
    links: [
      { href: "/billing", label: "Suscripción" },
      { href: "/settings/company", label: "Empresa" },
      { href: "/settings/api-keys", label: "API" },
      { href: "/settings/security", label: "Seguridad" },
      { href: "/settings/team", label: "Equipo" },
      { href: "/settings/masters", label: "Maestros" },
    ],
  },
];

const links = navGroups.flatMap((group) => group.links);

type AppShellProps = Readonly<{ children: ReactNode }>;

type NavigationGroupsProps = {
  pathname: string;
  onNavigate?: () => void;
  query?: string;
};

function isActiveRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavigationGroups({ pathname, onNavigate, query = "" }: NavigationGroupsProps) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      links: normalizedQuery ? group.links.filter((link) => link.label.toLocaleLowerCase().includes(normalizedQuery)) : group.links,
    }))
    .filter((group) => group.links.length > 0);

  return (
    <nav aria-label="Navegación principal" className="space-y-5">
      {visibleGroups.map((group) => (
        <section key={group.label} className="space-y-2">
          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
          <div className="flex flex-col gap-1">
            {group.links.map((link) => {
              const active = isActiveRoute(pathname, link.href);

              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "w-full justify-start text-left",
                    active && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
                  )}
                  data-active={active ? "true" : undefined}
                  data-testid={`nav-link-${link.href.replace(/\//g, "-").replace(/^-/, "")}`}
                  href={link.href}
                  key={link.href}
                  onClick={onNavigate}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
      {visibleGroups.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Sin módulos coincidentes.</p> : null}
    </nav>
  );
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [navQuery, setNavQuery] = useState("");
  const isPublicRoute = pathname === "/" || pathname.startsWith("/auth");
  const currentLink = links.find((link) => isActiveRoute(pathname, link.href));

  if (isPublicRoute) {
    return <div className="flex-1">{children}</div>;
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside
        className="hidden w-72 shrink-0 flex-col border-r bg-background p-4 lg:flex"
        data-testid="desktop-sidebar"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold leading-none">ERP SaaS</p>
            <p className="mt-1 text-xs text-muted-foreground">Navegación de módulos</p>
          </div>
          <LanguageSwitcher />
        </div>
        <div className="mb-5 rounded-lg border bg-muted/30 p-3" data-testid="context-switcher-desktop">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contexto activo</p>
          <ActiveContextSwitcher />
        </div>
        <div className="relative mb-5">
          <label className="sr-only" htmlFor="desktop-module-search">
            Buscar módulo
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            id="desktop-module-search"
            onChange={(event) => setNavQuery(event.target.value)}
            placeholder="Buscar módulo"
            value={navQuery}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <NavigationGroups pathname={pathname} query={navQuery} />
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col lg:min-w-0">
        <header
          className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur lg:hidden"
          data-testid="mobile-topbar"
        >
          <button
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-navigation-drawer"
            aria-label="Abrir navegación"
            className={cn(buttonVariants({ variant: "outline", size: "icon" }), "shrink-0")}
            onClick={() => setMobileNavOpen(true)}
            type="button"
          >
            <Menu aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-sm font-semibold">{currentLink?.label ?? "ERP SaaS"}</p>
            <p className="truncate text-xs text-muted-foreground">Contexto y módulos</p>
          </div>
          <LanguageSwitcher />
        </header>

        {mobileNavOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              aria-label="Cerrar navegación"
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              onClick={() => setMobileNavOpen(false)}
              type="button"
            />
            <div
              aria-label="Navegación principal"
              aria-modal="true"
              className="relative flex h-full w-[min(22rem,calc(100vw-2rem))] flex-col border-r bg-background p-4 shadow-xl"
              id="mobile-navigation-drawer"
              role="dialog"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold leading-none">ERP SaaS</p>
                  <p className="mt-1 text-xs text-muted-foreground">Menú principal</p>
                </div>
                <button
                  aria-label="Cerrar navegación"
                  className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "shrink-0")}
                  onClick={() => setMobileNavOpen(false)}
                  type="button"
                >
                  <X aria-hidden="true" />
                </button>
              </div>

              <details className="mb-4 rounded-lg border bg-muted/30 p-3">
                <summary className="cursor-pointer text-sm font-medium">Contexto activo</summary>
                <div className="mt-3">
                  <ActiveContextSwitcher />
                </div>
              </details>

              <div className="relative mb-4">
                <label className="sr-only" htmlFor="mobile-module-search">
                  Buscar módulo
                </label>
                <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  id="mobile-module-search"
                  onChange={(event) => setNavQuery(event.target.value)}
                  placeholder="Buscar módulo"
                  value={navQuery}
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <NavigationGroups pathname={pathname} onNavigate={() => setMobileNavOpen(false)} query={navQuery} />
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}

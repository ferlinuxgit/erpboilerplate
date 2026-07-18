"use client";

import {
  Bank,
  BookOpenText,
  BracketsCurly,
  Buildings,
  Calculator,
  ChartLineUp,
  CreditCard,
  Factory,
  List,
  MagnifyingGlass,
  Package,
  Receipt,
  Storefront,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  SquaresFour,
  UserCircleGear,
  UsersThree,
  Wallet,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ActiveContextSwitcher } from "@/components/layout/active-context-switcher";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const navGroups = [
  {
    label: "Inicio",
    links: [{ href: "/dashboard", label: "Panel", icon: SquaresFour }],
  },
  {
    label: "Operación",
    links: [
      { href: "/customers", label: "Clientes", icon: UsersThree },
      { href: "/suppliers", label: "Proveedores", icon: Factory },
      { href: "/sales", label: "Ventas", icon: Storefront },
      { href: "/invoices", label: "Facturas", icon: Receipt },
      { href: "/purchases", label: "Compras", icon: ShoppingCart },
      { href: "/expenses", label: "Gastos", icon: Wallet },
      { href: "/inventory", label: "Inventario", icon: Package },
      { href: "/accounting", label: "Contabilidad", icon: BookOpenText },
      { href: "/treasury", label: "Tesorería", icon: Bank },
      { href: "/fiscal", label: "Fiscal", icon: Calculator },
      { href: "/reporting", label: "Informes", icon: ChartLineUp },
    ],
  },
  {
    label: "Administración",
    links: [
      { href: "/billing", label: "Suscripción", icon: CreditCard },
      { href: "/settings/company", label: "Empresa", icon: Buildings },
      { href: "/settings/api-keys", label: "API", icon: BracketsCurly },
      { href: "/settings/security", label: "Seguridad", icon: ShieldCheck },
      { href: "/settings/team", label: "Equipo", icon: UserCircleGear },
      { href: "/settings/masters", label: "Maestros", icon: SlidersHorizontal },
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
    <nav aria-label="Navegación principal" className="space-y-6">
      {visibleGroups.map((group) => (
        <section key={group.label} className="space-y-2">
          <p className="px-2 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group.label}</p>
          <div className="flex flex-col gap-0.5">
            {group.links.map((link) => {
              const active = isActiveRoute(pathname, link.href);

              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "h-9 w-full justify-start gap-2.5 px-2.5 text-left font-medium",
                    active && "bg-primary text-primary-foreground shadow-[0_1px_0_rgba(255,255,255,0.12)_inset] hover:bg-primary/90 hover:text-primary-foreground",
                  )}
                  data-active={active ? "true" : undefined}
                  data-testid={`nav-link-${link.href.replace(/\//g, "-").replace(/^-/, "")}`}
                  href={link.href}
                  key={link.href}
                  onClick={onNavigate}
                >
                  <link.icon aria-hidden="true" className="size-[1.05rem]" weight={active ? "fill" : "regular"} />
                  <span>{link.label}</span>
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
  const mobileDrawerRef = useRef<HTMLDivElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const isPublicRoute = pathname === "/" || pathname.startsWith("/auth") || pathname.startsWith("/invitations/");
  const currentLink = links.find((link) => isActiveRoute(pathname, link.href));

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    const menuButton = mobileMenuButtonRef.current;
    document.body.style.overflow = "hidden";
    mobileDrawerRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
      if (event.key !== "Tab") return;
      const focusable = Array.from(mobileDrawerRef.current?.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input,select,[tabindex]:not([tabindex='-1'])") ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); menuButton?.focus(); };
  }, [mobileNavOpen]);

  if (isPublicRoute) {
    return <div className="flex-1">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside
        className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 lg:flex"
        data-testid="desktop-sidebar"
      >
        <div className="mb-5 flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-primary text-xs font-bold tracking-[-0.04em] text-primary-foreground">ER</div>
            <div>
              <p className="font-semibold leading-none tracking-[-0.02em]">ERP Suite</p>
              <p className="mt-1 text-[0.7rem] text-muted-foreground">Workspace operativo</p>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
        <div className="mb-4 rounded-xl border border-sidebar-border bg-card/75 p-3" data-testid="context-switcher-desktop">
          <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">Contexto activo</p>
          <ActiveContextSwitcher />
        </div>
        <div className="relative mb-5">
          <label className="sr-only" htmlFor="desktop-module-search">
            Buscar módulo
          </label>
          <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="border-sidebar-border bg-card/75 pl-9"
            id="desktop-module-search"
            onChange={(event) => setNavQuery(event.target.value)}
            placeholder="Buscar módulo"
            value={navQuery}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
          <NavigationGroups pathname={pathname} query={navQuery} />
        </div>
        <div className="mt-4 border-t border-sidebar-border pt-3 text-[0.68rem] leading-5 text-muted-foreground">
          <p>Operación, finanzas y cumplimiento</p>
          <p className="font-mono">{currentLink?.label ?? "Panel"}</p>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col lg:min-w-0">
        <header
          className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border/80 bg-background/95 px-4 backdrop-blur lg:hidden"
          data-testid="mobile-topbar"
        >
          <button
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-navigation-drawer"
            aria-label="Abrir navegación"
            className={cn(buttonVariants({ variant: "outline", size: "icon" }), "shrink-0")}
            onClick={() => setMobileNavOpen(true)}
            ref={mobileMenuButtonRef}
            type="button"
          >
            <List aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-sm font-semibold tracking-[-0.01em]">{currentLink?.label ?? "ERP Suite"}</p>
            <p className="truncate text-[0.7rem] text-muted-foreground">Workspace operativo</p>
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
              className="relative flex h-full w-[min(22rem,calc(100vw-2rem))] flex-col border-r border-sidebar-border bg-sidebar p-4 shadow-[20px_0_60px_rgba(20,45,38,0.12)]"
              id="mobile-navigation-drawer"
              role="dialog"
              ref={mobileDrawerRef}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">ER</div>
                  <div>
                    <p className="font-semibold leading-none">ERP Suite</p>
                    <p className="mt-1 text-xs text-muted-foreground">Menú principal</p>
                  </div>
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

              <details className="mb-4 rounded-xl border border-sidebar-border bg-card/75 p-3">
                <summary className="cursor-pointer text-sm font-medium">Contexto activo</summary>
                <div className="mt-3">
                  <ActiveContextSwitcher />
                </div>
              </details>

              <div className="relative mb-4">
                <label className="sr-only" htmlFor="mobile-module-search">
                  Buscar módulo
                </label>
                <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="border-sidebar-border bg-card/75 pl-9"
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

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

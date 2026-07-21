"use client";

import { List, X } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ActiveContextSwitcher } from "@/components/layout/active-context-switcher";
import { CommandPaletteButton, GlobalCommandPalette } from "@/components/layout/global-command-palette";
import { ContextNavigation } from "@/components/layout/context-navigation";
import { FormNavigationGuard } from "@/components/layout/form-navigation-guard";
import {
  getContextGroup,
  isActiveRoute,
  navigationLinks,
  navGroups,
} from "@/components/layout/navigation-config";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AppShellProps = Readonly<{ children: ReactNode }>;

type NavigationGroupsProps = {
  pathname: string;
  onNavigate?: () => void;
};

function NavigationGroups({ pathname, onNavigate }: NavigationGroupsProps) {
  return (
    <nav aria-label="Navegación principal" className="space-y-1">
      {navGroups.map((group) => (
        <section key={group.label}>
          <p className="mb-px border-b border-window-shadow px-1.5 pb-px font-mono text-[0.52rem] font-bold uppercase tracking-[0.06em] text-window-muted">
            {group.code} · {group.label}
          </p>
          <div className="flex flex-col gap-px">
            {group.links.map((link) => {
              const active = isActiveRoute(pathname, link.href);

              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "h-8 w-full justify-start gap-1.5 border-transparent px-1.5 text-left font-sans text-[0.72rem] font-semibold lg:h-[1.4rem]",
                    active &&
                      "border-window-dark-shadow bg-primary text-primary-foreground shadow-[inset_1px_1px_0_rgba(255,255,255,0.4),inset_-1px_-1px_0_rgba(0,0,0,0.55)] hover:bg-primary hover:text-primary-foreground",
                  )}
                  data-active={active ? "true" : undefined}
                  data-testid={`nav-link-${link.href.replace(/\//g, "-").replace(/^-/, "")}`}
                  href={link.href}
                  key={link.href}
                  onClick={onNavigate}
                >
                  <span className={cn("w-5 shrink-0 font-mono text-[0.6rem]", active ? "text-white/75" : "text-window-muted")}>{link.code}</span>
                  <link.icon aria-hidden="true" className="size-3.5" weight={active ? "fill" : "regular"} />
                  <span className="truncate">{link.label}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileDrawerRef = useRef<HTMLDivElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const isPublicRoute = pathname === "/" || pathname.startsWith("/auth") || pathname.startsWith("/invitations/");
  const currentLink = navigationLinks.find((link) => isActiveRoute(pathname, link.href));
  const contextGroup = getContextGroup(pathname);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    const menuButton = mobileMenuButtonRef.current;
    document.body.style.overflow = "hidden";
    mobileDrawerRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        mobileDrawerRef.current?.querySelectorAll<HTMLElement>(
          "a[href],button:not([disabled]),input,select,[tabindex]:not([tabindex='-1'])",
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      menuButton?.focus();
    };
  }, [mobileNavOpen]);

  if (isPublicRoute) return <div className="flex-1">{children}</div>;

  return (
    <div className="min-h-dvh bg-background lg:flex">
      <a
        className="fixed left-2 top-2 z-50 -translate-y-20 border border-window-dark-shadow bg-focus px-3 py-2 font-mono text-xs font-bold text-black focus:translate-y-0"
        href="#main-content"
      >
        Saltar al contenido
      </a>
      <GlobalCommandPalette />
      <FormNavigationGuard />

      <aside
        className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-window-dark-shadow bg-sidebar lg:flex xl:w-60"
        data-testid="desktop-sidebar"
      >
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-window-dark-shadow bg-chrome-active px-2 text-chrome-active-foreground">
          <div className="grid size-7 place-items-center border border-white/70 bg-white font-mono text-[0.62rem] font-black text-primary shadow-[inset_1px_1px_0_white,inset_-1px_-1px_0_#737373]">ER</div>
          <div className="min-w-0 leading-none">
            <p className="truncate font-mono text-xs font-bold">ERP_SUITE.EXE</p>
            <p className="mt-0.5 truncate font-mono text-[0.55rem] text-white/70">WORKSPACE OPERATIVO</p>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-2">
          <CommandPaletteButton className="mb-2 h-8 w-full" />
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-color:var(--window-shadow)_var(--window-panel)] [scrollbar-width:thin]">
            <NavigationGroups pathname={pathname} />
          </div>
          <div className="mt-2 flex h-7 shrink-0 items-center justify-between border border-window-dark-shadow bg-window-panel px-1.5 font-mono text-[0.58rem] text-window-muted shadow-[inset_1px_1px_0_var(--window-highlight)]">
            <span>OWNER</span>
            <span className="text-emerald-800">● ONLINE</span>
            <span>F1 AYUDA</span>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 hidden h-10 shrink-0 items-center justify-between gap-2 border-b border-window-dark-shadow bg-chrome-active px-2 text-chrome-active-foreground lg:flex">
          <div className="flex min-w-0 items-center gap-2 font-mono">
            <span className="border border-white/50 bg-black/15 px-1.5 py-0.5 text-[0.58rem] font-bold">{contextGroup?.code ?? currentLink?.code ?? "00"}</span>
            <span className="truncate text-xs font-bold uppercase">{contextGroup?.label ?? currentLink?.label ?? "Panel"}</span>
            <span className="hidden truncate text-[0.62rem] text-white/65 xl:inline">\ {currentLink?.label ?? "Vista general"}</span>
          </div>
          <ActiveContextSwitcher compact />
        </header>

        <header
          className="sticky top-0 z-40 flex h-[3.25rem] shrink-0 items-center justify-between gap-2 border-b border-window-dark-shadow bg-chrome-active px-2 text-chrome-active-foreground lg:hidden"
          data-testid="mobile-topbar"
        >
          <button
            aria-controls="mobile-navigation-drawer"
            aria-expanded={mobileNavOpen}
            aria-label="Abrir navegación"
            className={cn(buttonVariants({ variant: "outline", size: "icon-lg" }), "shrink-0")}
            onClick={() => setMobileNavOpen(true)}
            ref={mobileMenuButtonRef}
            type="button"
          >
            <List aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1 font-mono leading-none">
            <p className="truncate text-center text-xs font-bold uppercase">{currentLink?.label ?? contextGroup?.label ?? "ERP Suite"}</p>
            <p className="mt-1 truncate text-center text-[0.58rem] text-white/70">ERP_SUITE.EXE</p>
          </div>
          <span aria-hidden="true" className="size-9 shrink-0" />
        </header>

        {mobileNavOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button aria-label="Cerrar navegación" className="absolute inset-0 bg-black/55" onClick={() => setMobileNavOpen(false)} type="button" />
            <div
              aria-label="Navegación principal"
              aria-modal="true"
              className="relative flex h-full w-[min(20rem,calc(100vw-1rem))] flex-col border-r border-window-dark-shadow bg-sidebar shadow-[8px_0_0_rgba(0,0,0,0.3)]"
              id="mobile-navigation-drawer"
              ref={mobileDrawerRef}
              role="dialog"
            >
              <div className="flex h-[3.25rem] shrink-0 items-center justify-between gap-2 border-b border-window-dark-shadow bg-chrome-active px-2 text-chrome-active-foreground">
                <div className="flex items-center gap-2">
                  <div className="grid size-7 place-items-center border border-white/70 bg-white font-mono text-[0.62rem] font-black text-primary">ER</div>
                  <div>
                    <p className="font-mono text-xs font-bold">ERP_SUITE.EXE</p>
                    <p className="font-mono text-[0.55rem] text-white/70">MENÚ PRINCIPAL</p>
                  </div>
                </div>
                <button
                  aria-label="Cerrar navegación"
                  className={buttonVariants({ variant: "outline", size: "icon-lg" })}
                  onClick={() => setMobileNavOpen(false)}
                  type="button"
                >
                  <X aria-hidden="true" />
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col p-2">
                <details className="mb-2 border border-window-dark-shadow bg-window-panel p-2 shadow-[inset_1px_1px_0_var(--window-highlight)]">
                  <summary className="cursor-pointer font-mono text-xs font-bold">Contexto activo</summary>
                  <div className="mt-2"><ActiveContextSwitcher /></div>
                </details>
                <CommandPaletteButton className="mb-2 w-full" onOpen={() => setMobileNavOpen(false)} />
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <NavigationGroups pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <ContextNavigation />
        <div className="min-w-0 flex-1" id="main-content">{children}</div>
      </div>
    </div>
  );
}

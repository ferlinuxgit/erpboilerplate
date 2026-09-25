"use client";

import { List, X } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ActiveContextSwitcher } from "@/components/layout/active-context-switcher";
import { CommandPaletteButton, GlobalCommandPalette } from "@/components/layout/global-command-palette";
import { ContextNavigation } from "@/components/layout/context-navigation";
import { FormNavigationGuard } from "@/components/layout/form-navigation-guard";
import { useKeyboardPreferences } from "@/components/layout/keyboard-preferences";
import { KeyboardShortcuts } from "@/components/layout/keyboard-shortcuts";
import { SessionPanel } from "@/components/layout/session-panel";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";
import {
  filterNavigationGroups,
  getContextGroup,
  isActiveRoute,
  navigationLinks,
  navGroups,
  type NavigationGroup,
} from "@/components/layout/navigation-config";
import { buttonVariants } from "@/components/ui/button";
import { useActiveContext } from "@/lib/active-context-client";
import { cn } from "@/lib/utils";

type AppShellProps = Readonly<{ children: ReactNode }>;

type NavigationGroupsProps = {
  id: string;
  groups: NavigationGroup[];
  keyboardMode: boolean;
  pathname: string;
  onNavigate?: () => void;
};

function NavigationLinks({ group, keyboardMode, pathname, onNavigate }: { group: NavigationGroup; keyboardMode: boolean; pathname: string; onNavigate?: () => void }) {
  return (
    <div className="flex flex-col gap-px">
      {group.links.map((link) => {
        const active = isActiveRoute(pathname, link.href);

        return (
          <Link
            aria-current={active ? "page" : undefined}
            aria-keyshortcuts={keyboardMode ? `G ${link.code.split("").join(" ")}` : undefined}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "h-8 w-full justify-start gap-1.5 border-transparent px-1.5 text-left font-sans text-[0.75rem] font-semibold lg:h-6",
              active &&
                "border-window-dark-shadow bg-primary text-primary-foreground shadow-[inset_1px_1px_0_rgba(255,255,255,0.4),inset_-1px_-1px_0_rgba(0,0,0,0.55)] hover:bg-primary hover:text-primary-foreground",
            )}
            data-active={active ? "true" : undefined}
            data-testid={`nav-link-${link.href.replace(/\//g, "-").replace(/^-/, "")}`}
            href={link.href}
            key={link.href}
            onClick={onNavigate}
          >
            {keyboardMode ? (
              <span className={cn("w-5 shrink-0 font-mono text-xs", active ? "text-primary-foreground/80" : "text-window-muted")}>{link.code}</span>
            ) : null}
            <link.icon aria-hidden="true" className="size-3.5" weight={active ? "fill" : "regular"} />
            <span className="truncate">{link.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

const groupHeadingClass = "mb-px border-b border-window-shadow px-1.5 pb-px font-mono text-xs font-bold uppercase tracking-[0.06em] text-window-muted";

function NavigationGroups({ groups, id, keyboardMode, pathname, onNavigate }: NavigationGroupsProps) {
  return (
    <nav
      aria-label="Navegación principal"
      className="space-y-1"
      id={id}
      onKeyDown={(event) => {
        const currentLink = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
        if (!currentLink) return;
        const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[href]"))
          .filter((link) => link.getClientRects().length > 0);
        const currentIndex = links.indexOf(currentLink);
        let nextIndex: number | null = null;
        if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % links.length;
        else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + links.length) % links.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = links.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        links[nextIndex]?.focus();
        links[nextIndex]?.scrollIntoView({ block: "nearest" });
      }}
    >
      {groups.map((group) => {
        const heading = keyboardMode ? `${group.code} · ${group.label}` : group.label;
        if (group.collapsible) {
          // Secciones avanzadas plegadas; se abren solas si la página actual está dentro.
          const containsActive = group.links.some((link) => isActiveRoute(pathname, link.href));
          return (
            <details className="group/advanced" key={`${group.label}-${containsActive ? "active" : "idle"}`} open={containsActive || undefined}>
              <summary className={cn(groupHeadingClass, "cursor-pointer list-none hover:text-window-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus")}>
                <span aria-hidden="true" className="mr-1 inline-block transition-transform group-open/advanced:rotate-90">›</span>
                {heading}
              </summary>
              <NavigationLinks group={group} keyboardMode={keyboardMode} onNavigate={onNavigate} pathname={pathname} />
            </details>
          );
        }
        return (
          <section key={group.label}>
            <p className={groupHeadingClass}>{heading}</p>
            <NavigationLinks group={group} keyboardMode={keyboardMode} onNavigate={onNavigate} pathname={pathname} />
          </section>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileDrawerRef = useRef<HTMLDivElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const isPublicRoute = pathname === "/" || pathname.startsWith("/auth") || pathname.startsWith("/invitations/");
  const activeContext = useActiveContext(!isPublicRoute);
  const { keyboardMode } = useKeyboardPreferences();
  const visibleGroups = filterNavigationGroups(navGroups, { businessType: activeContext?.businessType, role: activeContext?.user.role });
  const activeCompanyName = activeContext?.availableCompanies.find((company) => company.id === activeContext.active.companyId)?.name ?? null;
  const activeFiscalYearCode = activeContext?.availableFiscalYears.find((year) => year.id === activeContext.active.fiscalYearId)?.code ?? null;
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
      <KeyboardShortcuts />

      <aside
        className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-window-dark-shadow bg-sidebar lg:flex xl:w-60"
        data-testid="desktop-sidebar"
      >
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-window-dark-shadow bg-chrome-active px-2 text-chrome-active-foreground">
          <div className="grid size-7 place-items-center border border-white/70 bg-window-highlight font-mono text-xs font-black text-primary shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)]">ER</div>
          <div className="min-w-0 leading-none">
            <p className="truncate font-mono text-xs font-bold">ERP Suite</p>
            <p className="mt-0.5 truncate font-mono text-xs text-chrome-active-foreground/75" title={activeCompanyName ?? undefined}>{activeCompanyName ?? "Espacio de trabajo"}</p>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-2">
          <CommandPaletteButton className="mb-2 h-8 w-full" />
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-color:var(--window-shadow)_var(--window-panel)] [scrollbar-width:thin]">
            <NavigationGroups groups={visibleGroups} id="primary-navigation" keyboardMode={keyboardMode} pathname={pathname} />
          </div>
          <SessionPanel className="mt-2" />
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 hidden h-10 shrink-0 items-center justify-between gap-2 border-b border-window-dark-shadow bg-chrome-active px-2 text-chrome-active-foreground lg:flex">
          <div className="flex min-w-0 items-center gap-2 font-mono">
            {keyboardMode ? <span className="border border-white/50 bg-black/15 px-1.5 py-0.5 text-xs font-bold">{contextGroup?.code ?? currentLink?.code ?? "00"}</span> : null}
            <span className="truncate text-xs font-bold uppercase">{contextGroup?.label ?? currentLink?.label ?? "Panel"}</span>
            <span className="hidden truncate text-xs text-chrome-active-foreground/75 xl:inline">\ {currentLink?.label ?? "Vista general"}</span>
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <ThemeSwitcher compact />
            <ActiveContextSwitcher compact />
          </div>
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
            {/* Empresa y ejercicio activos siempre visibles en móvil. */}
            <p className="mt-1 truncate text-center text-xs text-chrome-active-foreground/75" data-testid="mobile-active-company">
              {activeCompanyName ? `${activeCompanyName}${activeFiscalYearCode ? ` · ${activeFiscalYearCode}` : ""}` : "ERP Suite"}
            </p>
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
                  <div className="grid size-7 place-items-center border border-white/70 bg-window-highlight font-mono text-xs font-black text-primary">ER</div>
                  <div>
                    <p className="font-mono text-xs font-bold">ERP Suite</p>
                    <p className="font-mono text-xs text-chrome-active-foreground/75">Menú principal</p>
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
                <div className="mb-2 border border-window-dark-shadow bg-window-panel p-2 shadow-[inset_1px_1px_0_var(--window-highlight)]">
                  <p className="mb-1 font-mono text-xs font-bold uppercase tracking-[0.06em] text-window-muted">Paleta de interfaz</p>
                  <ThemeSwitcher />
                </div>
                <details className="mb-2 border border-window-dark-shadow bg-window-panel p-2 shadow-[inset_1px_1px_0_var(--window-highlight)]">
                  <summary className="cursor-pointer font-mono text-xs font-bold">Contexto activo</summary>
                  <div className="mt-2"><ActiveContextSwitcher onChanged={() => setMobileNavOpen(false)} /></div>
                </details>
                <CommandPaletteButton className="mb-2 w-full" onOpen={() => setMobileNavOpen(false)} />
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <NavigationGroups groups={visibleGroups} id="mobile-primary-navigation" keyboardMode={keyboardMode} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
                </div>
                <SessionPanel className="mt-2" onNavigate={() => setMobileNavOpen(false)} />
              </div>
            </div>
          </div>
        ) : null}

        <ContextNavigation businessType={activeContext?.businessType} keyboardMode={keyboardMode} />
        <div
          className="min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
          id="main-content"
          tabIndex={-1}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

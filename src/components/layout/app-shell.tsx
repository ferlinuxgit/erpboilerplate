"use client";

import { List, X } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { ActiveContextSwitcher } from "@/components/layout/active-context-switcher";
import { CommandPaletteButton, GlobalCommandPalette } from "@/components/layout/global-command-palette";
import { ContextNavigation } from "@/components/layout/context-navigation";
import { FormNavigationGuard } from "@/components/layout/form-navigation-guard";
import { useKeyboardPreferences } from "@/components/layout/keyboard-preferences";
import { KeyboardShortcuts } from "@/components/layout/keyboard-shortcuts";
import { SessionExpiryWatcher } from "@/components/layout/session-expiry-watcher";
import { SessionPanel } from "@/components/layout/session-panel";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";
import {
  filterNavigationGroups,
  getContextGroup,
  getMobileTaskbarLinks,
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
  onNavigate?: NavigateHandler;
};

type NavigateHandler = (event: MouseEvent<HTMLAnchorElement>) => void;

function NavigationLinks({ group, keyboardMode, pathname, onNavigate }: { group: NavigationGroup; keyboardMode: boolean; pathname: string; onNavigate?: NavigateHandler }) {
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
              "h-11 w-full justify-start gap-2 border-transparent px-2 text-left font-sans text-sm font-semibold lg:h-6 lg:gap-1.5 lg:px-1.5 lg:text-xs",
              active &&
                "border-window-dark-shadow bg-primary text-primary-foreground shadow-raised-tinted hover:bg-primary hover:text-primary-foreground",
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
            <link.icon aria-hidden="true" className="size-4 lg:size-3.5" weight={active ? "fill" : "regular"} />
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
              <summary className={cn(groupHeadingClass, "cursor-pointer list-none py-2 hover:text-window-text lg:py-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus")}>
                <span aria-hidden="true" className="mr-1 inline-block motion-safe:transition-transform group-open/advanced:rotate-90">›</span>
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

const taskbarItemClass =
  "flex h-full min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-surface border border-window-dark-shadow bg-window-surface px-0.5 font-sans text-xs font-semibold leading-none text-window-text shadow-raised outline-none active:shadow-pressed focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus";
const taskbarItemActiveClass = "bg-window-panel font-bold shadow-pressed";

/**
 * Barra de tareas inferior en móvil (<lg): cuatro accesos diarios + "Menú", que abre el cajón
 * con la navegación completa. No usa los testids `nav-link-*` ni el nombre "Navegación
 * principal" para no duplicar los del menú lateral/cajón.
 */
function MobileTaskbar({
  drawerOpen,
  groups,
  onOpenMenu,
  pathname,
}: {
  drawerOpen: boolean;
  groups: NavigationGroup[];
  onOpenMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  pathname: string;
}) {
  const links = getMobileTaskbarLinks(groups);

  return (
    <nav
      aria-label="Accesos rápidos"
      className="fixed inset-x-0 bottom-0 z-40 h-(--mobile-taskbar-height) border-t border-window-dark-shadow bg-window-panel pb-[env(safe-area-inset-bottom)] shadow-bevel-top lg:hidden"
      data-testid="mobile-taskbar"
    >
      <ul className="grid h-full grid-cols-5 gap-1 px-1 py-1">
        {links.map((link) => {
          const active = isActiveRoute(pathname, link.href);
          return (
            <li className="min-w-0" key={link.href}>
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(taskbarItemClass, active && taskbarItemActiveClass)}
                data-testid={`taskbar-link-${link.href.replace(/\//g, "-").replace(/^-/, "")}`}
                href={link.href}
              >
                <link.icon aria-hidden="true" className="size-5 shrink-0" weight={active ? "fill" : "regular"} />
                <span className="max-w-full truncate">{link.shortLabel ?? link.label}</span>
              </Link>
            </li>
          );
        })}
        <li className="col-start-5 min-w-0">
          <button
            aria-controls="mobile-navigation-drawer"
            aria-expanded={drawerOpen}
            aria-haspopup="dialog"
            className={cn(taskbarItemClass, "w-full", drawerOpen && taskbarItemActiveClass)}
            data-testid="taskbar-menu"
            onClick={onOpenMenu}
            type="button"
          >
            <List aria-hidden="true" className="size-5 shrink-0" weight={drawerOpen ? "bold" : "regular"} />
            <span>Menú</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

/** "open" monta el cajón; "closing" lo mantiene montado mientras dura la animación de salida. */
type DrawerState = "closed" | "open" | "closing";
const DRAWER_EXIT_MS = 200;

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [drawerState, setDrawerState] = useState<DrawerState>("closed");
  // Sin animación cuando se abre o cierra con teclado (atajos, Enter, Escape): debe ser inmediato.
  const [drawerInstant, setDrawerInstant] = useState(false);
  const mobileNavOpen = drawerState === "open";
  const drawerClosing = drawerState === "closing";
  const mobileDrawerRef = useRef<HTMLDivElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  // Botón que abrió el cajón (cabecera o barra inferior): recibe el foco al cerrarlo.
  const drawerOpenerRef = useRef<HTMLElement | null>(null);

  const openMobileNav = (event: MouseEvent<HTMLButtonElement>) => {
    drawerOpenerRef.current = event.currentTarget;
    // detail === 0: activación por teclado o click() programático (Alt Mayús 1).
    setDrawerInstant(event.detail === 0);
    setDrawerState("open");
  };
  const closeMobileNav = (instant = false) => {
    setDrawerInstant(instant);
    setDrawerState((current) => (current === "closed" ? current : instant ? "closed" : "closing"));
  };

  useEffect(() => {
    if (drawerState !== "closing") return;
    const timer = window.setTimeout(() => setDrawerState((current) => (current === "closing" ? "closed" : current)), DRAWER_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [drawerState]);

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
    const menuButton = drawerOpenerRef.current ?? mobileMenuButtonRef.current;
    document.body.style.overflow = "hidden";
    mobileDrawerRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Cierre por teclado: inmediato, sin animación.
        setDrawerInstant(true);
        setDrawerState("closed");
      }
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
    <div
      /*
       * --mobile-taskbar-height: alto total que ocupa la barra de tareas inferior en móvil
       * (3.5rem + env(safe-area-inset-bottom)); vale 0px desde lg, donde no existe.
       * Lo que se pegue al borde inferior dentro del shell debe sumarlo para quedar por
       * encima de la barra, p. ej.:
       *   bottom-[calc(var(--mobile-taskbar-height,env(safe-area-inset-bottom))+0.5rem)]
       * (el valor de reserva cubre las pantallas sin shell: login, portales).
       */
      className="min-h-dvh bg-background [--mobile-taskbar-height:calc(3.5rem+env(safe-area-inset-bottom))] lg:flex lg:[--mobile-taskbar-height:0px]"
    >
      <a
        className="fixed left-2 top-2 z-50 -translate-y-20 border border-window-dark-shadow bg-primary px-3 py-2 font-mono text-xs font-bold text-primary-foreground focus:translate-y-0"
        href="#main-content"
      >
        Saltar al contenido
      </a>
      <GlobalCommandPalette />
      <FormNavigationGuard />
      <SessionExpiryWatcher />
      <KeyboardShortcuts />

      <aside
        className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-window-dark-shadow bg-sidebar lg:flex xl:w-60"
        data-testid="desktop-sidebar"
      >
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-window-dark-shadow bg-chrome-active px-2 text-chrome-active-foreground">
          <div className="grid size-7 place-items-center border border-white/70 bg-window-highlight font-mono text-xs font-black text-window-text shadow-raised">ER</div>
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
            onClick={openMobileNav}
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

        {drawerState !== "closed" ? (
          <div className={cn("fixed inset-0 z-50 lg:hidden", drawerClosing && "pointer-events-none")} data-state={drawerClosing ? "closing" : "open"}>
            {/*
              El fondo cierra al pulsar, pero no es un segundo botón "Cerrar" para el lector de pantalla.
              Entrada con @starting-style y salida con transición: ambas interrumpibles. Con
              movimiento reducido solo se conserva el fundido del fondo.
            */}
            <div
              aria-hidden="true"
              className={cn(
                "absolute inset-0 bg-black/55",
                !drawerInstant && "transition-opacity duration-250 ease-drawer starting:opacity-0",
                drawerClosing && "opacity-0 duration-200",
              )}
              onClick={() => closeMobileNav()}
            />
            <div
              aria-label="Navegación principal"
              aria-modal={drawerClosing ? undefined : "true"}
              className={cn(
                "relative flex h-full w-[min(20rem,calc(100vw-1rem))] flex-col border-r border-window-dark-shadow bg-sidebar shadow-[8px_0_0_rgba(0,0,0,0.3)]",
                !drawerInstant && "motion-safe:transition-transform motion-safe:duration-250 motion-safe:ease-drawer motion-safe:starting:-translate-x-full",
                drawerClosing && "-translate-x-full motion-safe:duration-200",
              )}
              id="mobile-navigation-drawer"
              inert={drawerClosing}
              ref={mobileDrawerRef}
              role="dialog"
            >
              <div className="flex h-[3.25rem] shrink-0 items-center justify-between gap-2 border-b border-window-dark-shadow bg-chrome-active px-2 text-chrome-active-foreground">
                <div className="flex items-center gap-2">
                  <div className="grid size-7 place-items-center border border-white/70 bg-window-highlight font-mono text-xs font-black text-window-text">ER</div>
                  <div>
                    <p className="font-mono text-xs font-bold">ERP Suite</p>
                    <p className="font-mono text-xs text-chrome-active-foreground/75">Menú principal</p>
                  </div>
                </div>
                <button
                  aria-label="Cerrar navegación"
                  className={buttonVariants({ variant: "outline", size: "icon-lg" })}
                  onClick={(event) => closeMobileNav(event.detail === 0)}
                  type="button"
                >
                  <X aria-hidden="true" />
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col p-2">
                <div className="mb-2 border border-window-dark-shadow bg-window-panel p-2 shadow-bevel-top">
                  <p className="mb-1 font-mono text-xs font-bold uppercase tracking-[0.06em] text-window-muted">Paleta de interfaz</p>
                  <ThemeSwitcher />
                </div>
                <details className="mb-2 border border-window-dark-shadow bg-window-panel p-2 shadow-bevel-top">
                  <summary className="cursor-pointer font-mono text-xs font-bold">Contexto activo</summary>
                  <div className="mt-2"><ActiveContextSwitcher onChanged={() => closeMobileNav()} /></div>
                </details>
                {/* La paleta de comandos se abre encima: el cajón se cierra sin animación. */}
                <CommandPaletteButton className="mb-2 w-full" onOpen={() => closeMobileNav(true)} />
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <NavigationGroups
                    groups={visibleGroups}
                    id="mobile-primary-navigation"
                    keyboardMode={keyboardMode}
                    onNavigate={(event) => closeMobileNav(event.detail === 0)}
                    pathname={pathname}
                  />
                </div>
                <SessionPanel className="mt-2" onNavigate={() => closeMobileNav()} />
              </div>
            </div>
          </div>
        ) : null}

        <ContextNavigation businessType={activeContext?.businessType} keyboardMode={keyboardMode} />
        <div
          // Reserva el alto de la barra inferior móvil para que no tape el final de la página.
          className="min-w-0 flex-1 pb-(--mobile-taskbar-height) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
          id="main-content"
          tabIndex={-1}
        >
          {children}
        </div>
      </div>

      <MobileTaskbar drawerOpen={mobileNavOpen} groups={visibleGroups} onOpenMenu={openMobileNav} pathname={pathname} />
    </div>
  );
}

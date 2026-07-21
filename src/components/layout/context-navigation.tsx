"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { getContextGroup } from "@/components/layout/navigation-config";
import { cn } from "@/lib/utils";

function isLinkActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ContextNavigation() {
  const pathname = usePathname();
  const group = getContextGroup(pathname);
  if (!group) return null;

  return (
    <div
      className="sticky top-[3.25rem] z-30 border-b border-window-dark-shadow bg-window-surface text-window-text lg:top-10"
      data-testid="context-navigation"
    >
      <div className="flex h-9 min-w-0 items-stretch overflow-x-auto [scrollbar-width:thin] lg:h-8">
        <p className="hidden shrink-0 items-center border-r border-window-shadow bg-window-panel px-3 font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-window-muted lg:flex">
          {group.code} · {group.label}
        </p>
        <nav
          aria-label={`Secciones de ${group.label}`}
          className="flex min-w-max items-stretch"
        >
          <span className="sr-only">Desplaza horizontalmente para ver todas las secciones.</span>
          {group.links.map((link) => {
            const active = isLinkActive(pathname, link.href, link.exact);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex shrink-0 items-center border-r border-window-shadow px-3 font-mono text-[0.72rem] font-semibold text-window-muted outline-none transition-none hover:bg-window-highlight hover:text-window-text focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
                  active &&
                    "bg-window-highlight text-window-text shadow-[inset_0_-3px_0_var(--chrome-active)]",
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

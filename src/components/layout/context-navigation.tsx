"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { filterContextLinks, getActiveContextHref, getContextGroup } from "@/components/layout/navigation-config";
import { cn } from "@/lib/utils";

export function ContextNavigation({ businessType, keyboardMode = false }: { businessType?: string | null; keyboardMode?: boolean }) {
  const pathname = usePathname();
  const group = getContextGroup(pathname);
  if (!group) return null;
  const links = filterContextLinks(group, { businessType });
  const activeHref = getActiveContextHref(pathname, links);

  return (
    <div
      className="sticky top-[3.25rem] z-30 border-b border-window-dark-shadow bg-window-surface text-window-text lg:top-10"
      data-testid="context-navigation"
    >
      <div className="flex h-9 min-w-0 items-stretch overflow-x-auto [scrollbar-width:thin] lg:h-8">
        <p className="hidden shrink-0 items-center border-r border-window-shadow bg-window-panel px-3 font-mono text-xs font-bold uppercase tracking-[0.08em] text-window-muted lg:flex">
          {keyboardMode ? `${group.code} · ${group.label}` : group.label}
        </p>
        <nav
          aria-label={`Secciones de ${group.label}`}
          className="flex min-w-max items-stretch"
          id="context-navigation"
          onKeyDown={(event) => {
            const currentLink = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
            if (!currentLink) return;
            const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[href]"));
            const currentIndex = links.indexOf(currentLink);
            let nextIndex: number | null = null;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % links.length;
            else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + links.length) % links.length;
            else if (event.key === "Home") nextIndex = 0;
            else if (event.key === "End") nextIndex = links.length - 1;
            if (nextIndex === null) return;
            event.preventDefault();
            links[nextIndex]?.focus();
            links[nextIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
          }}
        >
          <span className="sr-only">Desplaza horizontalmente para ver todas las secciones.</span>
          {links.map((link) => {
            const active = link.href === activeHref;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex shrink-0 items-center border-r border-window-shadow px-3 font-mono text-xs font-semibold text-window-muted outline-none transition-none hover:bg-window-highlight hover:text-window-text focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
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

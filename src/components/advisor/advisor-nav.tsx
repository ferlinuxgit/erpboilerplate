"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

export type AdvisorNavItem = { href: string; label: string };

/** Pestañas del portal: conservan el ejercicio y el periodo elegidos al cambiar de sección. */
export function AdvisorNav({ items }: { items: AdvisorNavItem[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = new URLSearchParams();
  for (const key of ["year", "period"]) {
    const value = searchParams.get(key);
    if (value) query.set(key, value);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return (
    <nav aria-label="Secciones del portal" className="flex gap-1 overflow-x-auto">
      {items.map((item) => {
        const active = item.href === "/asesor" ? pathname === "/asesor" : pathname.startsWith(item.href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 shrink-0 items-center rounded-t-control border border-b-0 border-window-dark-shadow px-3 font-mono text-xs font-bold pointer-coarse:h-11",
              active ? "bg-card text-window-text" : "bg-window-panel text-window-muted hover:bg-window-highlight hover:text-window-text",
            )}
            href={`${item.href}${suffix}`}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

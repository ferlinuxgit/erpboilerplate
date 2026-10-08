"use client";

import { ArrowSquareOut, MagnifyingGlass } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { matchScore, normalizeSearchText } from "@/components/layout/command-search";
import type { SettingsItem, SettingsSection } from "@/components/settings/settings-catalog";
import { Input } from "@/components/ui/input";

type Result = { item: SettingsItem; section: SettingsSection; score: number; order: number };

function searchSettings(sections: SettingsSection[], rawQuery: string): Result[] {
  const query = normalizeSearchText(rawQuery.trim());
  if (!query) return [];
  const results: Result[] = [];
  let order = 0;
  for (const section of sections) {
    for (const item of section.items) {
      const score = matchScore(
        { href: item.href, kind: "navigation", label: item.label, description: `${section.label} ${item.description}`, keywords: item.keywords },
        query,
      );
      if (score !== null) results.push({ item, section, score, order });
      order += 1;
    }
  }
  return results.sort((left, right) => left.score - right.score || left.order - right.order);
}

function ItemLink({ item, context }: { item: SettingsItem; context?: string }) {
  return (
    <Link
      className="group block px-2.5 py-1.5 outline-none hover:bg-window-highlight focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
      href={item.href}
    >
      <span className="flex items-center gap-1 font-mono text-xs font-bold text-link group-hover:underline">
        {item.label}
        {item.external ? <ArrowSquareOut aria-label="(en otro módulo)" className="size-3.5 shrink-0" /> : null}
      </span>
      <span className="block text-xs leading-4 text-muted-foreground">
        {context ? <span className="font-semibold text-foreground">{context} · </span> : null}
        {item.description}
      </span>
    </Link>
  );
}

/** Índice de Configuración: buscador sobre todos los ajustes y tarjetas por sección. */
export function SettingsIndex({ sections }: { sections: SettingsSection[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchSettings(sections, query), [sections, query]);
  const searching = query.trim().length > 0;

  return (
    <div className="space-y-3">
      <div className="relative max-w-xl" role="search">
        <label className="sr-only" htmlFor="settings-search">Buscar un ajuste</label>
        <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-controls="settings-results"
          autoComplete="off"
          className="pl-8"
          id="settings-search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
          placeholder="Busca un ajuste: IBAN, logo, serie, IVA, recordatorio…"
          type="search"
          value={query}
        />
      </div>

      <div aria-live="polite" id="settings-results">
        {searching ? (
          results.length > 0 ? (
            <div className="max-w-3xl divide-y divide-window-shadow overflow-hidden rounded-surface border border-window-dark-shadow bg-card shadow-raised">
              <p className="bg-window-panel px-2.5 py-1 font-mono text-xs text-muted-foreground">
                {results.length === 1 ? "1 ajuste" : `${results.length} ajustes`}
              </p>
              {results.map(({ item, section }) => <ItemLink context={section.label} item={item} key={`${section.id}-${item.href}-${item.label}`} />)}
            </div>
          ) : (
            <p className="max-w-3xl rounded-surface border border-window-dark-shadow bg-card px-3 py-2 text-sm text-muted-foreground">
              Ningún ajuste coincide con «{query.trim()}». Prueba con otra palabra (por ejemplo «banco», «numeración» o «impuestos»).
            </p>
          )
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sections.map((section) => (
              <section
                aria-labelledby={`settings-section-${section.id}`}
                className="overflow-hidden rounded-surface border border-window-dark-shadow bg-card shadow-raised"
                key={section.id}
              >
                <div className="border-b border-window-dark-shadow bg-window-panel px-2.5 py-1.5">
                  <h2 className="font-mono text-sm font-bold" id={`settings-section-${section.id}`}>
                    {section.href ? (
                      <Link className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" href={section.href}>
                        {section.label}
                      </Link>
                    ) : section.label}
                  </h2>
                  <p className="text-xs leading-4 text-muted-foreground">{section.description}</p>
                </div>
                <div className="divide-y divide-window-shadow">
                  {section.items.map((item) => <ItemLink item={item} key={`${item.href}-${item.label}`} />)}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

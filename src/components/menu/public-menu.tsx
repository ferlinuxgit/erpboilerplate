"use client";

import { CalendarCheck, Funnel, MagnifyingGlass, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ALLERGENS, matchesFilters, MENU_TAGS, MENU_TEXT, type MenuLang } from "@/modules/hospitality/menu";
import type { PublicMenu } from "@/server/pos/menu";

type Diet = "ALL" | "VEGETARIAN" | "VEGAN";

/** Carta en el móvil del cliente: secciones, buscador, filtro de alérgenos y dieta, ES/EN. */
export function PublicMenuView({ embed, lang, menu, tableId }: { embed: boolean; lang: MenuLang; menu: PublicMenu; tableId: string | null }) {
  const text = MENU_TEXT[lang];
  const [query, setQuery] = useState("");
  const [without, setWithout] = useState<string[]>([]);
  const [diet, setDiet] = useState<Diet>("ALL");
  const [showFilters, setShowFilters] = useState(false);
  const filtering = query.trim() !== "" || without.length > 0 || diet !== "ALL";
  const sections = menu.sections
    .map((section) => ({ ...section, dishes: section.dishes.filter((dish) => matchesFilters(dish, { without, diet, query })) }))
    .filter((section) => section.dishes.length > 0 || (!filtering && section.fixedPrice !== null));
  const money = (value: number) => formatMoney(value, menu.currency, lang === "en" ? "en-IE" : "es-ES");
  const langHref = (target: MenuLang) => `/carta/${menu.slug}?lang=${target}${tableId ? `&mesa=${encodeURIComponent(tableId)}` : ""}${embed ? "&embed=1" : ""}`;
  const allergenName = (id: string) => ALLERGENS.find((allergen) => allergen.id === id)?.[lang] ?? id;

  return (
    <div className="space-y-4" data-testid="public-menu" lang={lang}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-mono text-xl font-bold">{text.menu}</h1>
          {menu.tableName ? <p className="mt-0.5 inline-block bg-primary px-1.5 py-0.5 font-mono text-xs font-bold text-primary-foreground" data-testid="public-menu-table">{/^\d+$/.test(menu.tableName) ? `${text.table} ${menu.tableName}` : menu.tableName}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {menu.hasEnglish ? (
            <nav aria-label="Idioma / Language" className="flex border-2 border-window-dark-shadow font-mono text-xs font-bold">
              {(["es", "en"] as const).map((target) => (
                <Link aria-current={lang === target ? "true" : undefined} className={cn("grid h-10 w-11 place-items-center uppercase", lang === target ? "bg-primary text-primary-foreground" : "bg-window-panel")} href={langHref(target)} hrefLang={target} key={target} replace>{target}</Link>
              ))}
            </nav>
          ) : null}
          {menu.bookingSlug ? <Link className="inline-flex h-10 items-center gap-1.5 border-2 border-primary bg-primary px-3 font-mono text-xs font-bold text-primary-foreground" href={`/reservar/${menu.bookingSlug}`}><CalendarCheck aria-hidden="true" className="size-4" />{text.book}</Link> : null}
        </div>
      </div>
      {menu.intro ? <p className="whitespace-pre-line text-sm text-muted-foreground">{menu.intro}</p> : null}

      <div className="sticky top-0 z-10 -mx-3 space-y-2 border-b border-window-shadow bg-window-surface px-3 py-2 sm:-mx-5 sm:px-5">
        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{text.search}</span>
            <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-11 pl-8 text-base" data-testid="public-menu-search" onChange={(event) => setQuery(event.target.value)} placeholder={text.search} type="search" value={query} />
          </label>
          <button aria-expanded={showFilters} className={cn("flex h-11 items-center gap-1.5 border-2 px-3 font-mono text-sm font-bold", without.length > 0 || diet !== "ALL" ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} data-testid="public-menu-filters" onClick={() => setShowFilters((value) => !value)} type="button">
            <Funnel aria-hidden="true" className="size-4" />{text.filters}{without.length + (diet !== "ALL" ? 1 : 0) > 0 ? ` (${without.length + (diet !== "ALL" ? 1 : 0)})` : ""}
          </button>
        </div>
        {showFilters ? (
          <div className="space-y-2 border border-window-shadow bg-window-panel p-2" data-testid="public-menu-filter-panel">
            <fieldset>
              <legend className="mb-1 text-xs font-bold uppercase text-muted-foreground">{text.diet}</legend>
              <div className="flex flex-wrap gap-1">
                {([["ALL", text.all], ["VEGETARIAN", text.vegetarian], ["VEGAN", text.vegan]] as const).map(([value, label]) => (
                  <button aria-pressed={diet === value} className={cn("h-10 border-2 px-3 text-sm font-semibold", diet === value ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-surface")} key={value} onClick={() => setDiet(value)} type="button">{label}</button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-xs font-bold uppercase text-muted-foreground">{text.without}</legend>
              <div className="flex flex-wrap gap-1">
                {ALLERGENS.map((allergen) => {
                  const active = without.includes(allergen.id);
                  return <button aria-pressed={active} className={cn("h-10 border-2 px-2 text-sm", active ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-window-dark-shadow bg-window-surface")} data-testid={`public-menu-without-${allergen.id}`} key={allergen.id} onClick={() => setWithout((current) => (active ? current.filter((id) => id !== allergen.id) : [...current, allergen.id]))} type="button"><span aria-hidden="true">{allergen.icon}</span> {allergen[lang]}</button>;
                })}
              </div>
            </fieldset>
            {filtering ? <button className="flex h-10 items-center gap-1 text-sm font-semibold text-link underline" onClick={() => { setWithout([]); setDiet("ALL"); setQuery(""); }} type="button"><X aria-hidden="true" className="size-4" />{text.clear}</button> : null}
          </div>
        ) : null}
        {!filtering && menu.sections.length > 1 ? (
          <nav aria-label={text.sections} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]">
            {menu.sections.map((section) => <a className="shrink-0 border border-window-dark-shadow bg-window-panel px-2.5 py-1.5 font-mono text-xs font-bold" href={`#s-${section.id}`} key={section.id}>{section.name}</a>)}
          </nav>
        ) : null}
      </div>

      {sections.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground" role="status">{text.noResults}</p> : null}
      {sections.map((section) => (
        <section aria-labelledby={`h-${section.id}`} className="scroll-mt-32 space-y-2" id={`s-${section.id}`} key={section.id}>
          <div className={cn("border-b-2 border-window-dark-shadow pb-1", !section.availableNow && "opacity-70")}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <h2 className="font-mono text-lg font-black" id={`h-${section.id}`}>{section.name}</h2>
              {section.fixedPrice !== null ? <p className="font-mono text-lg font-black tabular-nums">{money(section.fixedPrice)} <span className="text-xs font-normal text-muted-foreground">{text.perPerson}</span></p> : null}
            </div>
            {section.schedule ? <p className="text-xs text-muted-foreground">{section.availableNow ? text.servedAt : text.notNow} · {section.schedule}</p> : null}
            {section.description ? <p className="mt-1 whitespace-pre-line text-sm">{section.description}</p> : null}
          </div>
          <ul className="divide-y divide-window-shadow">
            {section.dishes.map((dish) => (
              <li className={cn("flex gap-3 py-2.5", (dish.soldOut || !section.availableNow) && "opacity-60")} data-testid={`public-menu-dish-${dish.name}`} key={dish.id}>
                {dish.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- fotos propias servidas con caché larga
                  <img alt="" className="size-20 shrink-0 border border-window-dark-shadow object-cover" decoding="async" height={80} loading="lazy" src={dish.imageUrl} width={80} />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold leading-snug">
                      {dish.name}
                      {dish.tags.map((tag) => {
                        const info = MENU_TAGS.find((entry) => entry.id === tag);
                        return info ? <span className="ml-1 text-sm" key={tag} role="img" aria-label={info[lang]} title={info[lang]}>{info.icon}</span> : null;
                      })}
                    </h3>
                    {dish.soldOut ? <span className="shrink-0 bg-destructive px-1.5 py-0.5 font-mono text-xs font-bold uppercase text-destructive-foreground" data-testid="public-menu-sold-out">{text.soldOut}</span> : section.fixedPrice === null ? <span className="shrink-0 font-mono font-bold tabular-nums">{money(dish.price)}</span> : null}
                  </div>
                  {dish.description ? <p className="mt-0.5 text-sm text-muted-foreground">{dish.description}</p> : null}
                  {dish.allergens.length > 0 ? (
                    <p className="mt-1 flex flex-wrap gap-1" aria-label={`${text.allergens}: ${dish.allergens.map(allergenName).join(", ")}`}>
                      {dish.allergens.map((id) => {
                        const allergen = ALLERGENS.find((entry) => entry.id === id);
                        return allergen ? <span aria-hidden="true" className="border border-window-shadow bg-window-panel px-1 text-xs" key={id} title={allergen[lang]}>{allergen.icon} {allergen[lang]}</span> : null;
                      })}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <footer className="space-y-2 border-t border-window-shadow pt-3 text-xs text-muted-foreground">
        <p>{text.priceIncludesTax} {text.allergenInfo}</p>
        <details>
          <summary className="cursor-pointer font-semibold">{text.allergens}</summary>
          <ul className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
            {ALLERGENS.map((allergen) => <li key={allergen.id}><span aria-hidden="true">{allergen.icon}</span> {allergen[lang]}</li>)}
          </ul>
        </details>
      </footer>
    </div>
  );
}

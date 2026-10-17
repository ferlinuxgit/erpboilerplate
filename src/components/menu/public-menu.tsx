"use client";

import { CalendarCheck, MagnifyingGlass, ShieldCheck, Warning, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ALLERGENS, dishWarnings, matchesFilters, MENU_TAGS, MENU_TEXT, type MenuLang } from "@/modules/hospitality/menu";
import type { PublicMenu } from "@/server/pos/menu";

import { AllergenChip, AllergenIcon, AllergenLegend, AllergenMatrix, TagBadge } from "./allergen-icons";

type Diet = "ALL" | "VEGETARIAN" | "VEGAN";
type Preferences = { without: string[]; diet: Diet; hide: boolean };
const STORAGE_KEY = "menu-allergies";
const DEFAULT_PREFERENCES: Preferences = { without: [], diet: "ALL", hide: true };

/** Alergias y dieta del cliente, recordadas en su móvil para la próxima visita. */
function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Preferences> | null;
        if (saved) setPreferences({ ...DEFAULT_PREFERENCES, ...saved, without: (saved.without ?? []).filter((id) => ALLERGENS.some((allergen) => allergen.id === id)) });
      } catch {
        // Preferencias corruptas: se empieza de cero.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const update = (change: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...change };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };
  return [preferences, update] as const;
}

const DIET_TAGS: Record<Exclude<Diet, "ALL">, string> = { VEGETARIAN: "VEGETARIAN", VEGAN: "VEGAN" };

/** Carta en el móvil del cliente: secciones, buscador, alérgenos y dietas muy visuales, ES/EN. */
export function PublicMenuView({ embed, lang, menu, tableId }: { embed: boolean; lang: MenuLang; menu: PublicMenu; tableId: string | null }) {
  const text = MENU_TEXT[lang];
  const [query, setQuery] = useState("");
  const [{ without, diet, hide }, setPreferences] = usePreferences();
  const [showFilters, setShowFilters] = useState(false);
  const activeFilters = without.length + (diet !== "ALL" ? 1 : 0);
  const filtering = query.trim() !== "" || activeFilters > 0;
  const sections = menu.sections
    .map((section) => ({ ...section, dishes: section.dishes.filter((dish) => matchesFilters(dish, { without: hide ? without : [], diet, query })) }))
    .filter((section) => section.dishes.length > 0 || (!filtering && section.fixedPrice !== null));
  const money = (value: number) => formatMoney(value, menu.currency, lang === "en" ? "en-IE" : "es-ES");
  const langHref = (target: MenuLang) => `/carta/${menu.slug}?lang=${target}${tableId ? `&mesa=${encodeURIComponent(tableId)}` : ""}${embed ? "&embed=1" : ""}`;
  const allergenName = (id: string) => ALLERGENS.find((allergen) => allergen.id === id)?.[lang] ?? id;
  const allDishes = menu.sections.flatMap((section) => section.dishes.map((dish) => ({ ...dish, group: section.name })));

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
          <button aria-expanded={showFilters} className={cn("flex h-11 shrink-0 items-center gap-1.5 border-2 px-3 font-mono text-sm font-bold", activeFilters > 0 ? "border-destructive bg-destructive text-destructive-foreground" : "border-window-dark-shadow bg-window-panel")} data-testid="public-menu-filters" onClick={() => setShowFilters((value) => !value)} type="button">
            <ShieldCheck aria-hidden="true" className="size-5" weight="bold" /><span className="hidden min-[400px]:inline">{text.allergyQuestion}</span><span className="min-[400px]:hidden">{text.filters}</span>{activeFilters > 0 ? ` (${activeFilters})` : ""}
          </button>
        </div>

        {showFilters ? (
          <div className="space-y-3 border-2 border-window-dark-shadow bg-window-panel p-3" data-testid="public-menu-filter-panel">
            <p className="text-sm">{text.allergyHelp}</p>
            <fieldset>
              <legend className="mb-1.5 text-xs font-bold uppercase text-muted-foreground">{text.diet}</legend>
              <div className="grid grid-cols-3 gap-1.5">
                {([["ALL", text.all], ["VEGETARIAN", text.vegetarian], ["VEGAN", text.vegan]] as const).map(([value, label]) => {
                  const tag = value === "ALL" ? null : MENU_TAGS.find((entry) => entry.id === DIET_TAGS[value]);
                  const active = diet === value;
                  return (
                    <button aria-pressed={active} className={cn("flex h-12 items-center justify-center gap-1.5 rounded-full border-2 px-2 text-sm font-bold", active ? "text-white" : "border-window-dark-shadow bg-window-surface")} data-testid={`public-menu-diet-${value}`} key={value} onClick={() => setPreferences({ diet: value })} style={active ? { backgroundColor: tag?.color ?? "var(--color-primary)", borderColor: tag?.color ?? "var(--color-primary)" } : undefined} type="button">
                      {tag ? <TagBadge compact id={tag.id} lang={lang} /> : null}{label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-xs font-bold uppercase text-muted-foreground">{text.without}</legend>
              <div className="grid grid-cols-4 gap-1.5 min-[480px]:grid-cols-5 sm:grid-cols-7">
                {ALLERGENS.map((allergen) => {
                  const active = without.includes(allergen.id);
                  return (
                    <button aria-label={`${text.without.replace("…", "")} ${allergen[lang]}`} aria-pressed={active} className={cn("relative flex flex-col items-center gap-1 rounded-md border-2 px-0.5 py-1.5 text-center text-[11px] font-semibold leading-tight", active ? "border-destructive bg-destructive/10 text-destructive" : "border-transparent hover:border-window-shadow")} data-testid={`public-menu-without-${allergen.id}`} key={allergen.id} onClick={() => setPreferences({ without: active ? without.filter((id) => id !== allergen.id) : [...without, allergen.id] })} type="button">
                      <span className="relative">
                        <AllergenIcon decorative id={allergen.id} lang={lang} size="lg" variant={active ? "off" : "contains"} />
                        {active ? <span aria-hidden="true" className="absolute inset-0 rounded-full border-[3px] border-destructive after:absolute after:left-1/2 after:top-[-2px] after:h-[calc(100%+4px)] after:w-[3px] after:-translate-x-1/2 after:rotate-45 after:bg-destructive" /> : null}
                      </span>
                      {allergen[lang]}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm font-semibold"><input checked={hide} className="size-5" data-testid="public-menu-hide" onChange={(event) => setPreferences({ hide: event.target.checked })} type="checkbox" /> {text.hideConflicts}</label>
            {filtering ? <button className="flex h-10 items-center gap-1 text-sm font-semibold text-link underline" onClick={() => { setPreferences({ without: [], diet: "ALL" }); setQuery(""); }} type="button"><X aria-hidden="true" className="size-4" />{text.clear}</button> : null}
          </div>
        ) : activeFilters > 0 ? (
          <button className="flex w-full flex-wrap items-center gap-1.5 text-left text-xs font-semibold" onClick={() => setShowFilters(true)} type="button">
            {diet !== "ALL" ? <TagBadge id={DIET_TAGS[diet]} lang={lang} /> : null}
            {without.length > 0 ? <><span>{text.avoiding}:</span>{without.map((id) => <AllergenIcon id={id} key={id} lang={lang} size="sm" variant="off" />)}</> : null}
          </button>
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
          <ul className="space-y-2">
            {section.dishes.map((dish) => {
              const warnings = dishWarnings(dish, without);
              const blocked = warnings.contains.length > 0;
              const dietTags = dish.tags.filter((tag) => MENU_TAGS.find((entry) => entry.id === tag)?.diet);
              const otherTags = dish.tags.filter((tag) => !MENU_TAGS.find((entry) => entry.id === tag)?.diet);
              return (
                <li className={cn("flex gap-3 border-l-4 py-2 pl-2", blocked ? "border-destructive bg-destructive/5" : warnings.traces.length > 0 || (!dish.reviewed && without.length > 0) ? "border-warning" : "border-transparent", (dish.soldOut || !section.availableNow) && "opacity-60")} data-testid={`public-menu-dish-${dish.name}`} key={dish.id}>
                  {dish.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- fotos propias servidas con caché larga
                    <img alt="" className="size-20 shrink-0 border border-window-dark-shadow object-cover sm:size-24" decoding="async" height={96} loading="lazy" src={dish.imageUrl} width={96} />
                  ) : null}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="flex flex-wrap items-center gap-1 font-semibold leading-snug">
                        {dish.name}
                        {otherTags.map((tag) => <TagBadge compact id={tag} key={tag} lang={lang} />)}
                      </h3>
                      {dish.soldOut ? <span className="shrink-0 bg-destructive px-1.5 py-0.5 font-mono text-xs font-bold uppercase text-destructive-foreground" data-testid="public-menu-sold-out">{text.soldOut}</span> : section.fixedPrice === null ? <span className="shrink-0 font-mono font-bold tabular-nums">{money(dish.price)}</span> : null}
                    </div>
                    {dietTags.length > 0 ? <p className="flex flex-wrap gap-1">{dietTags.map((tag) => <TagBadge id={tag} key={tag} lang={lang} />)}</p> : null}
                    {dish.description ? <p className="text-sm text-muted-foreground">{dish.description}</p> : null}
                    {blocked ? <p className="flex items-center gap-1 text-sm font-bold text-destructive" data-testid="public-menu-warning"><Warning aria-hidden="true" className="size-4 shrink-0" weight="fill" />{text.contains}: {warnings.contains.map(allergenName).join(", ")}</p> : null}
                    {warnings.traces.length > 0 ? <p className="flex items-center gap-1 text-sm font-semibold text-warning-text"><Warning aria-hidden="true" className="size-4 shrink-0" />{text.mayContain}: {warnings.traces.map(allergenName).join(", ")}</p> : null}
                    {dish.reviewed ? (
                      dish.allergens.length > 0 || dish.traces.length > 0 ? (
                        <p aria-label={`${text.allergens}: ${dish.allergens.map(allergenName).join(", ")}${dish.traces.length > 0 ? `. ${text.mayContain}: ${dish.traces.map(allergenName).join(", ")}` : ""}`} className="flex flex-wrap gap-1">
                          {dish.allergens.map((id) => <AllergenChip id={id} key={id} lang={lang} />)}
                          {dish.traces.map((id) => <AllergenChip id={id} key={`t-${id}`} lang={lang} variant="traces" />)}
                        </p>
                      ) : <p className="text-xs text-muted-foreground">{text.noAllergens}</p>
                    ) : <p className="inline-flex items-center gap-1 rounded-full border border-warning px-2 py-0.5 text-xs font-semibold text-warning-text"><Warning aria-hidden="true" className="size-3.5" />{text.askAllergens}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <footer className="space-y-3 border-t border-window-shadow pt-3 text-xs text-muted-foreground">
        <p>{text.priceIncludesTax} {text.allergenInfo}</p>
        <details className="text-window-text">
          <summary className="cursor-pointer text-sm font-semibold">{text.allergens}</summary>
          <div className="mt-2 space-y-2">
            <AllergenLegend lang={lang} />
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><AllergenIcon decorative id="SESAME" lang={lang} size="sm" variant="traces" />{text.tracesHelp}</p>
          </div>
        </details>
        {allDishes.length > 0 ? (
          <details className="text-window-text">
            <summary className="cursor-pointer text-sm font-semibold">{text.allergenTable}</summary>
            <div className="mt-2"><AllergenMatrix dishes={allDishes} lang={lang} /></div>
          </details>
        ) : null}
      </footer>
    </div>
  );
}

import { Acorn, Carrot, Drop, DropSlash, Egg, FishSimple, Flower, Grains, GrainsSlash, JarLabel, Leaf, Pepper, Plant, Shrimp, Sparkle, Spiral, Star } from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { useId, type SVGProps } from "react";

import { cn } from "@/lib/utils";
import { ALLERGENS, MENU_TAGS, type MenuLang } from "@/modules/hospitality/menu";

/*
 * Iconos de alérgenos y dietas dibujados igual en todos los móviles (los emojis cambian según el
 * sistema). Cada alérgeno tiene su color; «trazas» se dibuja con el borde discontinuo.
 */

type Glyph = (props: SVGProps<SVGSVGElement>) => React.ReactElement;

// Pictogramas propios donde la librería no tiene uno claro.
const Peanut: Glyph = (props) => <PeanutSvg {...props} />;
function PeanutSvg(props: SVGProps<SVGSVGElement>) {
  // Id único por icono: una máscara dentro de un bloque oculto no serviría a los demás.
  const maskId = useId();
  return (
  <svg viewBox="0 0 256 256" {...props}>
    <mask id={maskId}>
      <rect fill="white" height="256" width="256" />
      <path d="M84 132l20 20M116 100l20 20M148 68l20 20M92 172l12 12M156 108l12 12" stroke="black" strokeLinecap="round" strokeWidth="12" />
    </mask>
    <g fill="currentColor" mask={`url(#${maskId})`}>
      <circle cx="98" cy="160" r="62" />
      <circle cx="162" cy="96" r="56" />
      <path d="M70 130 126 186 190 122 134 66Z" />
    </g>
  </svg>
  );
}
const Soy: Glyph = (props) => (
  <svg viewBox="0 0 256 256" {...props}>
    <path d="M36 212c18-86 82-150 184-172-10 96-72 160-184 172Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="16" />
    <ellipse cx="88" cy="168" fill="currentColor" rx="20" ry="16" transform="rotate(-40 88 168)" />
    <ellipse cx="128" cy="126" fill="currentColor" rx="20" ry="16" transform="rotate(-40 128 126)" />
    <ellipse cx="170" cy="86" fill="currentColor" rx="20" ry="16" transform="rotate(-40 170 86)" />
  </svg>
);
const Sesame: Glyph = (props) => (
  <svg fill="currentColor" viewBox="0 0 256 256" {...props}>
    <path d="M88 52c22 18 26 52 8 72s-44 6-50-22 18-66 42-50Z" />
    <path d="M176 76c26 6 40 36 28 60s-42 22-50-6 0-60 22-54Z" />
    <path d="M110 150c24 10 34 40 20 62s-44 14-50-14 6-58 30-48Z" />
  </svg>
);
const Sulphites: Glyph = (props) => (
  <svg viewBox="0 0 256 256" {...props}>
    <text fill="currentColor" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="104" fontWeight="800" textAnchor="middle" x="122" y="164">SO</text>
    <text fill="currentColor" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="64" fontWeight="800" x="196" y="196">2</text>
  </svg>
);

const fromPhosphor = (Component: Icon): Glyph => {
  const Wrapped: Glyph = ({ className }) => <Component className={className} weight="bold" />;
  return Wrapped;
};

const ALLERGEN_GLYPHS: Record<string, Glyph> = {
  GLUTEN: fromPhosphor(Grains),
  CRUSTACEANS: fromPhosphor(Shrimp),
  EGGS: fromPhosphor(Egg),
  FISH: fromPhosphor(FishSimple),
  PEANUTS: Peanut,
  SOY: Soy,
  MILK: fromPhosphor(Drop),
  NUTS: fromPhosphor(Acorn),
  CELERY: fromPhosphor(Plant),
  MUSTARD: fromPhosphor(JarLabel),
  SESAME: Sesame,
  SULPHITES: Sulphites,
  LUPIN: fromPhosphor(Flower),
  MOLLUSCS: fromPhosphor(Spiral),
};

const TAG_GLYPHS: Record<string, Icon> = { VEGAN: Leaf, VEGETARIAN: Carrot, GLUTEN_FREE: GrainsSlash, LACTOSE_FREE: DropSlash, SPICY: Pepper, RECOMMENDED: Star, NEW: Sparkle };

const SIZES = { sm: "size-6 p-1", md: "size-8 p-1.5", lg: "size-12 p-2.5", xl: "size-14 p-3" } as const;

export type AllergenVariant = "contains" | "traces" | "off";

/** Círculo de color con el pictograma del alérgeno. */
export function AllergenIcon({ id, lang = "es", size = "md", variant = "contains", decorative = false, className }: { id: string; lang?: MenuLang; size?: keyof typeof SIZES; variant?: AllergenVariant; decorative?: boolean; className?: string }) {
  const allergen = ALLERGENS.find((entry) => entry.id === id);
  const Glyph = ALLERGEN_GLYPHS[id];
  if (!allergen || !Glyph) return null;
  const label = variant === "traces" ? `${allergen[lang]} (${lang === "en" ? "traces" : "trazas"})` : allergen[lang];
  return (
    <span
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      className={cn("inline-grid shrink-0 place-items-center rounded-full", SIZES[size], variant === "contains" && "text-white", variant === "traces" && "border-2 border-dashed bg-white", variant === "off" && "bg-window-panel text-window-muted", className)}
      role={decorative ? undefined : "img"}
      style={variant === "contains" ? { backgroundColor: allergen.color } : variant === "traces" ? { borderColor: allergen.color, color: allergen.color } : undefined}
      title={label}
    >
      <Glyph className="size-full" />
    </span>
  );
}

/** Icono + nombre, para la ficha del plato. */
export function AllergenChip({ id, lang = "es", variant = "contains" }: { id: string; lang?: MenuLang; variant?: "contains" | "traces" }) {
  const allergen = ALLERGENS.find((entry) => entry.id === id);
  if (!allergen) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-xs font-semibold", variant === "traces" ? "border border-dashed" : "border")} style={{ borderColor: allergen.color, color: variant === "traces" ? allergen.color : undefined }}>
      <AllergenIcon decorative id={id} lang={lang} size="sm" variant={variant} />
      <span>{allergen[lang]}{variant === "traces" ? ` · ${lang === "en" ? "traces" : "trazas"}` : ""}</span>
    </span>
  );
}

/** Distintivo de dieta o destacado (vegano, apto celíacos, picante…). */
export function TagBadge({ id, lang = "es", compact = false }: { id: string; lang?: MenuLang; compact?: boolean }) {
  const tag = MENU_TAGS.find((entry) => entry.id === id);
  const Glyph = TAG_GLYPHS[id];
  if (!tag || !Glyph) return null;
  if (compact) {
    return (
      <span aria-label={tag[lang]} className="inline-grid size-6 shrink-0 place-items-center rounded-full p-1 text-white" role="img" style={{ backgroundColor: tag.color }} title={tag[lang]}>
        <Glyph className="size-full" weight="bold" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full py-0.5 pl-1 pr-2 text-xs font-bold text-white" style={{ backgroundColor: tag.color }}>
      <Glyph aria-hidden="true" className="size-3.5" weight="bold" />
      {tag[lang]}
    </span>
  );
}

/** Leyenda con los 14 alérgenos. */
export function AllergenLegend({ lang = "es" }: { lang?: MenuLang }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
      {ALLERGENS.map((allergen) => (
        <li className="flex items-center gap-2 text-sm" key={allergen.id}>
          <AllergenIcon decorative id={allergen.id} lang={lang} size="md" />
          {allergen[lang]}
        </li>
      ))}
    </ul>
  );
}

/** Tabla de alérgenos (platos × 14 alérgenos): ● contiene, T trazas. */
export function AllergenMatrix({ dishes, lang = "es", printable = false }: { dishes: Array<{ id: string; name: string; group?: string | null; allergens: readonly string[]; traces: readonly string[]; reviewed: boolean }>; lang?: MenuLang; printable?: boolean }) {
  const groups = [...new Set(dishes.map((dish) => dish.group ?? ""))];
  const dishLabel = lang === "en" ? "Dish" : "Plato";
  return (
    <div className={cn(!printable && "overflow-x-auto")}>
      <table className={cn("w-full border-collapse text-xs", printable ? "text-[11px]" : "min-w-[44rem]")} data-testid="allergen-matrix">
        <thead>
          <tr>
            <th className="sticky left-0 bg-window-surface p-1 text-left align-bottom font-mono print:bg-white" scope="col">{dishLabel}</th>
            {ALLERGENS.map((allergen) => (
              <th className="w-9 p-0.5 align-bottom" key={allergen.id} scope="col">
                <span className="flex flex-col items-center gap-1">
                  <AllergenIcon decorative id={allergen.id} lang={lang} size="sm" />
                  <span className="text-[11px] font-semibold leading-tight [writing-mode:vertical-rl] rotate-180">{allergen[lang]}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <MatrixGroup dishes={dishes.filter((dish) => (dish.group ?? "") === group)} group={group} key={group || "none"} lang={lang} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixGroup({ dishes, group, lang }: { dishes: Array<{ id: string; name: string; allergens: readonly string[]; traces: readonly string[]; reviewed: boolean }>; group: string; lang: MenuLang }) {
  return (
    <>
      {group ? <tr><th className="border-b-2 border-window-dark-shadow bg-window-panel p-1 text-left font-mono print:bg-neutral-100" colSpan={15} scope="colgroup">{group}</th></tr> : null}
      {dishes.map((dish) => (
        <tr className="border-b border-window-shadow" key={dish.id}>
          <th className="sticky left-0 bg-window-surface p-1 text-left font-semibold print:bg-white" scope="row">{dish.name}{dish.reviewed ? null : <span className="ml-1 font-normal text-warning-text">({lang === "en" ? "ask" : "consultar"})</span>}</th>
          {ALLERGENS.map((allergen) => {
            const contains = dish.allergens.includes(allergen.id);
            const traces = !contains && dish.traces.includes(allergen.id);
            return (
              <td className="p-0.5 text-center" key={allergen.id}>
                {contains ? <span aria-label={`${allergen[lang]}`} className="inline-block size-4 rounded-full" role="img" style={{ backgroundColor: allergen.color }} /> : traces ? <span aria-label={`${allergen[lang]} (${lang === "en" ? "traces" : "trazas"})`} className="inline-grid size-4 place-items-center rounded-full border-2 border-dashed text-[11px] font-black leading-none" role="img" style={{ borderColor: allergen.color, color: allergen.color }}>T</span> : null}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

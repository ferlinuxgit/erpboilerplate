import type { Icon } from "@phosphor-icons/react";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type AreaLinkProps = {
  href: string;
  title: string;
  description?: ReactNode;
  /** Texto pequeño sobre el título (p. ej. el módulo de una acción frecuente). */
  eyebrow?: string;
  icon?: Icon;
  /** Nivel del título: h3 dentro de una PageSection; "span" si no debe ser un encabezado. */
  titleAs?: "h3" | "span";
  className?: string;
  testId?: string;
};

/**
 * Acceso a un área o espacio de trabajo de un módulo ("Áreas de tesorería", "Acciones
 * frecuentes"…). Botón retro en relieve, objetivo táctil ≥ 44px y foco visible.
 */
export function AreaLink({ className, description, eyebrow, href, icon: AreaIcon, testId, title, titleAs: Title = "h3" }: AreaLinkProps) {
  return (
    <Link
      className={cn(
        "group flex min-h-11 items-start gap-2 rounded-surface border border-window-dark-shadow bg-card px-2.5 py-2 text-card-foreground shadow-raised outline-none",
        "hover:bg-window-highlight active:shadow-pressed focus-visible:ring-2 focus-visible:ring-focus",
        className,
      )}
      data-testid={testId}
      href={href}
    >
      {AreaIcon ? (
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-control border border-window-dark-shadow bg-window-panel text-window-text shadow-sunken">
          <AreaIcon className="size-4" />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="font-mono text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">{eyebrow}</p> : null}
        <Title className="block font-mono text-sm font-bold leading-snug text-link">{title}</Title>
        {description ? <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{description}</p> : null}
      </div>
      <ArrowRight
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-window-muted motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-snappy motion-safe:pointer-fine:group-hover:translate-x-0.5"
      />
    </Link>
  );
}

/** Rejilla de AreaLink: una columna en móvil y varias según el ancho. */
export function AreaLinkGrid({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <div className={cn("grid gap-2 sm:grid-cols-2 xl:grid-cols-4", className)} data-testid={testId}>
      {children}
    </div>
  );
}

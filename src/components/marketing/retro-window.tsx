import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type RetroWindowProps = {
  /** Texto de la barra de título. */
  title: ReactNode;
  children: ReactNode;
  /** Elemento extra a la derecha de la barra (p. ej. una etiqueta). */
  titleAside?: ReactNode;
  /** «raised»: ventana normal; «featured»: con la sombra grande para destacarla. */
  elevation?: "raised" | "featured";
  className?: string;
  bodyClassName?: string;
  as?: "div" | "article" | "section" | "figure";
};

/**
 * Ventana retro del design system: barra de título del color del tema, borde oscuro, relieve
 * biselado y sombra sólida. Los tres botones de la barra son decorativos (no hacen nada).
 */
export function RetroWindow({ title, children, titleAside, elevation = "raised", className, bodyClassName, as: Tag = "div" }: RetroWindowProps) {
  return (
    <Tag className={cn("flex min-w-0 flex-col overflow-hidden rounded-surface border border-window-dark-shadow bg-window-surface text-window-text", elevation === "featured" ? "shadow-window-lg" : "shadow-window", className)}>
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-window-dark-shadow bg-chrome-active px-2 text-chrome-active-foreground">
        <span className="truncate font-mono text-xs font-bold">{title}</span>
        <span className="flex items-center gap-1.5">
          {titleAside}
          <span aria-hidden="true" className="flex gap-0.5">
            {[0, 1, 2].map((index) => (
              <span className="size-4 border border-window-dark-shadow bg-window-surface shadow-raised" key={index} />
            ))}
          </span>
        </span>
      </div>
      <div className={cn("flex-1 p-3 sm:p-4", bodyClassName)}>{children}</div>
    </Tag>
  );
}

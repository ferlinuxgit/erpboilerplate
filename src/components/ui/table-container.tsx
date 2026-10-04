"use client";

import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";

import { cn } from "@/lib/utils";

type TableContainerProps = ComponentProps<"div"> & {
  /** Nombre accesible de la zona desplazable (solo se anuncia cuando hay desbordamiento). */
  label?: string;
  /** Clases del elemento que hace scroll (p. ej. `max-h-96 overflow-y-auto` con cabecera fija). */
  scrollClassName?: string;
};

/**
 * Marco único de las tablas: borde, fondo y scroll horizontal con aviso visible.
 * Cuando la tabla no cabe, el borde por el que queda contenido se difumina con el color
 * de la tarjeta y muestra un cursor (‹ ›), así funciona igual en los 8 temas y en iOS,
 * donde la barra de desplazamiento no se ve hasta que se toca.
 */
export function TableContainer({ children, className, label = "Tabla con desplazamiento horizontal", scrollClassName, ...props }: TableContainerProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const { clientWidth, scrollLeft, scrollWidth } = scroller;
    const start = scrollLeft > 1;
    const end = scrollLeft + clientWidth < scrollWidth - 1;
    setEdges((current) => (current.start === start && current.end === end ? current : { start, end }));
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);

  const overflows = edges.start || edges.end;

  return (
    <div className={cn("relative min-w-0 rounded-surface border border-window-dark-shadow bg-card", className)} {...props}>
      <div
        aria-label={overflows ? label : undefined}
        className={cn("overflow-x-auto rounded-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus", scrollClassName)}
        onScroll={measure}
        ref={scrollerRef}
        role={overflows ? "region" : undefined}
        // Con teclado hay que poder enfocar la zona para desplazarla con las flechas.
        tabIndex={overflows ? 0 : undefined}
      >
        {children}
      </div>
      <ScrollEdge side="start" visible={edges.start} />
      <ScrollEdge side="end" visible={edges.end} />
    </div>
  );
}

function ScrollEdge({ side, visible }: { side: "start" | "end"; visible: boolean }) {
  const Icon = side === "start" ? CaretLeft : CaretRight;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-y-0 flex w-8 items-start pt-2 text-window-muted opacity-0 transition-opacity duration-150",
        side === "start" ? "left-0 justify-start rounded-l-surface bg-linear-to-r pl-0.5" : "right-0 justify-end rounded-r-surface bg-linear-to-l pr-0.5",
        "from-card via-card/80 to-transparent",
        visible && "opacity-100",
      )}
    >
      <Icon className="size-4" weight="bold" />
    </div>
  );
}

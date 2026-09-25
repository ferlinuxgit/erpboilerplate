"use client";

import { Question } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { getGlossaryEntry, GLOSSARY_HREF, type GlossaryTermId } from "@/components/help/glossary";
import { cn } from "@/lib/utils";

type HelpTermProps = {
  /** Término del glosario (p. ej. "555", "303", "prorrata"). */
  term: GlossaryTermId;
  /** Texto visible; por defecto, el nombre del término. */
  children?: ReactNode;
  className?: string;
};

/**
 * Término con ayuda contextual: el texto va seguido de un botón "?" que despliega la definición
 * en lenguaje llano y un enlace al glosario completo. Se cierra con Escape o al salir el foco.
 */
export function HelpTerm({ children, className, term }: HelpTermProps) {
  const entry = getGlossaryEntry(term);
  const [open, setOpen] = useState(false);
  // Posición fija calculada al abrir: el panel no queda recortado por contenedores con overflow oculto.
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const panelId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(288, window.innerWidth - 16);
      setPosition({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) });
    }
    setOpen(true);
  }

  return (
    <span
      className={cn("relative inline-flex items-baseline gap-0.5", className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
      ref={wrapperRef}
    >
      <span>{children ?? entry.term}</span>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={`¿Qué es ${entry.term}?`}
        className="inline-grid size-4 translate-y-0.5 place-items-center rounded-[1px] border border-window-dark-shadow bg-window-surface text-window-text hover:bg-window-highlight"
        data-help-term={entry.id}
        onClick={toggle}
        ref={buttonRef}
        type="button"
      >
        <Question aria-hidden="true" className="size-3" weight="bold" />
      </button>
      {open ? (
        <span
          className="fixed z-50 block w-72 max-w-[calc(100vw-1rem)] rounded-[2px] border border-window-dark-shadow bg-popover p-2 text-left font-sans text-xs font-normal normal-case leading-4 tracking-normal text-popover-foreground shadow-[3px_3px_0_var(--window-shadow)]"
          id={panelId}
          role="note"
          style={position ? { top: position.top, left: position.left } : undefined}
        >
          <span className="mb-1 block font-mono font-bold">{entry.term}</span>
          <span className="block">{entry.short}</span>
          <Link className="link mt-1.5 block" href={`${GLOSSARY_HREF}#${entry.id}`}>
            Ver en el glosario
          </Link>
        </span>
      ) : null}
    </span>
  );
}

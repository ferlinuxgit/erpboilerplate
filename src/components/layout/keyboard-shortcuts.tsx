"use client";

import { Keyboard } from "@phosphor-icons/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { readKeyboardPreferences, setKeyboardPreference, useKeyboardPreferences } from "@/components/layout/keyboard-preferences";
import { navigationLinks } from "@/components/layout/navigation-config";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const OPEN_KEYBOARD_HELP_EVENT = "erp:open-keyboard-help";
const navigationByCode = new Map<string, string>(navigationLinks.map((link) => [link.code, link.href]));

const shortcutGroups = [
  {
    label: "Navegación global",
    shortcuts: [
      ["F1 / ?", "Abrir esta ayuda (? es de una sola tecla)"],
      ["Ctrl K / /", "Abrir la búsqueda global (/ es de una sola tecla)"],
      ["F6", "Ir a la siguiente zona de la interfaz"],
      ["Mayús F6", "Ir a la zona anterior"],
      ["G + código", "Abrir un módulo por su código de dos cifras; por ejemplo G 1 0 abre Clientes"],
    ],
  },
  {
    label: "Acceso directo",
    shortcuts: [
      ["Alt Mayús 1", "Navegación principal"],
      ["Alt Mayús 2", "Pestañas de la sección"],
      ["Alt Mayús 3", "Contenido de la página"],
      ["Alt Mayús 4", "Selector de empresa"],
      ["Alt F", "Buscar en el primer listado visible"],
      ["Alt L", "Añadir una línea en facturas, presupuestos y pedidos"],
      ["Alt N", "Crear cliente sin salir de la factura"],
    ],
  },
  {
    label: "Controles y formularios",
    shortcuts: [
      ["↑ ↓", "Moverse por menús, resultados y filas"],
      ["← →", "Moverse por pestañas de sección"],
      ["Inicio / Fin", "Ir al primer o último elemento"],
      ["Enter", "Abrir el elemento enfocado"],
      ["Espacio", "Seleccionar una fila cuando está permitido"],
      ["Av Pág / Re Pág", "Página siguiente o anterior de un listado"],
      ["Ctrl Enter", "Enviar el formulario activo"],
      ["Esc", "Cerrar ventanas o limpiar una búsqueda local"],
    ],
  },
] as const;

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    target.matches("input, textarea, select, [role='textbox']")
  );
}

function isVisible(element: HTMLElement | null): element is HTMLElement {
  return Boolean(element && element.getClientRects().length > 0);
}

function focusElement(element: HTMLElement | null) {
  if (!isVisible(element)) return false;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

function focusFirstIn(containerSelector: string, itemSelector: string) {
  const container = document.querySelector<HTMLElement>(containerSelector);
  if (!isVisible(container)) return false;
  const active = container.querySelector<HTMLElement>("[aria-current='page']");
  return focusElement(active) || focusElement(container.querySelector<HTMLElement>(itemSelector));
}

export function openKeyboardHelp() {
  window.dispatchEvent(new Event(OPEN_KEYBOARD_HELP_EVENT));
}

export function KeyboardHelpButton({ className, compact = false, onOpen }: { className?: string; compact?: boolean; onOpen?: () => void }) {
  return (
    <Button
      aria-keyshortcuts="F1"
      className={cn(compact ? "h-6 px-1.5 text-[0.58rem]" : "w-full", className)}
      onClick={() => {
        onOpen?.();
        openKeyboardHelp();
      }}
      size={compact ? "xs" : "sm"}
      type="button"
      variant="ghost"
    >
      <Keyboard aria-hidden="true" />
      {compact ? "F1 AYUDA" : "Atajos de teclado"}
    </Button>
  );
}

function PreferenceToggle({ checked, description, id, label, onChange }: { checked: boolean; description: string; id: string; label: string; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-start gap-2">
      <input
        aria-describedby={`${id}-description`}
        checked={checked}
        className="mt-0.5 size-4 accent-[var(--primary)]"
        id={id}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <div>
        <label className="font-mono text-xs font-bold" htmlFor={id}>{label}</label>
        <p className="text-xs text-window-muted" id={`${id}-description`}>{description}</p>
      </div>
    </div>
  );
}

export function KeyboardShortcuts() {
  const pathname = usePathname();
  const preferences = useKeyboardPreferences();
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const [sequenceStatus, setSequenceStatus] = useState("");
  const sequenceRef = useRef("");
  const sequenceTimerRef = useRef<number | null>(null);
  const previousPathRef = useRef(pathname);

  useEffect(() => {
    if (previousPathRef.current === pathname) return;
    previousPathRef.current = pathname;
    const frame = requestAnimationFrame(() => document.getElementById("main-content")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  useEffect(() => {
    const clearSequence = () => {
      sequenceRef.current = "";
      setSequenceStatus("");
      if (sequenceTimerRef.current !== null) window.clearTimeout(sequenceTimerRef.current);
      sequenceTimerRef.current = null;
    };

    const startSequence = () => {
      sequenceRef.current = "g";
      setSequenceStatus("Navegación por código: escribe los dos dígitos del módulo.");
      if (sequenceTimerRef.current !== null) window.clearTimeout(sequenceTimerRef.current);
      sequenceTimerRef.current = window.setTimeout(clearSequence, 2_500);
    };

    const focusPrimaryNavigation = () => {
      if (focusFirstIn("#primary-navigation", "a[href]") || focusFirstIn("#mobile-primary-navigation", "a[href]")) return;
      const mobileMenuButton = document.querySelector<HTMLButtonElement>("button[aria-label='Abrir navegación']");
      if (!isVisible(mobileMenuButton)) return;
      mobileMenuButton.click();
      window.setTimeout(() => focusFirstIn("#mobile-primary-navigation", "a[href]"), 0);
    };

    const focusContextNavigation = () => {
      if (!focusFirstIn("#context-navigation", "a[href]")) focusElement(document.getElementById("main-content"));
    };

    const focusPageActions = () => {
      const actions = document.querySelector<HTMLElement>("[aria-label='Acciones de la página']");
      return isVisible(actions) && focusElement(actions.querySelector<HTMLElement>("a[href], button:not([disabled])"));
    };

    const getFocusZones = () => [
      {
        container: Array.from(document.querySelectorAll<HTMLElement>("#primary-navigation, #mobile-primary-navigation")).find(isVisible) ?? null,
        focus: focusPrimaryNavigation,
      },
      {
        container: document.querySelector<HTMLElement>("#context-navigation"),
        focus: focusContextNavigation,
      },
      {
        container: document.querySelector<HTMLElement>("[aria-label='Acciones de la página']"),
        focus: focusPageActions,
      },
      {
        container: document.getElementById("main-content"),
        focus: () => focusElement(document.getElementById("main-content")),
      },
    ].filter((zone) => isVisible(zone.container));

    const cycleFocusZone = (reverse: boolean) => {
      const zones = getFocusZones();
      if (zones.length === 0) return;
      const currentIndex = zones.findIndex((zone) => zone.container?.contains(document.activeElement));
      const offset = reverse ? -1 : 1;
      const nextIndex = currentIndex < 0
        ? reverse ? zones.length - 1 : 0
        : (currentIndex + offset + zones.length) % zones.length;
      zones[nextIndex]?.focus();
    };

    const onOpenHelp = () => setHelpOpen(true);
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLocaleLowerCase();
      const editable = isEditableTarget(event.target);

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        const form = event.target instanceof Element ? event.target.closest("form") : null;
        if (form instanceof HTMLFormElement) {
          event.preventDefault();
          // requestSubmit() ignores a disabled submit button, so honour the
          // pending state forms expose to avoid double submissions.
          const submitter = form.querySelector<HTMLButtonElement | HTMLInputElement>("button[type='submit'], input[type='submit'], button:not([type])");
          const busy = form.getAttribute("aria-busy") === "true" || submitter?.disabled || submitter?.getAttribute("aria-busy") === "true";
          if (!busy) form.requestSubmit();
        }
        return;
      }

      // "?", "/" y "g" son atajos de una sola tecla: se pueden desactivar (WCAG 2.1.4).
      const singleKeyShortcuts = readKeyboardPreferences().singleKeyShortcuts;

      if (event.key === "F1" || (!editable && singleKeyShortcuts && event.key === "?")) {
        event.preventDefault();
        const activeModal = document.querySelector<HTMLElement>("[role='dialog'][aria-modal='true']");
        if (activeModal?.id === "mobile-navigation-drawer") {
          activeModal.querySelector<HTMLButtonElement>("button[aria-label='Cerrar navegación']")?.click();
          window.setTimeout(() => setHelpOpen(true), 0);
        } else if (!activeModal) {
          setHelpOpen(true);
        }
        return;
      }

      if (document.querySelector("[role='dialog'][aria-modal='true']")) return;

      if (event.key === "F6") {
        event.preventDefault();
        cycleFocusZone(event.shiftKey);
        return;
      }

      // Alt+Shift+digit: plain Alt+digit switches browser tabs on Linux and
      // Windows. event.code keeps it layout-independent (Shift+1 = "!").
      const zoneDigit = event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey ? /^Digit([1-4])$/.exec(event.code)?.[1] : undefined;
      if (zoneDigit) {
        if (zoneDigit === "1") {
          event.preventDefault();
          focusPrimaryNavigation();
        } else if (zoneDigit === "2") {
          event.preventDefault();
          focusContextNavigation();
        } else if (zoneDigit === "3") {
          event.preventDefault();
          focusElement(document.getElementById("main-content"));
        } else {
          const companySelect = document.querySelector<HTMLElement>("[aria-label='Empresa y ejercicio activos']");
          if (focusElement(companySelect)) event.preventDefault();
        }
        return;
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (key === "f" || event.code === "KeyF") {
          const resourceSearch = Array.from(document.querySelectorAll<HTMLElement>("[data-resource-search]"))
            .find(isVisible);
          if (focusElement(resourceSearch ?? null)) event.preventDefault();
        }
        return;
      }

      if (editable || event.ctrlKey || event.metaKey || event.altKey || !singleKeyShortcuts) return;

      if (sequenceRef.current.startsWith("g")) {
        if (event.key === "Escape") {
          event.preventDefault();
          clearSequence();
          return;
        }
        if (/^\d$/.test(event.key)) {
          event.preventDefault();
          sequenceRef.current += event.key;
          const code = sequenceRef.current.slice(1);
          setSequenceStatus(code.length === 1 ? `Código ${code}_: falta un dígito.` : `Abriendo módulo ${code}.`);
          if (code.length === 2) {
            const href = navigationByCode.get(code);
            clearSequence();
            if (href) router.push(href);
            else {
              setSequenceStatus(`El código ${code} no existe.`);
              sequenceTimerRef.current = window.setTimeout(() => setSequenceStatus(""), 2_000);
            }
          }
          return;
        }
        clearSequence();
      }

      if (key === "g") {
        event.preventDefault();
        startSequence();
      }
    };

    window.addEventListener(OPEN_KEYBOARD_HELP_EVENT, onOpenHelp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(OPEN_KEYBOARD_HELP_EVENT, onOpenHelp);
      window.removeEventListener("keydown", onKeyDown);
      if (sequenceTimerRef.current !== null) window.clearTimeout(sequenceTimerRef.current);
    };
  }, [router]);

  return (
    <>
      <p
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed bottom-2 left-1/2 z-50 -translate-x-1/2 border border-window-dark-shadow bg-window-panel px-3 py-1.5 font-mono text-xs font-bold text-window-text shadow-[inset_1px_1px_0_var(--window-highlight),4px_4px_0_rgba(0,0,0,0.3)]",
          !sequenceStatus && "sr-only",
        )}
        role="status"
      >
        {sequenceStatus}
      </p>
      <Dialog
        description="Todo se puede hacer sin ratón. Activa el modo teclado para ver los códigos de cada módulo en el menú."
        onClose={() => setHelpOpen(false)}
        open={helpOpen}
        size="lg"
        title="Atajos de teclado"
      >
        <section aria-labelledby="keyboard-preferences-title" className="mb-2 grid gap-2 border border-window-dark-shadow bg-window-panel p-2 md:grid-cols-2">
          <h3 className="font-mono text-xs font-bold uppercase md:col-span-2" id="keyboard-preferences-title">Preferencias</h3>
          <PreferenceToggle
            checked={preferences.keyboardMode}
            description="Muestra en el menú y en la búsqueda el código de cada módulo para abrirlo con G + código."
            id="keyboard-mode-toggle"
            label="Modo teclado: mostrar códigos"
            onChange={(value) => setKeyboardPreference("keyboardMode", value)}
          />
          <PreferenceToggle
            checked={preferences.singleKeyShortcuts}
            description="Desactívalo si usas control por voz o te saltan acciones sin querer. F1, Ctrl K y los atajos con Alt siguen funcionando."
            id="single-key-shortcuts-toggle"
            label="Atajos de una sola tecla (/, ?, G)"
            onChange={(value) => setKeyboardPreference("singleKeyShortcuts", value)}
          />
        </section>
        <div className="grid gap-px border border-window-dark-shadow bg-window-dark-shadow md:grid-cols-3">
          {shortcutGroups.map((group) => (
            <section className="bg-window-surface p-2" key={group.label}>
              <h3 className="border-b border-window-shadow pb-1 font-mono text-xs font-bold uppercase">{group.label}</h3>
              <dl className="mt-1 divide-y divide-window-shadow/60">
                {group.shortcuts.map(([shortcut, description]) => (
                  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 py-1.5" key={shortcut}>
                    <dt><kbd className="inline-block border border-window-dark-shadow bg-window-panel px-1 py-0.5 font-mono text-[0.62rem] font-bold shadow-[inset_1px_1px_0_var(--window-highlight)]">{shortcut}</kbd></dt>
                    <dd className="text-xs leading-4 text-window-muted">{description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="mt-2 border border-info bg-info/15 p-2 font-mono text-xs text-info">
          Consejo: pulsa Tab para avanzar por controles y Mayús+Tab para retroceder. El contorno de foco resaltado indica siempre dónde se ejecutará la siguiente acción.
        </p>
      </Dialog>
    </>
  );
}

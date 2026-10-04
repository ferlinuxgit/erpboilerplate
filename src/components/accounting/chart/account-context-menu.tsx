"use client";

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import type { ChartNode } from "@/lib/chart-of-accounts/types";

export type ContextMenuCommand = "open" | "ledger" | "newChild" | "edit" | "toggleBlocked" | "copy";

type AccountContextMenuProps = {
  node: ChartNode;
  position: { x: number; y: number };
  canManage: boolean;
  onCommand: (command: ContextMenuCommand, node: ChartNode) => void;
  onClose: () => void;
};

const itemClasses =
  "flex w-full items-center gap-2 px-2 py-1.5 text-left font-mono text-xs text-window-text outline-none hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground";

/**
 * Menú contextual de una fila del árbol (clic derecho, tecla de menú o Mayús+F10): mismo patrón
 * de menú WAI-ARIA que `DropdownMenu`, pero situado en el puntero.
 */
export function AccountContextMenu({ canManage, node, onClose, onCommand, position }: AccountContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const items: Array<{ command: ContextMenuCommand; label: string }> = [
    { command: "open", label: "Ver ficha" },
    ...(node.isPostable ? [{ command: "ledger" as const, label: "Ver mayor" }] : []),
    ...(canManage && (node.isPostable || node.code.length >= 3) ? [{ command: "newChild" as const, label: "Crear subcuenta aquí" }] : []),
    ...(canManage ? [{ command: "edit" as const, label: "Editar" }] : []),
    ...(canManage && node.isPostable ? [{ command: "toggleBlocked" as const, label: node.isBlocked ? "Desbloquear" : "Bloquear" }] : []),
    { command: "copy", label: "Copiar código" },
  ];

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const x = Math.max(4, Math.min(position.x, window.innerWidth - width - 4));
    const y = position.y + height > window.innerHeight - 4 ? Math.max(4, position.y - height) : position.y;
    // Recoloca el menú dentro de la ventana sin pasar por el estado (ya está pintado).
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.querySelector<HTMLElement>("[role='menuitem']")?.focus();
  }, [position]);

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", closeOutside);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const elements = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []);
    const current = elements.findIndex((element) => element === document.activeElement);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      elements[(current + step + elements.length) % elements.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      elements[event.key === "Home" ? 0 : elements.length - 1]?.focus();
    }
  }

  return createPortal(
    <div
      aria-label={`Acciones de la cuenta ${node.code}`}
      className="fixed z-50 min-w-48 rounded-surface border border-window-dark-shadow bg-window-surface p-1 shadow-window"
      data-testid="account-context-menu"
      onKeyDown={handleKeyDown}
      ref={menuRef}
      role="menu"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item) => (
        <button
          className={itemClasses}
          key={item.command}
          onClick={() => {
            onClose();
            onCommand(item.command, node);
          }}
          role="menuitem"
          tabIndex={-1}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

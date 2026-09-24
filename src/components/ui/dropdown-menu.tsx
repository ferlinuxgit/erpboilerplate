"use client";

import Link from "next/link";
import * as React from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DropdownMenuProps = {
  /** Visible content of the trigger button. */
  trigger: React.ReactNode;
  children: React.ReactNode;
  /** Accessible name of the trigger (required when the trigger is icon-only or ambiguous, e.g. "Más acciones de F-2026/0001"). */
  label?: string;
  align?: "start" | "end";
  triggerVariant?: "outline" | "ghost" | "secondary" | "default";
  triggerSize?: "xs" | "sm" | "default" | "icon-sm" | "icon";
  triggerClassName?: string;
  triggerTestId?: string;
};

const DropdownMenuContext = React.createContext<{ close: (restoreFocus?: boolean) => void } | null>(null);

function menuItems(root: HTMLElement | null) {
  return Array.from(root?.querySelectorAll<HTMLElement>("[role='menuitem']:not([aria-disabled='true'])") ?? []);
}

/**
 * Accessible "Más" menu (WAI-ARIA menu button). Items stay mounted while the
 * menu is closed so items that open dialogs (e.g. `DeleteButton` with
 * `asMenuItem`) keep their dialog alive after the menu closes.
 */
export function DropdownMenu({
  align = "end",
  children,
  label,
  trigger,
  triggerClassName,
  triggerSize = "sm",
  triggerTestId,
  triggerVariant = "outline",
}: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const openAtEndRef = React.useRef(false);
  const menuId = React.useId();
  const [position, setPosition] = React.useState<React.CSSProperties | null>(null);

  const close = React.useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Fixed positioning escapes scrollable table containers (sticky headers)
  // and flips the menu upwards when there is no room below the trigger.
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const menuHeight = menu.offsetHeight;
      const menuWidth = menu.offsetWidth;
      const below = window.innerHeight - trigger.bottom;
      const top = below < menuHeight + 8 && trigger.top > menuHeight + 8 ? trigger.top - menuHeight - 4 : trigger.bottom + 4;
      const left = align === "end" ? trigger.right - menuWidth : trigger.left;
      setPosition({ position: "fixed", top, left: Math.max(4, Math.min(left, window.innerWidth - menuWidth - 4)) });
    };
    place();
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", place, true);
    };
  }, [align, open]);

  React.useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    const items = menuItems(menuRef.current);
    (openAtEndRef.current ? items.at(-1) : items[0])?.focus();
    openAtEndRef.current = false;
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  const contextValue = React.useMemo(() => ({ close }), [close]);

  return (
    <DropdownMenuContext.Provider value={contextValue}>
      <div
        className="relative inline-block text-left"
        data-dropdown-root=""
        ref={rootRef}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
        onKeyDown={(event) => {
          // Ignore key presses bubbling through portals (dialogs opened from an item).
          if (!rootRef.current?.contains(event.target as Node)) return;
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            close();
            return;
          }
          if (event.key === "Tab" && open) {
            setOpen(false);
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open && event.target === triggerRef.current) {
              openAtEndRef.current = event.key === "ArrowUp";
              setOpen(true);
              return;
            }
            const items = menuItems(menuRef.current);
            const current = items.indexOf(document.activeElement as HTMLElement);
            items[(current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          } else if (open && (event.key === "Home" || event.key === "End")) {
            event.preventDefault();
            const items = menuItems(menuRef.current);
            items[event.key === "Home" ? 0 : items.length - 1]?.focus();
          } else if (open && event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
            // Type-ahead: jump to the next item starting with the typed letter.
            const items = menuItems(menuRef.current);
            const start = items.indexOf(document.activeElement as HTMLElement);
            const ordered = [...items.slice(start + 1), ...items.slice(0, start + 1)];
            ordered.find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()))?.focus();
          }
        }}
      >
        <button
          aria-controls={menuId}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={label}
          className={cn(buttonVariants({ variant: triggerVariant, size: triggerSize }), triggerClassName)}
          data-dropdown-trigger=""
          data-testid={triggerTestId}
          onClick={() => setOpen((current) => !current)}
          ref={triggerRef}
          title={label}
          type="button"
        >
          {trigger}
        </button>
        <div
          aria-label={label}
          className={cn(
            "absolute z-50 mt-1 min-w-44 rounded-[2px] border border-window-dark-shadow bg-window-surface p-1 shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow),3px_3px_0_rgba(0,0,0,0.3)]",
            align === "end" ? "right-0" : "left-0",
          )}
          hidden={!open}
          style={open && position ? { ...position, marginTop: 0 } : undefined}
          id={menuId}
          ref={menuRef}
          role="menu"
        >
          {children}
        </div>
      </div>
    </DropdownMenuContext.Provider>
  );
}

const itemClasses =
  "flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-left font-mono text-xs text-window-text no-underline outline-none hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0";

type DropdownMenuItemProps = React.ComponentProps<"button"> & {
  destructive?: boolean;
  /** Keep the menu open after activation (defaults to closing it). */
  keepOpen?: boolean;
};

export function DropdownMenuItem({ className, destructive, keepOpen, onClick, ...props }: DropdownMenuItemProps) {
  const context = React.useContext(DropdownMenuContext);
  return (
    <button
      className={cn(itemClasses, destructive && "text-destructive", className)}
      role="menuitem"
      tabIndex={-1}
      type="button"
      onClick={(event) => {
        onClick?.(event);
        // Do not steal focus back: the item may have opened a dialog.
        if (!keepOpen) context?.close(false);
      }}
      {...props}
    />
  );
}

type DropdownMenuLinkItemProps = React.ComponentProps<typeof Link>;

export function DropdownMenuLinkItem({ className, onClick, ...props }: DropdownMenuLinkItemProps) {
  const context = React.useContext(DropdownMenuContext);
  return (
    <Link
      className={cn(itemClasses, className)}
      role="menuitem"
      tabIndex={-1}
      onClick={(event) => {
        onClick?.(event);
        context?.close(false);
      }}
      {...props}
    />
  );
}

export function DropdownMenuSeparator() {
  return <div aria-hidden="true" className="my-1 border-t border-window-shadow" role="separator" />;
}

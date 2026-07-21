import * as React from "react";

import { cn } from "@/lib/utils";

type DropdownMenuProps = {
  trigger: React.ReactNode;
  children: React.ReactNode;
};

export function DropdownMenu({ children, trigger }: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const openAtEndRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []);
    (openAtEndRef.current ? items.at(-1) : items[0])?.focus();
    openAtEndRef.current = false;
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  return (
    <div className="relative inline-block text-left" ref={rootRef} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={(event) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!open && event.target === triggerRef.current) {
          openAtEndRef.current = event.key === "ArrowUp";
          setOpen(true);
          return;
        }
        const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []);
        const current = items.indexOf(document.activeElement as HTMLElement);
        items[(current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      } else if (open && (event.key === "Home" || event.key === "End")) {
        event.preventDefault();
        const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []);
        items[event.key === "Home" ? 0 : items.length - 1]?.focus();
      }
    }}>
      <button aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((current) => !current)} ref={triggerRef} type="button">
        {trigger}
      </button>
      {open ? (
        <div className={cn("absolute right-0 z-50 mt-1 min-w-40 rounded-[2px] border border-window-dark-shadow bg-window-surface p-1 shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)]")} role="menu">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function DropdownMenuItem({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      className={cn("w-full rounded-none px-2 py-1 text-left font-mono text-xs outline-none hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground", className)}
      role="menuitem"
      tabIndex={-1}
      type="button"
      {...props}
    />
  );
}

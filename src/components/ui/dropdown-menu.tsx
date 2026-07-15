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

  React.useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    rootRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  return (
    <div className="relative inline-block text-left" ref={rootRef} onKeyDown={(event) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []);
        const current = items.indexOf(document.activeElement as HTMLElement);
        items[(current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    }}>
      <button aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((current) => !current)} ref={triggerRef} type="button">
        {trigger}
      </button>
      {open ? (
        <div className={cn("absolute right-0 z-50 mt-2 min-w-40 rounded-md border bg-background p-1 shadow-md")} role="menu">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function DropdownMenuItem({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      className={cn("w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted", className)}
      role="menuitem"
      type="button"
      {...props}
    />
  );
}

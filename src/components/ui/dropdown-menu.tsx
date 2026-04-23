import * as React from "react";

import { cn } from "@/lib/utils";

type DropdownMenuProps = {
  trigger: React.ReactNode;
  children: React.ReactNode;
};

export function DropdownMenu({ children, trigger }: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="relative inline-block text-left">
      <button onClick={() => setOpen((current) => !current)} type="button">
        {trigger}
      </button>
      {open ? (
        <div className={cn("absolute right-0 z-50 mt-2 min-w-40 rounded-md border bg-background p-1 shadow-md")}>
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
      type="button"
      {...props}
    />
  );
}

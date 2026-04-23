import * as React from "react";

import { cn } from "@/lib/utils";

type DialogProps = {
  children: React.ReactNode;
  open: boolean;
  onClose: () => void;
  title: string;
};

export function Dialog({ children, onClose, open, title }: DialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={cn("w-full max-w-lg rounded-lg border bg-background p-4 shadow-lg")}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="text-sm text-muted-foreground hover:text-foreground" onClick={onClose} type="button">
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

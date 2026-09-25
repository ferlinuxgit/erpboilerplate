"use client";

import { Keyboard, SignOut } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { openKeyboardHelp } from "@/components/layout/keyboard-shortcuts";
import { Button } from "@/components/ui/button";
import { invalidateActiveContext, loadActiveContext, type ActiveContextPayload } from "@/lib/active-context-client";
import { authClient } from "@/lib/auth-client";
import { roleLabels, statusLabel } from "@/lib/status-labels";
import { cn } from "@/lib/utils";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toLocaleUpperCase("es-ES");
}

export function SessionPanel({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const router = useRouter();
  const [user, setUser] = useState<ActiveContextPayload["user"] | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadActiveContext().then((payload) => {
      if (!cancelled && payload?.user) setUser(payload.user);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSignOut = async () => {
    setSigningOut(true);
    await authClient.signOut();
    invalidateActiveContext();
    onNavigate?.();
    router.push("/auth/login");
    router.refresh();
  };

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1.5 border border-window-dark-shadow bg-window-panel p-1.5 shadow-[inset_1px_1px_0_var(--window-highlight)]",
        className,
      )}
      data-testid="session-panel"
    >
      <span
        aria-hidden="true"
        className="grid size-7 shrink-0 place-items-center border border-window-dark-shadow bg-window-highlight font-mono text-xs font-black text-primary"
      >
        {user ? initials(user.name) : "··"}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate font-mono text-xs font-bold text-window-text" title={user?.email}>
          {user?.name ?? "Sesión activa"}
        </p>
        <p className="truncate font-mono text-xs text-window-muted">
          {user ? statusLabel(roleLabels, user.role) : "Cargando…"}
        </p>
      </div>
      <Button
        aria-keyshortcuts="F1"
        aria-label="Atajos de teclado (F1)"
        onClick={() => {
          onNavigate?.();
          openKeyboardHelp();
        }}
        size="icon-sm"
        title="Atajos de teclado (F1)"
        type="button"
        variant="ghost"
      >
        <Keyboard aria-hidden="true" />
      </Button>
      <Button
        aria-label="Cerrar sesión"
        disabled={signingOut}
        onClick={onSignOut}
        size="icon-sm"
        title="Cerrar sesión"
        type="button"
        variant="outline"
      >
        <SignOut aria-hidden="true" />
      </Button>
    </div>
  );
}

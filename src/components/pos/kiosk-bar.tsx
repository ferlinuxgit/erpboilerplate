import { ArrowLeft, CashRegister } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

/**
 * Barra superior del TPV en modo mostrador (sin el menú del ERP): caja, estado y acciones. En móvil
 * las acciones se quedan en iconos.
 */
export function KioskBar({ backHref = "/dashboard", backLabel = "ERP", children, status, title }: { backHref?: string; backLabel?: string; children?: React.ReactNode; status?: React.ReactNode; title: string }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-window-dark-shadow bg-chrome-active px-2 pt-[env(safe-area-inset-top)] text-chrome-active-foreground" data-testid="pos-kiosk-bar">
      <Link aria-label={`Volver al ${backLabel}`} className="flex h-11 items-center gap-1 px-2 font-mono text-xs font-bold hover:bg-white/10" href={backHref}>
        <ArrowLeft aria-hidden="true" className="size-5" /><span className="hidden sm:inline">{backLabel}</span>
      </Link>
      <CashRegister aria-hidden="true" className="size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm font-bold">{title}</p>
        {status ? <p className="truncate text-[11px] opacity-80">{status}</p> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-1">{children}</div> : null}
    </header>
  );
}

/** Botón de la barra del TPV: icono siempre, texto desde tablet. */
export function KioskAction({ children, icon, label, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ReactNode; label: string }) {
  return (
    <button aria-label={label} className="flex h-11 min-w-11 items-center justify-center gap-1.5 border border-white/30 px-2.5 font-mono text-xs font-bold hover:bg-white/10 active:translate-y-px disabled:opacity-40" type="button" {...props}>
      {icon}<span className="hidden md:inline">{children ?? label}</span>
    </button>
  );
}

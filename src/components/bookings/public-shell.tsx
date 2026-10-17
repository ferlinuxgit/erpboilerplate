import { MapPin, Phone } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Marco de las páginas públicas de reservas: una ventana con el nombre del local. En modo incrustado, sin fondo. */
export function PublicBookingShell({ address, children, embed = false, label = "Reservas", logo, name, phone, wide = false }: { address?: string | null; children: ReactNode; embed?: boolean; label?: string; logo?: string | null; name: string; phone?: string | null; wide?: boolean }) {
  return (
    <main className={cn("grid min-h-dvh place-items-start justify-items-center px-2 py-4 sm:place-items-center sm:px-6 sm:py-10", embed ? "bg-transparent sm:py-2" : "retro-checker")}>
      <div className={cn("w-full overflow-hidden rounded-surface border border-window-dark-shadow bg-window-surface shadow-window-lg", wide ? "max-w-3xl" : "max-w-xl")}>
        <div className="flex min-h-11 items-center gap-2 border-b border-window-dark-shadow bg-chrome-active px-2 text-chrome-active-foreground">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo propio guardado como data URL
            <img alt="" className="size-7 border border-white/70 bg-white object-contain" src={logo} />
          ) : (
            <span aria-hidden="true" className="grid size-7 place-items-center border border-white/70 bg-window-highlight text-xs font-black text-window-text shadow-raised">{name.slice(0, 2).toUpperCase()}</span>
          )}
          <span className="truncate font-mono text-sm font-bold">{name}</span>
          <span aria-hidden="true" className="ml-auto shrink-0 font-mono text-xs text-chrome-active-foreground/75">{label}</span>
        </div>
        {address || phone ? (
          <p className="flex flex-wrap gap-x-4 gap-y-1 border-b border-window-shadow bg-window-panel px-3 py-2 text-xs text-window-muted">
            {address ? <span className="flex items-center gap-1"><MapPin aria-hidden="true" className="size-3.5" />{address}</span> : null}
            {phone ? <a className="flex items-center gap-1 underline-offset-2 hover:underline" href={`tel:${phone.replace(/\s/g, "")}`}><Phone aria-hidden="true" className="size-3.5" />{phone}</a> : null}
          </p>
        ) : null}
        <div className="p-3 sm:p-5">{children}</div>
      </div>
    </main>
  );
}

import { Buildings, ChartLineUp, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";

const highlights = [
  { icon: ChartLineUp, label: "Ventas, cobros y bancos conectados" },
  { icon: Buildings, label: "Multiempresa y ejercicios" },
  { icon: ShieldCheck, label: "Fiscalidad española y permisos" },
];

/** Marco de las pantallas de acceso: una ventana retro centrada sobre el fondo del tema. */
export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="retro-checker grid min-h-dvh place-items-center px-2 py-4 sm:px-6 sm:py-10">
      <div className="w-full max-w-md overflow-hidden rounded-surface border border-window-dark-shadow bg-window-surface shadow-window-lg lg:max-w-4xl">
        <div className="flex h-11 items-center gap-2 border-b border-window-dark-shadow bg-chrome-active px-2 text-chrome-active-foreground">
          <Link className="flex min-h-11 items-center gap-2 font-mono text-sm font-bold" href="/">
            <span aria-hidden="true" className="grid size-7 place-items-center border border-white/70 bg-window-highlight text-xs font-black text-window-text shadow-raised">ER</span>
            ERP Suite
          </Link>
          <span aria-hidden="true" className="ml-auto truncate font-mono text-xs text-chrome-active-foreground/75">Acceso</span>
        </div>
        <div className="lg:grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <section className="hidden border-r border-window-dark-shadow bg-window-panel p-6 lg:flex lg:flex-col lg:justify-between lg:gap-8">
            <div>
              <p className="font-mono text-xs font-bold uppercase tracking-[0.06em] text-link">[ Una única operación ]</p>
              {/* El único h1 de la página es el título del formulario. */}
              <p className="mt-3 font-mono text-2xl font-bold leading-tight text-balance text-window-text">Ventas, finanzas e inventario en un espacio claro.</p>
              <p className="mt-3 max-w-md text-sm leading-6 text-window-muted">Diseñado para convertir procesos complejos en decisiones rápidas, sin ruido visual.</p>
            </div>
            <ul className="divide-y divide-window-shadow border border-window-dark-shadow bg-window-surface shadow-bevel-top">
              {highlights.map(({ icon: Icon, label }) => (
                <li className="flex items-center gap-2 px-2.5 py-2 text-sm text-window-text" key={label}>
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-link" />
                  {label}
                </li>
              ))}
            </ul>
          </section>
          <section className="p-2 sm:p-4 lg:p-6">{children}</section>
        </div>
      </div>
    </main>
  );
}

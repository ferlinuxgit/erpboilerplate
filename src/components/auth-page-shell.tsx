import Link from "next/link";
import type { ReactNode } from "react";

export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[minmax(22rem,0.8fr)_minmax(32rem,1.2fr)]">
      <section className="surface-grid relative hidden overflow-hidden border-r bg-primary p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <Link className="flex items-center gap-3" href="/">
          <span className="grid size-10 place-items-center rounded-lg bg-primary-foreground text-xs font-bold text-primary">ER</span>
          <span className="font-semibold">ERP Suite</span>
        </Link>
        <div className="relative max-w-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-foreground/60">Una única operación</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-[-0.045em]">Ventas, finanzas e inventario en un espacio claro.</h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-primary-foreground/70">Diseñado para convertir procesos complejos en decisiones rápidas, sin ruido visual.</p>
        </div>
        <p className="text-xs text-primary-foreground/55">Operación · Finanzas · Cumplimiento</p>
      </section>
      <section className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <Link className="mb-8 flex items-center gap-2 lg:hidden" href="/"><span className="grid size-8 place-items-center rounded-md bg-primary text-[0.65rem] font-bold text-primary-foreground">ER</span><span className="font-semibold">ERP Suite</span></Link>
          {children}
        </div>
      </section>
    </main>
  );
}

import Link from "next/link";
import { Buildings, ChartLineUp, ShieldCheck } from "@phosphor-icons/react/dist/ssr";

import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

// Cifras de ejemplo en formato es-ES (el símbolo va detrás, con espacio irrompible).
const sampleMetrics = [
  { label: "Facturación", value: "84.320 €" },
  { label: "Pendiente de cobro", value: "12.480 €" },
  { label: "Clientes activos", value: "128" },
  { label: "Alertas de stock", value: "4" },
];

const features = [
  { icon: ChartLineUp, label: "Ventas y cobros conectados" },
  { icon: Buildings, label: "Multiempresa y ejercicios" },
  { icon: ShieldCheck, label: "Control fiscal y permisos" },
];

export default function Home() {
  return (
    <main className="retro-checker flex min-h-dvh flex-col">
      <nav
        aria-label="Acceso"
        className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-window-dark-shadow bg-chrome-active px-2 text-chrome-active-foreground sm:px-4"
      >
        <Link className="flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap font-mono text-sm font-bold" href="/">
          <span aria-hidden="true" className="grid size-7 place-items-center border border-white/70 bg-window-highlight text-xs font-black text-window-text shadow-raised">ER</span>
          ERP Suite
        </Link>
        <div className="flex gap-1.5">
          <Link className={buttonVariants({ variant: "outline" })} href="/auth/login">Iniciar sesión</Link>
          <Link className={buttonVariants()} href="/auth/register">Crear cuenta</Link>
        </div>
      </nav>

      <section className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-6 px-3 py-8 sm:px-6 sm:py-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:py-16">
        <div className="rounded-surface border border-window-dark-shadow bg-card p-4 shadow-raised sm:p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.06em] text-link">[ Gestión empresarial, simplificada ]</p>
          <h1 className="mt-3 font-mono text-3xl font-bold leading-tight text-balance text-foreground sm:text-4xl xl:text-5xl">
            Todo el negocio.<br />Una sola vista.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            Clientes, facturación, compras, stock, contabilidad y fiscalidad conectados en una interfaz clara y sin ruido.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link className={buttonVariants({ size: "lg" })} href="/auth/register">Empezar ahora</Link>
            <Link className={buttonVariants({ variant: "outline", size: "lg" })} href="/dashboard">Ver el panel</Link>
          </div>
        </div>

        {/* Ventana de muestra: solo ilustra el producto, no es interactiva. */}
        <figure className="overflow-hidden rounded-surface border border-window-dark-shadow bg-window-surface shadow-window-lg">
          <div className="flex h-8 items-center justify-between gap-2 border-b border-window-dark-shadow bg-chrome-active px-2 text-chrome-active-foreground">
            <figcaption className="truncate font-mono text-xs font-bold">Vista operativa</figcaption>
            <span aria-hidden="true" className="flex gap-0.5">
              {[0, 1, 2].map((index) => (
                <span className="size-4 border border-window-dark-shadow bg-window-surface shadow-raised" key={index} />
              ))}
            </span>
          </div>
          <div className="space-y-3 p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.06em] text-window-muted">Actividad</p>
              <StatusBadge tone="success">En tiempo real</StatusBadge>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              {sampleMetrics.map(({ label, value }) => (
                <div className="rounded-control border border-window-dark-shadow bg-card px-2.5 py-2 shadow-sunken" key={label}>
                  <dt className="font-mono text-xs font-bold uppercase tracking-[0.02em] text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-mono text-xl font-bold tabular-nums sm:text-2xl">{value}</dd>
                </div>
              ))}
            </dl>
            <ul className="divide-y divide-window-shadow border border-window-dark-shadow bg-window-panel shadow-bevel-top">
              {features.map(({ icon: Icon, label }) => (
                <li className="flex items-center gap-2 px-2.5 py-2 text-sm" key={label}>
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-link" />
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>
        </figure>
      </section>
    </main>
  );
}

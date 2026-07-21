import Link from "next/link";
import { Buildings, ChartLineUp, ShieldCheck } from "@phosphor-icons/react/dist/ssr";

import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-background">
      <nav className="mx-auto flex h-20 max-w-[1480px] items-center justify-between px-5 sm:px-8">
        <Link className="flex shrink-0 items-center gap-3 whitespace-nowrap" href="/"><span className="grid size-9 place-items-center rounded-[2px] bg-primary text-xs font-bold text-primary-foreground">ER</span><span className="font-semibold">ERP Suite</span></Link>
        <div className="flex gap-2"><Link className={buttonVariants({ variant: "ghost" })} href="/auth/login">Iniciar sesión</Link><Link className={buttonVariants()} href="/auth/register">Crear cuenta</Link></div>
      </nav>

      <section className="surface-grid border-y">
        <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-[1480px] lg:grid-cols-[1.05fr_0.95fr]">
          <div className="flex flex-col justify-center px-5 py-20 sm:px-8 lg:pr-16">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Gestión empresarial, simplificada</p>
            <h1 className="mt-6 max-w-4xl text-5xl font-semibold leading-[0.98] tracking-[-0.06em] text-balance sm:text-6xl xl:text-7xl">Todo el negocio.<br />Una sola vista.</h1>
            <p className="mt-7 max-w-xl text-base leading-7 text-muted-foreground">Clientes, facturación, compras, stock, contabilidad y fiscalidad conectados en una interfaz visual y sin ruido.</p>
            <div className="mt-8 flex flex-wrap gap-3"><Link className={buttonVariants({ size: "lg" })} href="/auth/register">Empezar ahora</Link><Link className={buttonVariants({ variant: "outline", size: "lg" })} href="/dashboard">Ver el panel</Link></div>
          </div>

          <div className="relative flex items-center border-t bg-primary p-3 text-primary-foreground sm:p-8 lg:border-l lg:border-t-0">
            <div className="w-full overflow-hidden rounded-[2px] border border-primary-foreground/15 bg-primary-foreground/[0.06] p-3 shadow-2xl shadow-black/10 backdrop-blur sm:p-7">
              <div className="flex items-center justify-between border-b border-primary-foreground/15 pb-5"><div><p className="text-xs uppercase tracking-[0.12em] text-primary-foreground/55">Actividad</p><p className="mt-1 text-xl font-semibold">Vista operativa</p></div><span className="rounded-full bg-primary-foreground/10 px-3 py-1 text-xs">En tiempo real</span></div>
              <div className="mt-5 grid gap-px overflow-hidden rounded-[2px] bg-primary-foreground/15 sm:grid-cols-2">
                {[["Facturación", "€ 84.320"], ["Pendiente de cobro", "€ 12.480"], ["Clientes activos", "128"], ["Alertas de stock", "4"]].map(([label, value]) => <div className="bg-primary p-3" key={label}><p className="text-xs text-primary-foreground/55">{label}</p><p className="mt-4 text-2xl font-semibold">{value}</p></div>)}
              </div>
              <div className="mt-5 space-y-3">
                {[{ icon: ChartLineUp, label: "Ventas y cobros conectados" }, { icon: Buildings, label: "Multiempresa y ejercicios" }, { icon: ShieldCheck, label: "Control fiscal y permisos" }].map(({ icon: Icon, label }) => <div className="flex items-center gap-3 border-b border-primary-foreground/10 pb-3 text-sm" key={label}><Icon className="size-5 text-primary-foreground/60" aria-hidden="true" /><span>{label}</span></div>)}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

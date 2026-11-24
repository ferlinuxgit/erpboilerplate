import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  Calculator,
  Check,
  ForkKnife,
  Package,
  Receipt,
  Robot,
  Scales,
  ShoppingCart,
  Sparkle,
  Storefront,
  UserCircle,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";

import { PriceCalculator } from "@/components/marketing/price-calculator";
import { RetroWindow } from "@/components/marketing/retro-window";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { BASE_PLAN, MODULE_MONTHLY_CENTS, OCR_PACKS, PAST_DUE_GRACE_DAYS, TRIAL_DAYS, WELCOME_OCR_CREDITS, formatEuros } from "@/lib/billing/catalog";
import { AUDIENCES, CORE_FEATURE_GROUPS, PROOF_POINTS, buildFaqs } from "@/lib/marketing/content";
import { MODULES, getModule, type ModuleCategory, type ModuleId } from "@/modules/registry";

export const metadata: Metadata = {
  title: { absolute: "Norpie · Facturación, contabilidad e impuestos con VERI*FACTU" },
  description: `Factura con VERI*FACTU, lleva la contabilidad y prepara los modelos de la AEAT en un solo sitio. Desde ${formatEuros(BASE_PLAN.monthlyCents)} al mes, ${TRIAL_DAYS} días gratis.`,
};

const GROUP_ICONS = { facturacion: Receipt, gastos: ShoppingCart, contabilidad: Scales, impuestos: Calculator, maestros: UsersThree, ia: Robot } as const;
const AUDIENCE_ICONS = { autonomos: UserCircle, pymes: Briefcase, comercios: Storefront, hosteleria: ForkKnife, asesorias: Scales } as const;
const CATEGORY_ORDER: readonly ModuleCategory[] = ["Ventas", "Compras y gastos", "Finanzas", "Operaciones"];

// Cifras de ejemplo de la ventana del titular (formato es-ES).
const SAMPLE_ROWS = [
  { number: "F-2026-0142", customer: "Talleres Ruiz, S.L.", amount: "1.452,00 €", status: "Cobrada", tone: "success" as const },
  { number: "F-2026-0141", customer: "Café Marítimo", amount: "318,40 €", status: "Enviada", tone: "info" as const },
  { number: "F-2026-0140", customer: "Lucía Pérez Gil", amount: "96,80 €", status: "Vence hoy", tone: "warning" as const },
];

function SectionHeading({ eyebrow, title, description, id }: { eyebrow: string; title: string; description?: string; id: string }) {
  return (
    <div className="max-w-3xl">
      <p className="font-mono text-xs font-bold uppercase tracking-[0.06em] text-link">[ {eyebrow} ]</p>
      <h2 className="mt-2 scroll-mt-20 font-mono text-2xl font-bold leading-tight text-balance sm:text-3xl" id={id}>{title}</h2>
      {description ? <p className="mt-2 text-base leading-7 text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export default function Home() {
  const faqs = buildFaqs({ trialDays: TRIAL_DAYS, graceDays: PAST_DUE_GRACE_DAYS, welcomeCredits: WELCOME_OCR_CREDITS });
  const cheapestModule = Math.min(...Object.values(MODULE_MONTHLY_CENTS));

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-window-surface focus:p-2" href="#contenido">Saltar al contenido</a>
      <SiteHeader />

      <main className="flex-1" id="contenido">
        {/* Titular */}
        <section aria-labelledby="titular" className="retro-checker border-b border-window-dark-shadow">
          <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-10 sm:py-14 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
            <div>
              <StatusBadge tone="info">Preparado para VERI*FACTU</StatusBadge>
              <h1 className="mt-3 font-mono text-4xl font-bold leading-[1.1] text-balance sm:text-5xl" id="titular">
                Factura, contabiliza y presenta impuestos. Sin cambiar de programa.
              </h1>
              <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                El ERP para autónomos, pymes, comercios y hostelería: cada factura genera su asiento y su apunte de IVA, y los modelos de la AEAT salen de tus propios libros.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link className={buttonVariants({ size: "lg" })} href="/auth/register">
                  Probar {TRIAL_DAYS} días gratis <ArrowRight aria-hidden="true" weight="bold" />
                </Link>
                <Link className={buttonVariants({ variant: "outline", size: "lg" })} href="#precios">Ver precios</Link>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">Sin tarjeta · Todo incluido durante la prueba · Desde {formatEuros(BASE_PLAN.monthlyCents)}/mes + IVA</p>
            </div>

            {/* Ilustración: no es interactiva. */}
            <RetroWindow as="figure" elevation="featured" title="Facturas · Noviembre" titleAside={<StatusBadge className="hidden bg-window-surface sm:inline-flex" tone="success">VERI*FACTU OK</StatusBadge>}>
              <dl className="grid grid-cols-3 gap-2">
                {[
                  { label: "Facturado", value: "24.380 €" },
                  { label: "Por cobrar", value: "3.912 €" },
                  { label: "IVA 4T", value: "2.104 €" },
                ].map((metric) => (
                  <div className="min-w-0 rounded-control border border-window-dark-shadow bg-card px-2 py-1.5 shadow-sunken" key={metric.label}>
                    <dt className="truncate font-mono text-[0.68rem] font-bold uppercase text-muted-foreground">{metric.label}</dt>
                    <dd className="mt-0.5 truncate font-mono text-base font-bold tabular-nums sm:text-xl">{metric.value}</dd>
                  </div>
                ))}
              </dl>
              <table className="mt-3 w-full border border-window-dark-shadow bg-card text-left text-sm shadow-sunken">
                <caption className="sr-only">Últimas facturas de ejemplo</caption>
                <thead className="bg-window-panel font-mono text-xs text-window-muted">
                  <tr>
                    <th className="px-2 py-1.5 font-bold" scope="col">Número</th>
                    <th className="hidden px-2 py-1.5 font-bold sm:table-cell" scope="col">Cliente</th>
                    <th className="px-2 py-1.5 text-right font-bold" scope="col">Total</th>
                    <th className="px-2 py-1.5 font-bold" scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-window-shadow">
                  {SAMPLE_ROWS.map((row) => (
                    <tr key={row.number}>
                      <td className="px-2 py-1.5 font-mono text-xs">{row.number}</td>
                      <td className="hidden truncate px-2 py-1.5 sm:table-cell">{row.customer}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{row.amount}</td>
                      <td className="px-2 py-1.5"><StatusBadge tone={row.tone}>{row.status}</StatusBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <figcaption className="mt-2 font-mono text-xs text-window-muted">Datos de ejemplo.</figcaption>
            </RetroWindow>
          </div>
        </section>

        {/* Pruebas */}
        <section aria-label="En cifras" className="border-b border-window-dark-shadow bg-window-panel">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 py-6 lg:grid-cols-4">
            {PROOF_POINTS.map((point) => (
              <div className="px-2 py-2" key={point.label}>
                <dt className="sr-only">{point.label}</dt>
                <dd className="font-mono text-lg font-bold sm:text-xl">{point.value}</dd>
                <dd className="text-sm text-window-muted">{point.label}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Núcleo */}
        <section className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <SectionHeading
            description={`Todo esto entra en el plan base de ${formatEuros(BASE_PLAN.monthlyCents)} al mes, para todos los usuarios de tu empresa.`}
            eyebrow="Incluido en el plan base"
            id="funciones"
            title="Lo esencial para llevar tu empresa al día"
          />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CORE_FEATURE_GROUPS.map((group) => {
              const Icon = GROUP_ICONS[group.id as keyof typeof GROUP_ICONS] ?? Sparkle;
              return (
                <RetroWindow as="article" key={group.id} title={group.title}>
                  <div className="flex items-start gap-2">
                    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center border border-window-dark-shadow bg-window-highlight shadow-raised">
                      <Icon className="size-5 text-link" weight="duotone" />
                    </span>
                    <h3 className="pt-1 font-bold leading-snug">{group.summary}</h3>
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {group.items.map((item) => (
                      <li className="flex gap-2 text-sm leading-6" key={item}>
                        <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-success-text" weight="bold" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </RetroWindow>
              );
            })}
          </div>
        </section>

        {/* Cómo funciona */}
        <section aria-labelledby="como-funciona" className="border-y border-window-dark-shadow bg-window-panel">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:py-16">
            <SectionHeading eyebrow="Cómo funciona" id="como-funciona" title="Una factura, cuatro tareas hechas" />
            <ol className="mt-8 grid gap-3 md:grid-cols-4">
              {[
                { title: "Emites la factura", text: "Con tus series, tu logo y el IVA o IGIC que toca a cada cliente." },
                { title: "Se registra en Hacienda", text: "VERI*FACTU firma y envía el registro y pone el QR en el PDF." },
                { title: "Se contabiliza sola", text: "Asiento en el diario, apunte en el libro de IVA y vencimiento de cobro." },
                { title: "Llega al modelo", text: "El 303, el 390 y el 347 salen de tus libros, sin volver a teclear nada." },
              ].map((step, index) => (
                <li className="rounded-surface border border-window-dark-shadow bg-window-surface p-3 shadow-raised" key={step.title}>
                  <span className="grid size-7 place-items-center border border-window-dark-shadow bg-primary font-mono text-sm font-bold text-primary-foreground shadow-raised-tinted">{index + 1}</span>
                  <h3 className="mt-2 font-mono text-sm font-bold">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-window-muted">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Módulos */}
        <section className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <SectionHeading
            description={`Activa solo lo que tu negocio necesita, desde ${formatEuros(cheapestModule)} al mes cada uno. Desactivar un módulo nunca borra datos.`}
            eyebrow="Módulos opcionales"
            id="modulos"
            title="Crece con módulos, no con otro programa"
          />
          <div className="mt-8 space-y-8">
            {CATEGORY_ORDER.map((category) => {
              const modules = MODULES.filter((manifest) => manifest.category === category);
              if (modules.length === 0) return null;
              return (
                <div key={category}>
                  <h3 className="font-mono text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">{category}</h3>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {modules.map((manifest) => (
                      <article className="flex flex-col rounded-surface border border-window-dark-shadow bg-card p-3 shadow-raised" key={manifest.id}>
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-bold">{manifest.name}</h4>
                          <p className="shrink-0 font-mono text-sm font-bold tabular-nums">+{formatEuros(MODULE_MONTHLY_CENTS[manifest.id])}<span className="text-xs font-normal text-muted-foreground">/mes</span></p>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{manifest.description}</p>
                        <ul className="mt-2 space-y-1">
                          {manifest.features.map((feature) => (
                            <li className="flex gap-1.5 text-sm" key={feature}>
                              <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-success-text" weight="bold" />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                        {manifest.dependsOn?.length ? <p className="mt-auto pt-2 text-xs text-muted-foreground">Necesita: {manifest.dependsOn.map((dep) => getModule(dep).name).join(", ")}.</p> : null}
                      </article>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Para quién */}
        <section aria-labelledby="para-quien" className="border-y border-window-dark-shadow bg-window-panel">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:py-16">
            <SectionHeading eyebrow="Para quién" id="para-quien" title="Pensado para cómo trabaja tu negocio" />
            <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {AUDIENCES.map((audience) => {
                const Icon = AUDIENCE_ICONS[audience.id as keyof typeof AUDIENCE_ICONS] ?? Package;
                return (
                  <li className="flex flex-col rounded-surface border border-window-dark-shadow bg-window-surface p-3 shadow-raised" key={audience.id}>
                    <Icon aria-hidden="true" className="size-6 text-link" weight="duotone" />
                    <h3 className="mt-2 font-mono text-sm font-bold">{audience.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-window-muted">{audience.text}</p>
                    <p className="mt-auto pt-2 text-xs text-window-muted">
                      {audience.modules.length ? `Suele añadir: ${audience.modules.map((id) => getModule(id as ModuleId).name).join(", ")}` : "Con el plan base"}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Precios */}
        <section className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <SectionHeading
            description="Un plan base con todo lo esencial y módulos sueltos. Precios al mes, sin IVA y sin permanencia."
            eyebrow="Precios"
            id="precios"
            title="Pagas por lo que usas. Nada más."
          />

          <div className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <RetroWindow as="article" elevation="featured" title={`Plan base · ${BASE_PLAN.name}`}>
              <p className="flex items-baseline gap-1">
                <span className="font-mono text-5xl font-bold tabular-nums">{formatEuros(BASE_PLAN.monthlyCents)}</span>
                <span className="text-sm text-muted-foreground">/mes + IVA</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{BASE_PLAN.description}</p>
              <ul className="mt-4 space-y-1.5">
                {BASE_PLAN.features.map((feature) => (
                  <li className="flex gap-2 text-sm leading-6" key={feature}>
                    <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-success-text" weight="bold" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Link className={buttonVariants({ size: "lg", className: "mt-5 w-full sm:w-auto" })} href="/auth/register">Empezar la prueba gratis</Link>
            </RetroWindow>

            <div className="grid gap-4">
              <RetroWindow as="article" title="Prueba gratuita">
                <ul className="space-y-1.5 text-sm leading-6">
                  <li className="flex gap-2"><Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-success-text" weight="bold" />{TRIAL_DAYS} días con <strong>todos los módulos</strong></li>
                  <li className="flex gap-2"><Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-success-text" weight="bold" />{WELCOME_OCR_CREDITS} lecturas de facturas con IA de regalo</li>
                  <li className="flex gap-2"><Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-success-text" weight="bold" />Sin tarjeta y sin compromiso</li>
                </ul>
              </RetroWindow>
              <RetroWindow as="article" title="Créditos de lectura con IA">
                <p className="text-sm leading-6 text-muted-foreground">Sube o reenvía las facturas de tus proveedores y la IA las deja listas para registrar. Pago único, sin caducidad.</p>
                <ul className="mt-3 grid gap-1.5">
                  {OCR_PACKS.map((pack) => (
                    <li className="flex items-center justify-between gap-2 rounded-control border border-window-dark-shadow bg-card px-2.5 py-1.5 shadow-sunken" key={pack.code}>
                      <span className="flex items-center gap-1.5 font-mono text-sm font-bold"><Sparkle aria-hidden="true" className="text-link" />{pack.credits.toLocaleString("es-ES")} facturas</span>
                      <span className="text-right">
                        <span className="font-mono text-sm font-bold tabular-nums">{formatEuros(pack.cents)}</span>
                        <span className="block text-xs text-muted-foreground">{formatEuros(Math.round((pack.cents / pack.credits) * 100) / 100)} por factura</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </RetroWindow>
            </div>
          </div>

          <RetroWindow as="section" className="mt-4" title="Calcula tu precio">
            <PriceCalculator />
          </RetroWindow>
        </section>

        {/* Preguntas */}
        <section aria-labelledby="preguntas" className="border-t border-window-dark-shadow bg-window-panel">
          <div className="mx-auto max-w-3xl px-4 py-14 sm:py-16">
            <SectionHeading eyebrow="Preguntas frecuentes" id="preguntas" title="Lo que suelen preguntarnos" />
            <div className="mt-6 space-y-2">
              {faqs.map((faq) => (
                <details className="group rounded-surface border border-window-dark-shadow bg-window-surface shadow-raised open:shadow-sunken" key={faq.question}>
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 font-bold [&::-webkit-details-marker]:hidden">
                    {faq.question}
                    <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center border border-window-dark-shadow bg-window-highlight font-mono text-sm shadow-raised group-open:rotate-45">+</span>
                  </summary>
                  <p className="px-3 pb-3 text-sm leading-6 text-window-muted">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Llamada final */}
        <section aria-labelledby="empieza" className="retro-checker border-t border-window-dark-shadow">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:py-16">
            <RetroWindow bodyClassName="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6" elevation="featured" title="Nuevo espacio de trabajo">
              <div>
                <h2 className="font-mono text-2xl font-bold" id="empieza">Empieza hoy, decide en {TRIAL_DAYS} días</h2>
                <p className="mt-1 text-sm text-window-muted">Crea tu cuenta en un minuto. Si no te convence, no pagas nada.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link className={buttonVariants({ size: "lg" })} href="/auth/register">Crear cuenta gratis</Link>
                <Link className={buttonVariants({ variant: "outline", size: "lg" })} href="/auth/login">Ya tengo cuenta</Link>
              </div>
            </RetroWindow>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

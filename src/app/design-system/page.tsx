import type { Metadata } from "next";
import Link from "next/link";
import { Check, Info, Receipt, Trash, Warning, X } from "@phosphor-icons/react/dist/ssr";

import { TokenValue } from "@/components/design-system/token-value";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";
import { RetroWindow } from "@/components/marketing/retro-window";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { COLOR_GROUPS, PRINCIPLES, SHADOW_TOKENS, SPACING_STEPS, TYPE_SCALE, VOICE_RULES } from "@/lib/design-system/tokens";
import { themes } from "@/lib/theme-config";

export const metadata: Metadata = {
  title: "Design system",
  description: "Sistema de diseño de Norpie: principios, color, tipografía, relieves, componentes, accesibilidad y tono.",
};

const SECTIONS = [
  { id: "principios", label: "Principios" },
  { id: "color", label: "Color" },
  { id: "tipografia", label: "Tipografía" },
  { id: "espaciado", label: "Espaciado y retícula" },
  { id: "relieve", label: "Relieve y radios" },
  { id: "iconos", label: "Iconos" },
  { id: "componentes", label: "Componentes" },
  { id: "accesibilidad", label: "Accesibilidad" },
  { id: "tono", label: "Voz y tono" },
  { id: "codigo", label: "Uso en código" },
];

function DsSection({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-b border-window-shadow py-10 last:border-b-0">
      <h2 className="scroll-mt-20 font-mono text-2xl font-bold" id={id}>{title}</h2>
      {description ? <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded-control border border-window-shadow bg-window-panel px-1 py-px font-mono text-xs">{children}</code>;
}

export default function DesignSystemPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader />

      <header className="retro-checker border-b border-window-dark-shadow">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.06em] text-link">[ Design system · v1 ]</p>
          <h1 className="mt-2 font-mono text-4xl font-bold leading-tight sm:text-5xl">Retro, claro y hecho para cifras</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            Las reglas visuales y de texto de Norpie: la aplicación, la web y cualquier pieza nueva salen de aquí. Todo lo que ves en esta página está construido con los mismos tokens y componentes que la aplicación.
          </p>
          <div className="mt-5 max-w-xs">
            <p className="mb-1 font-mono text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">Prueba los {themes.length} temas</p>
            <ThemeSwitcher />
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 lg:grid-cols-[12rem_1fr]">
        <nav aria-label="Secciones del design system" className="hidden lg:block">
          <ul className="sticky top-16 space-y-0.5 py-10">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a className="flex min-h-8 items-center px-2 text-sm text-link underline-offset-2 hover:bg-window-highlight hover:underline" href={`#${section.id}`}>{section.label}</a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0" id="contenido">
          <DsSection id="principios" title="Principios">
            <ol className="grid gap-3 md:grid-cols-2">
              {PRINCIPLES.map((principle, index) => (
                <li className="rounded-surface border border-window-dark-shadow bg-window-surface p-3 shadow-raised" key={principle.title}>
                  <p className="font-mono text-xs font-bold text-link">0{index + 1}</p>
                  <h3 className="mt-1 font-bold">{principle.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-window-muted">{principle.text}</p>
                </li>
              ))}
            </ol>
          </DsSection>

          <DsSection description="Nunca escribas un color a mano: usa el token. El valor cambia con el tema (los de abajo son los del tema activo)." id="color" title="Color">
            <div className="space-y-8">
              {COLOR_GROUPS.map((group) => (
                <div key={group.id}>
                  <h3 className="font-mono text-sm font-bold">{group.title}</h3>
                  <p className="text-sm text-muted-foreground">{group.description}</p>
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {group.tokens.map((token) => (
                      <li className="flex min-w-0 items-center gap-3 rounded-control border border-window-dark-shadow bg-card p-2 shadow-raised" key={token.name}>
                        <span
                          aria-hidden="true"
                          className="grid size-12 shrink-0 place-items-center border border-window-dark-shadow font-mono text-sm font-bold shadow-sunken"
                          style={{ background: `var(${token.name})`, color: token.pairWith ? `var(${token.pairWith})` : "transparent" }}
                        >
                          Aa
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-xs font-bold">{token.name}</span>
                          <span className="block text-xs leading-5">{token.role}</span>
                          <span className="flex flex-wrap items-center gap-x-2"><TokenValue name={token.name} /><span className="truncate font-mono text-xs text-muted-foreground">{token.utility}</span></span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </DsSection>

          <DsSection description="Dos familias: Geist Mono para títulos, rótulos y cifras (el carácter retro) y Geist Sans para leer. Texto de la app a 14 px; nunca por debajo de 12 px." id="tipografia" title="Tipografía">
            <ul className="divide-y divide-window-shadow rounded-surface border border-window-dark-shadow bg-card shadow-sunken">
              {TYPE_SCALE.map((step) => (
                <li className="grid gap-1 p-3 md:grid-cols-[10rem_1fr]" key={step.name}>
                  <div>
                    <p className="font-mono text-xs font-bold">{step.name}</p>
                    <p className="text-xs leading-5 text-muted-foreground">{step.usage}</p>
                  </div>
                  <p className={`min-w-0 break-words ${step.className}`}>{step.sample}</p>
                </li>
              ))}
            </ul>
          </DsSection>

          <DsSection description="Escala de 4 px (la de Tailwind). Contenedor de página de 72 rem (1152 px) con 16 px de margen lateral; en móvil nada provoca scroll horizontal." id="espaciado" title="Espaciado y retícula">
            <ul className="space-y-2">
              {SPACING_STEPS.map((step) => (
                <li className="grid grid-cols-[3rem_1fr] items-center gap-3 sm:grid-cols-[3rem_6rem_1fr]" key={step.name}>
                  <span className="font-mono text-xs font-bold">{step.name} · {step.px}px</span>
                  <span aria-hidden="true" className="h-4 border border-window-dark-shadow bg-primary" style={{ width: step.px }} />
                  <span className="col-span-2 text-sm text-muted-foreground sm:col-span-1">{step.usage}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm leading-6">Objetivos táctiles: los controles miden 32 px con ratón y <strong>40–44 px en pantallas táctiles</strong> (<Code>pointer-coarse:h-10</Code>).</p>
          </DsSection>

          <DsSection description="El relieve es la gramática del sistema. Esquinas casi rectas: 1 px en controles, 2 px en superficies." id="relieve" title="Relieve y radios">
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {SHADOW_TOKENS.map((shadow) => (
                <li className="flex items-center gap-3" key={shadow.name}>
                  <span aria-hidden="true" className={`size-14 shrink-0 rounded-surface border border-window-dark-shadow bg-window-surface ${shadow.utility}`} />
                  <span className="min-w-0">
                    <span className="block font-mono text-xs font-bold">{shadow.utility}</span>
                    <span className="block text-xs leading-5 text-muted-foreground">{shadow.role}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap gap-4">
              <div className="flex items-center gap-2"><span aria-hidden="true" className="size-10 rounded-control border border-window-dark-shadow bg-card" /><span className="text-sm"><Code>rounded-control</Code> 1 px · campos</span></div>
              <div className="flex items-center gap-2"><span aria-hidden="true" className="size-10 rounded-surface border border-window-dark-shadow bg-card" /><span className="text-sm"><Code>rounded-surface</Code> 2 px · botones y paneles</span></div>
            </div>
          </DsSection>

          <DsSection description="Phosphor Icons. «regular» en la interfaz, «bold» en marcas de verificación, «duotone» solo en ilustraciones grandes de la web. Siempre con texto al lado o aria-label." id="iconos" title="Iconos">
            <ul className="flex flex-wrap gap-2">
              {[
                { Icon: Receipt, label: "Receipt · regular", weight: "regular" as const },
                { Icon: Check, label: "Check · bold", weight: "bold" as const },
                { Icon: Warning, label: "Warning · regular", weight: "regular" as const },
                { Icon: Info, label: "Info · duotone", weight: "duotone" as const },
              ].map(({ Icon, label, weight }) => (
                <li className="flex items-center gap-2 rounded-control border border-window-dark-shadow bg-card px-2.5 py-2 shadow-raised" key={label}>
                  <Icon aria-hidden="true" className="size-5 text-link" weight={weight} />
                  <span className="font-mono text-xs">{label}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted-foreground">Tamaños: 14 px en botones, 16 px en listas, 20–24 px en tarjetas.</p>
          </DsSection>

          <DsSection description="Componentes de src/components/ui. Úsalos tal cual; si falta una variante, se añade al componente, no a la página." id="componentes" title="Componentes">
            <div className="space-y-6">
              <RetroWindow title="Botones · <Button variant size>">
                <div className="flex flex-wrap items-center gap-2">
                  <Button>Emitir factura</Button>
                  <Button variant="outline">Guardar borrador</Button>
                  <Button variant="secondary">Duplicar</Button>
                  <Button variant="ghost">Cancelar</Button>
                  <Button variant="destructive"><Trash aria-hidden="true" />Anular</Button>
                  <Button variant="link">Ver detalle</Button>
                  <Button disabled>Desactivado</Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="xs" variant="outline">xs</Button>
                  <Button size="sm" variant="outline">sm</Button>
                  <Button variant="outline">default</Button>
                  <Button size="lg" variant="outline">lg</Button>
                  <Button aria-label="Cerrar" size="icon" variant="outline"><X aria-hidden="true" /></Button>
                </div>
                <p className="mt-3 text-sm text-window-muted">Primario: uno por vista. Destructivo: siempre con confirmación. Texto: verbo + objeto.</p>
              </RetroWindow>

              <RetroWindow title="Etiquetas de estado · <StatusBadge tone>">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge>Borrador</StatusBadge>
                  <StatusBadge tone="info">Enviada</StatusBadge>
                  <StatusBadge tone="success">Cobrada</StatusBadge>
                  <StatusBadge tone="warning">Vence hoy</StatusBadge>
                  <StatusBadge tone="danger">Vencida</StatusBadge>
                </div>
                <p className="mt-3 text-sm text-window-muted">El color nunca va solo: la palabra dice el estado. Máximo dos palabras.</p>
              </RetroWindow>

              <RetroWindow title="Campos · <Label> + <Input>">
                <div className="grid max-w-md gap-3">
                  <div className="grid gap-1">
                    <Label htmlFor="ds-nif">NIF del cliente</Label>
                    <Input id="ds-nif" placeholder="B12345678" />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ds-importe">Importe</Label>
                    <Input aria-describedby="ds-importe-error" aria-invalid defaultValue="-12" id="ds-importe" inputMode="decimal" />
                    <p className="text-xs text-danger-text" id="ds-importe-error">El importe no puede ser negativo.</p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-window-muted">Etiqueta siempre visible encima; el error debajo, en texto, explicando cómo arreglarlo.</p>
              </RetroWindow>

              <RetroWindow title="Ventana · <RetroWindow title elevation>" titleAside={<StatusBadge className="bg-window-surface" tone="success">Nuevo</StatusBadge>}>
                <p className="text-sm leading-6">El contenedor de la web pública y de los paneles: barra de título con el color del tema, cuerpo con relieve. <Code>elevation=&quot;featured&quot;</Code> solo para la pieza principal de una vista.</p>
              </RetroWindow>

              <RetroWindow title="Datos · tabla y cifras">
                <table className="w-full border border-window-dark-shadow bg-card text-left text-sm shadow-sunken">
                  <caption className="sr-only">Ejemplo de tabla</caption>
                  <thead className="bg-window-panel font-mono text-xs text-window-muted">
                    <tr><th className="px-2 py-1.5" scope="col">Concepto</th><th className="px-2 py-1.5 text-right" scope="col">Base</th><th className="px-2 py-1.5 text-right" scope="col">IVA</th></tr>
                  </thead>
                  <tbody className="divide-y divide-window-shadow">
                    <tr><td className="px-2 py-1.5">Mantenimiento web</td><td className="px-2 py-1.5 text-right font-mono tabular-nums">1.200,00 €</td><td className="px-2 py-1.5 text-right font-mono tabular-nums">252,00 €</td></tr>
                    <tr><td className="px-2 py-1.5">Hosting anual</td><td className="px-2 py-1.5 text-right font-mono tabular-nums">90,00 €</td><td className="px-2 py-1.5 text-right font-mono tabular-nums">18,90 €</td></tr>
                  </tbody>
                </table>
                <p className="mt-3 text-sm text-window-muted">Importes a la derecha, monoespaciados, con formato es-ES y el símbolo detrás.</p>
              </RetroWindow>
            </div>
          </DsSection>

          <DsSection id="accesibilidad" title="Accesibilidad">
            <ul className="grid gap-2 sm:grid-cols-2">
              {[
                "Contraste ≥ 4,5:1 para texto y ≥ 3:1 para bordes de control, en los 8 temas.",
                "Foco de teclado siempre visible con --focus-accent (2 px, distinto del color de acción).",
                "Objetivos táctiles de 40–44 px con puntero grueso.",
                "El color nunca es la única señal: estados con texto, errores con mensaje.",
                "Respeta «reducir movimiento»: sin desplazamiento suave ni animaciones.",
                "Iconos decorativos con aria-hidden; los botones solo-icono llevan aria-label.",
              ].map((rule) => (
                <li className="flex gap-2 text-sm leading-6" key={rule}><Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-success-text" weight="bold" />{rule}</li>
              ))}
            </ul>
          </DsSection>

          <DsSection description="En español de España, cercano y concreto. Tuteo siempre." id="tono" title="Voz y tono">
            <ul className="grid gap-2">
              {VOICE_RULES.map((rule) => (
                <li className="grid gap-2 md:grid-cols-2" key={rule.do}>
                  <p className="flex gap-2 rounded-control border border-success/70 bg-success/10 p-2 text-sm text-success-text"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" weight="bold" /><span><strong>Sí.</strong> {rule.do}</span></p>
                  <p className="flex gap-2 rounded-control border border-destructive/70 bg-destructive/10 p-2 text-sm text-danger-text"><X aria-hidden="true" className="mt-0.5 size-4 shrink-0" weight="bold" /><span><strong>No.</strong> {rule.dont}</span></p>
                </li>
              ))}
            </ul>
          </DsSection>

          <DsSection id="codigo" title="Uso en código">
            <ul className="space-y-2 text-sm leading-6">
              <li>Valores de los tokens por tema: <Code>src/app/globals.css</Code>. Catálogo documentado: <Code>src/lib/design-system/tokens.ts</Code>.</li>
              <li>Componentes: <Code>src/components/ui</Code> (Button, StatusBadge, Input…) y <Code>src/components/marketing</Code> (RetroWindow, cabecera y pie públicos).</li>
              <li>Temas: <Code>src/lib/theme-config.ts</Code>. Un tema nuevo define todas las variables de <Code>:root</Code> y valida el contraste.</li>
              <li>Precios de la web: siempre desde <Code>src/lib/billing/catalog.ts</Code>, nunca escritos a mano.</li>
            </ul>
            <p className="mt-4 text-sm"><Link className="text-link underline-offset-2 hover:underline" href="/">Ver la landing construida con este sistema →</Link></p>
          </DsSection>
        </main>
      </div>

      <SiteFooter />
    </div>
  );
}

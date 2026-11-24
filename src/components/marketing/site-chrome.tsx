import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export const BRAND_NAME = "Norpie";

/** Logotipo: cuadro biselado con las iniciales y el nombre en monoespaciada. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={className ?? "flex items-center gap-2 whitespace-nowrap font-mono text-sm font-bold"}>
      <span aria-hidden="true" className="grid size-7 place-items-center border border-white/70 bg-window-highlight text-xs font-black text-window-text shadow-raised">N</span>
      {BRAND_NAME}
    </span>
  );
}

const SECTION_LINKS = [
  { href: "/#funciones", label: "Funciones" },
  { href: "/#modulos", label: "Módulos" },
  { href: "/#precios", label: "Precios" },
  { href: "/#preguntas", label: "Preguntas" },
];

/** Barra superior de las páginas públicas. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-window-dark-shadow bg-chrome-active text-chrome-active-foreground">
      <nav aria-label="Principal" className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-2 px-4">
        <Link className="flex min-h-11 shrink-0 items-center" href="/">
          <BrandMark />
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {SECTION_LINKS.map((link) => (
            <li key={link.href}>
              <Link className="inline-flex min-h-9 items-center px-2 font-mono text-xs font-bold underline-offset-4 hover:underline" href={link.href}>{link.label}</Link>
            </li>
          ))}
        </ul>
        <div className="flex shrink-0 gap-1.5">
          <Link className={buttonVariants({ variant: "outline" })} href="/auth/login">Entrar</Link>
          <Link className={buttonVariants({ variant: "outline", className: "hidden sm:inline-flex" })} href="/auth/register">Probar gratis</Link>
        </div>
      </nav>
    </header>
  );
}

/** Pie de las páginas públicas. */
export function SiteFooter() {
  return (
    <footer className="border-t border-window-dark-shadow bg-window-panel text-window-text">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-2">
          <BrandMark />
          <p className="max-w-sm text-sm leading-6 text-window-muted">Facturación, contabilidad e impuestos para autónomos, pymes, comercios y hostelería. Hecho en España.</p>
        </div>
        <FooterColumn title="Producto" links={[{ href: "/#funciones", label: "Funciones" }, { href: "/#modulos", label: "Módulos" }, { href: "/#precios", label: "Precios" }, { href: "/#preguntas", label: "Preguntas frecuentes" }]} />
        <FooterColumn title="Cuenta" links={[{ href: "/auth/register", label: "Crear cuenta" }, { href: "/auth/login", label: "Iniciar sesión" }, { href: "/asesor/acceso", label: "Portal del asesor" }, { href: "/design-system", label: "Design system" }]} />
      </div>
      <p className="border-t border-window-shadow px-4 py-3 text-center font-mono text-xs text-window-muted">© {new Date().getFullYear()} {BRAND_NAME}. Precios sin IVA.</p>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <p className="font-mono text-xs font-bold uppercase tracking-[0.06em] text-window-muted">{title}</p>
      <ul className="mt-2 space-y-1">
        {links.map((link) => (
          <li key={link.href}>
            <Link className="inline-flex min-h-8 items-center text-sm text-link underline-offset-2 hover:underline" href={link.href}>{link.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

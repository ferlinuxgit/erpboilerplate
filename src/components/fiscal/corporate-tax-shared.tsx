import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageShell } from "@/components/ui/page";

/** Selector de ejercicio de las pantallas de Sociedades (enlaces `?year=`). */
export function CorporateTaxYearNav({ basePath, current, years }: { basePath: string; current: string; years: Array<{ id: string; code: string }> }) {
  if (years.length <= 1) return null;
  return (
    <nav aria-label="Ejercicio" className="flex flex-wrap gap-1 print:hidden">
      {years.map((year) => (
        <Link
          aria-current={year.id === current ? "page" : undefined}
          className={buttonVariants({ size: "sm", variant: year.id === current ? "secondary" : "ghost" })}
          href={`${basePath}?year=${encodeURIComponent(year.id)}`}
          key={year.id}
        >
          {year.code}
        </Link>
      ))}
    </nav>
  );
}

/** Pantalla para quien no tributa por Sociedades (autónomos): explica por qué y dónde cambiarlo. */
export function CorporateTaxNotAvailable() {
  return (
    <PageShell>
      <PageHeader
        backHref="/fiscal"
        backLabel="Volver a fiscalidad"
        description="Liquidación del modelo 200 y pagos fraccionados del modelo 202."
        eyebrow="Fiscalidad"
        title="Impuesto sobre Sociedades"
      />
      <EmptyState
        action={<Link className={buttonVariants({ variant: "outline" })} href="/settings/fiscal#perfil">Abrir el perfil fiscal</Link>}
        description="Tu perfil fiscal está configurado como autónomo (persona física): tributas por el IRPF y tu pago a cuenta es el modelo 130. Si la empresa es una sociedad, cámbialo en el perfil fiscal."
        title="Solo para sociedades"
      />
    </PageShell>
  );
}

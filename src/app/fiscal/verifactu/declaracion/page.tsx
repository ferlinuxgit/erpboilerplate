import type { Metadata } from "next";

import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { formatDate } from "@/lib/format";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { DECLARATION_PENDING, getCurrentDeclaration, listDeclarations } from "@/server/verifactu/declaration";

export const metadata: Metadata = { title: "Declaración responsable · VERI*FACTU" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b py-2 text-sm last:border-b-0 md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] md:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Declaración responsable del productor del sistema informático de facturación (art. 13 del
 * RD 1007/2023 y art. 15 de la Orden HAC/1177/2024): debe constar en el propio sistema, visible
 * para el usuario. Los datos del productor los fija el administrador en la configuración.
 *
 * El título y los literales de cada apartado están en `buildDeclarationDocument`
 * (`src/server/verifactu/declaration.ts`): son los del art. 15.1 de la Orden y no se resumen ni se
 * reordenan. La versión es la del despliegue; cada versión nueva queda guardada en el histórico la
 * primera vez que se abre esta pantalla.
 */
export default async function VerifactuDeclarationPage() {
  const ctx = await requireContext("fiscal.read");
  requireCountryFeaturePage(ctx.company.countryCode, "eInvoicing");
  const declaration = await getCurrentDeclaration();
  const history = (await listDeclarations()).filter((entry) => entry.id !== declaration.id);

  return (
    <PageShell>
      <PageHeader
        eyebrow="VERI*FACTU"
        title="Declaración responsable"
        description="Declaración del productor de este programa de facturación sobre su cumplimiento de la normativa de sistemas informáticos de facturación."
        backHref="/fiscal/verifactu"
        backLabel="Volver a VERI*FACTU"
        actions={declaration.complete ? (
          <a className={buttonVariants({ variant: "outline" })} data-testid="verifactu-declaration-pdf" href="/api/verifactu/declaration" rel="noopener noreferrer" target="_blank">
            Descargar en PDF
          </a>
        ) : null}
      />

      {!declaration.complete ? (
        <InlineAlert tone="warning" title="Declaración incompleta">
          Faltan datos que debe aportar el productor del sistema: {declaration.missing.join("; ")}. Hasta que estén, la declaración no es válida.
        </InlineAlert>
      ) : null}

      <PageSection
        title={declaration.title}
        description={declaration.issuedAt ? `Versión ${declaration.version} · emitida en el sistema el ${formatDate(declaration.issuedAt)}.` : `Versión ${declaration.version}.`}
      >
        <dl>
          {declaration.rows.map((row) => (
            <Row key={row.label} label={row.label}>
              {row.value === DECLARATION_PENDING ? <span className="text-danger-text">{row.value}</span> : row.value}
            </Row>
          ))}
        </dl>
      </PageSection>

      {history.length > 0 ? (
        <PageSection title="Versiones anteriores" description="Declaraciones emitidas para versiones anteriores del sistema, tal como se mostraron entonces.">
          <ul className="divide-y text-sm" data-testid="verifactu-declaration-history">
            {history.map((entry) => (
              <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={entry.id}>
                <span>
                  <span className="font-mono font-semibold">Versión {entry.version}</span>
                  <span className="text-muted-foreground"> · emitida el {formatDate(entry.createdAt)}</span>
                </span>
                <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/verifactu/declaration?id=${encodeURIComponent(entry.id)}`} rel="noopener noreferrer" target="_blank">
                  PDF
                </a>
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}
    </PageShell>
  );
}

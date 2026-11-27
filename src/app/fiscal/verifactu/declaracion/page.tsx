import type { Metadata } from "next";

import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { getVerifactuDeclaration } from "@/server/verifactu/config";

export const metadata: Metadata = { title: "Declaración responsable · VERI*FACTU" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b py-2 text-sm last:border-b-0 md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] md:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const pending = <span className="text-danger-text">Pendiente de completar</span>;

/**
 * Declaración responsable del productor del sistema informático de facturación (art. 13 del
 * RD 1007/2023 y art. 15 de la Orden HAC/1177/2024): debe constar en el propio sistema, visible
 * para el usuario. Los datos del productor los fija el administrador en la configuración.
 *
 * El título y el texto que precede a cada dato son los literales del art. 15.1 de la Orden («cada
 * dato aportado deberá precederse del texto que lo describe, de acuerdo con lo redactado en la
 * letra con la cual se corresponde»), en su mismo orden: no los resumas ni los reordenes.
 */
export default async function VerifactuDeclarationPage() {
  const ctx = await requireContext("fiscal.read");
  requireCountryFeaturePage(ctx.company.countryCode, "eInvoicing");
  const declaration = getVerifactuDeclaration();
  const date = declaration.date ? new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${declaration.date}T00:00:00Z`)) : null;

  return (
    <PageShell>
      <PageHeader
        eyebrow="VERI*FACTU"
        title="Declaración responsable"
        description="Declaración del productor de este programa de facturación sobre su cumplimiento de la normativa de sistemas informáticos de facturación."
        backHref="/fiscal/verifactu"
        backLabel="Volver a VERI*FACTU"
      />

      {!declaration.complete ? (
        <InlineAlert tone="warning" title="Declaración incompleta">
          Faltan datos que debe aportar el productor del sistema: {declaration.missing.join("; ")}. Hasta que estén, la declaración no es válida.
        </InlineAlert>
      ) : null}

      <PageSection title="DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN">
        <dl>
          <Row label="a) Nombre del sistema informático a que se refiere la declaración responsable.">{declaration.systemName}</Row>
          <Row label="b) Código identificador del sistema informático a que se refiere el apartado 1.a), de acuerdo con las especificaciones dadas en el apartado 2.6 del anexo.">{declaration.systemId}</Row>
          <Row label="c) Identificador completo de la versión concreta del sistema informático a que se refiere la declaración responsable.">{declaration.version}</Row>
          <Row label="d) Componentes, hardware y software, de que consta el sistema informático a que se refiere la declaración responsable, junto con una breve descripción de lo que hace dicho sistema informático y de sus principales funcionalidades.">
            Aplicación web de gestión (ERP) que se usa desde el navegador, sin hardware propio: servidor de aplicación y base de datos PostgreSQL
            alojados por el productor. Funciones: emisión de facturas completas, simplificadas y rectificativas, punto de venta, contabilidad e
            impuestos. Cada factura emitida genera su registro de facturación con huella SHA-256 encadenada, lo conserva de forma inalterable,
            lo remite a la Agencia Tributaria e incorpora el código QR a la factura.
          </Row>
          <Row label="e) Indicación de si el sistema informático a que se refiere la declaración responsable se ha producido de tal manera que, a los efectos de cumplir con el Reglamento, solo pueda funcionar exclusivamente como «VERI*FACTU», de acuerdo con las especificaciones dadas en el apartado 2.6 del anexo.">{declaration.onlyVerifactu ? "Sí. El sistema funciona exclusivamente en la modalidad VERI*FACTU (remisión de todos los registros a la AEAT)." : "No."}</Row>
          <Row label="f) Indicación de si el sistema informático a que se refiere la declaración responsable permite ser usado por varios obligados tributarios o por un mismo usuario para dar soporte a la facturación de varios obligados tributarios, de acuerdo con las especificaciones dadas en el apartado 2.6 del anexo.">{declaration.multiTaxpayer ? "Sí. Cada empresa tiene su propia cadena de registros, separada de las demás." : "No."}</Row>
          <Row label="g) Tipos de firma utilizados para firmar los registros de facturación y de evento en el caso de que el sistema informático a que se refiere la declaración responsable no sea utilizado como «VERI*FACTU».">
            Al funcionar exclusivamente como VERI*FACTU, los registros de facturación no se firman electrónicamente: su autenticidad se garantiza con la
            remisión a la AEAT mediante certificado electrónico cualificado. No se genera registro de eventos firmado.
          </Row>
          <Row label="h) Nombre y apellidos de la persona o razón social de la entidad productora del sistema informático a que se refiere la declaración responsable.">{declaration.producerName || pending}</Row>
          <Row label="i) Número de identificación fiscal (NIF) español de la persona o entidad productora del sistema informático a que se refiere la declaración responsable.">{declaration.producerNif || pending}</Row>
          <Row label="j) Dirección postal completa de contacto de la persona o entidad productora del sistema informático a que se refiere la declaración responsable.">{declaration.producerAddress ?? pending}</Row>
          <Row label="k) La persona o entidad productora del sistema informático a que se refiere la declaración responsable hace constar lo siguiente.">
            Que dicho sistema informático, en la versión indicada en esta declaración, cumple con lo dispuesto en el artículo 29.2.j) de la
            Ley 58/2003, de 17 de diciembre, General Tributaria, en el Reglamento que establece los requisitos que deben adoptar los sistemas y
            programas informáticos o electrónicos que soporten los procesos de facturación de empresarios y profesionales, y la estandarización
            de formatos de los registros de facturación, aprobado por el Real Decreto 1007/2023, de 5 de diciembre, en la Orden HAC/1177/2024,
            de 17 de octubre, y en la sede electrónica de la Agencia Estatal de Administración Tributaria para todo aquello que complete las
            especificaciones de dicha orden.
          </Row>
          <Row label="l) Fecha y lugar en los que la persona o entidad productora del sistema informático suscribe la declaración responsable del mismo.">{date && declaration.place ? `${date}, en ${declaration.place}` : pending}</Row>
        </dl>
      </PageSection>
    </PageShell>
  );
}

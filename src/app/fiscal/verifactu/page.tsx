import type { Metadata } from "next";
import Link from "next/link";

import { VerifactuActions } from "@/components/fiscal/verifactu-actions";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, InlineAlert, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { MobileRecord, MobileRecordField, MobileRecordFields, MobileRecordList, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { formatCount } from "@/lib/pluralize";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { verifactuInvoiceTypeLabels } from "@/server/verifactu/mapping";
import { getVerifactuOverview, verifactuStatusLabels, verifactuStatusTone } from "@/server/verifactu/service";

export const metadata: Metadata = { title: "VERI*FACTU" };

const eventLabels: Record<string, string> = {
  SYSTEM_START: "Inicio",
  MODE_CHANGED: "Cambio de modo",
  CHAIN_VERIFIED: "Verificación correcta",
  ANOMALY_DETECTED: "Anomalía",
  EXPORT: "Exportación",
  SUBMISSION: "Envío AEAT",
  SUBMISSION_ERROR: "Error de envío",
};

const modeLabels = { pending: "Sin activar", verifactu: "VERI*FACTU", non_verifactu: "NO VERI*FACTU" } as const;

type VerifactuRecordRow = Awaited<ReturnType<typeof getVerifactuOverview>>["records"][number];

function recordTypeLabel(record: VerifactuRecordRow) {
  return record.recordType === "ANULACION" ? "Anulación" : verifactuInvoiceTypeLabels[record.invoiceTypeCode ?? ""] ?? record.invoiceTypeCode;
}

function aeatErrorText(record: VerifactuRecordRow) {
  return `${record.aeatErrorCode ? `${record.aeatErrorCode}: ` : ""}${record.aeatErrorMessage ?? ""}`;
}

export default async function VerifactuPage() {
  const ctx = await requireContext("fiscal.read");
  const overview = await getVerifactuOverview(ctx.company.id);
  const canWrite = can(ctx.membership.role, "fiscal.write");
  const pending = overview.counts.PENDING_SEND ?? 0;
  const rejected = overview.counts.REJECTED ?? 0;
  const accepted = (overview.counts.ACCEPTED ?? 0) + (overview.counts.ACCEPTED_WITH_ERRORS ?? 0);
  const active = overview.settings.mode !== "pending";

  return (
    <PageShell>
      <PageHeader
        eyebrow="Fiscalidad"
        title="VERI*FACTU"
        description="Registro inalterable de tus facturas (Ley Antifraude). Cada factura emitida genera un registro con una huella encadenada a la anterior."
        backHref="/fiscal"
        backLabel="Volver a fiscalidad"
        meta={<StatusBadge tone={overview.settings.mode === "verifactu" ? "success" : active ? "info" : "warning"}>{modeLabels[overview.settings.mode]}</StatusBadge>}
        actions={<Link className={buttonVariants({ variant: "outline" })} href="/fiscal/settings">Configurar</Link>}
      />

      {!active ? (
        <InlineAlert tone="warning" title="VERI*FACTU no está activado">
          Tus facturas todavía no generan registros de facturación. Actívalo en{" "}
          <Link className="font-bold text-link underline underline-offset-2" href="/fiscal/settings">Fiscalidad › Configuración</Link> antes de la fecha en la que te sea obligatorio
          (según el calendario vigente, a partir de 2027 para la mayoría de empresas y autónomos; confírmalo con tu asesor).
        </InlineAlert>
      ) : null}

      {overview.settings.mode === "verifactu" && !overview.transport.enabled ? (
        <InlineAlert tone="info" title="Registros guardados, envío pendiente de configurar">
          Tus facturas ya se registran con su huella y su QR, y quedan <strong>pendientes de envío</strong>. Para enviarlas a la AEAT
          el administrador del sistema debe instalar el certificado electrónico (ver documentación de despliegue). Mientras tanto no
          se pierde nada: se enviarán todas, en orden, en cuanto se configure. Motivo: {overview.transport.reason}
        </InlineAlert>
      ) : null}

      {rejected > 0 ? (
        <InlineAlert tone="danger" title={`${formatCount(rejected, "registro rechazado", "registros rechazados")} por la AEAT`}>
          Revisa el motivo en la tabla. Normalmente se debe a datos del cliente (NIF) o de la empresa. Corrige el dato y emite una rectificativa si procede.
        </InlineAlert>
      ) : null}

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Registros" value={overview.totalRecords} helper={`Entorno AEAT: ${overview.environment === "production" ? "producción" : "pruebas"}`} />
        <MetricCard label="Pendientes de envío" value={pending} helper={overview.transport.enabled ? "Se envían automáticamente" : "Envío sin configurar"} tone={pending > 0 ? "warning" : "success"} />
        <MetricCard label="Aceptados por la AEAT" value={accepted} tone={accepted > 0 ? "success" : "neutral"} />
        <MetricCard
          label="Integridad"
          value={overview.lastVerification ? (overview.lastVerification.eventType === "CHAIN_VERIFIED" ? "Correcta" : "Revisar") : "Sin verificar"}
          helper={overview.lastVerification ? `Última: ${formatDateTime(overview.lastVerification.createdAt)}` : "Pulsa «Verificar integridad»"}
          tone={overview.lastVerification?.eventType === "ANOMALY_DETECTED" ? "danger" : overview.lastVerification ? "success" : "neutral"}
        />
      </section>

      <PageSection title="Acciones" description="Comprueba que ningún registro se ha alterado y descarga la copia de tus registros para tu asesor o una inspección.">
        <VerifactuActions canWrite={canWrite} pendingCount={pending} transportEnabled={overview.transport.enabled} />
      </PageSection>

      <PageSection title="Últimos registros" description="Cada fila es un registro de facturación. La huella enlaza con la del registro anterior.">
        {overview.records.length === 0 ? (
          <EmptyState title="Todavía no hay registros" description={active ? "Se crearán al emitir la próxima factura." : "Activa VERI*FACTU para empezar a registrar tus facturas."} />
        ) : (
          <>
          <TableContainer className="hidden md:block">
            <Table className="min-w-[44rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>N.º</TableHead>
                  <TableHead>Factura</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                  <TableHead>Huella</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-mono">{record.sequence}</TableCell>
                    <TableCell>
                      <Link className="font-mono font-semibold text-link hover:underline" href={`/invoices/${record.invoiceId}`}>{record.invoiceNumber}</Link>
                      <span className="block text-xs text-muted-foreground">{record.invoiceIssueDate} · generado {formatDate(record.generatedAt)}</span>
                    </TableCell>
                    <TableCell className="text-xs">{recordTypeLabel(record)}</TableCell>
                    <TableCell className="text-right font-mono">{record.totalAmount ? formatMoney(record.totalAmount, ctx.company.baseCurrencyCode) : "—"}</TableCell>
                    <TableCell className="font-mono text-xs" title={record.hash}>{record.hash.slice(0, 12)}…</TableCell>
                    <TableCell>
                      <StatusBadge tone={verifactuStatusTone[record.status] ?? "neutral"}>{verifactuStatusLabels[record.status] ?? record.status}</StatusBadge>
                      {record.aeatErrorMessage ? <span className="mt-1 block max-w-xs text-xs text-muted-foreground">{aeatErrorText(record)}</span> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <MobileRecordList aria-label="Últimos registros">
            {overview.records.map((record) => (
              <MobileRecord
                aside={<StatusBadge tone={verifactuStatusTone[record.status] ?? "neutral"}>{verifactuStatusLabels[record.status] ?? record.status}</StatusBadge>}
                key={record.id}
                title={<Link className="font-mono text-link hover:underline" href={`/invoices/${record.invoiceId}`}>{record.invoiceNumber}</Link>}
              >
                <MobileRecordFields>
                  <MobileRecordField label="N.º" numeric>{record.sequence}</MobileRecordField>
                  <MobileRecordField label="Tipo">{recordTypeLabel(record)}</MobileRecordField>
                  <MobileRecordField label="Importe" numeric>{record.totalAmount ? formatMoney(record.totalAmount, ctx.company.baseCurrencyCode) : "—"}</MobileRecordField>
                  <MobileRecordField label="Fecha factura">{record.invoiceIssueDate}</MobileRecordField>
                  <MobileRecordField label="Generado">{formatDate(record.generatedAt)}</MobileRecordField>
                  <MobileRecordField label="Huella"><span title={record.hash}>{record.hash.slice(0, 12)}…</span></MobileRecordField>
                </MobileRecordFields>
                {record.aeatErrorMessage ? <p className="mt-2 border-t border-window-shadow pt-2 text-danger-text">{aeatErrorText(record)}</p> : null}
              </MobileRecord>
            ))}
          </MobileRecordList>
          </>
        )}
      </PageSection>

      <PageSection title="Registro de eventos" description="Anotaciones automáticas del sistema: activación, verificaciones, exportaciones y envíos.">
        {overview.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin eventos todavía.</p>
        ) : (
          <div className="divide-y border-y">
            {overview.events.map((event) => (
              <div className="grid gap-2 py-2 text-sm md:grid-cols-[160px_160px_minmax(0,1fr)]" key={event.id}>
                <span className="text-muted-foreground">{formatDateTime(event.createdAt)}</span>
                <StatusBadge tone={event.eventType === "ANOMALY_DETECTED" || event.eventType === "SUBMISSION_ERROR" ? "danger" : event.eventType === "CHAIN_VERIFIED" ? "success" : "info"}>
                  {eventLabels[event.eventType] ?? event.eventType}
                </StatusBadge>
                <span>{event.description}</span>
              </div>
            ))}
          </div>
        )}
      </PageSection>
    </PageShell>
  );
}

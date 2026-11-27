import type { Metadata } from "next";
import Link from "next/link";

import { SiiActions, SiiResendButton, SiiSinceForm } from "@/components/fiscal/sii-actions";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, InlineAlert, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { MobileRecord, MobileRecordField, MobileRecordFields, MobileRecordList, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { formatDateTime, formatMoney } from "@/lib/format";
import { formatCount } from "@/lib/pluralize";
import { can } from "@/lib/rbac";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { siiEnvironmentLabels } from "@/server/sii/config";
import { getSiiOverview, siiBookLabels, siiOperationLabels, siiStatusLabels, siiStatusTone, type SiiRecordView } from "@/server/sii/service";

export const metadata: Metadata = { title: "SII" };

const invoiceHref = (record: SiiRecordView) => (record.book === "ISSUED" ? `/invoices/${record.sourceId}` : `/expenses/${record.sourceId}`);

function deadlineText(record: SiiRecordView) {
  if (!record.dueLabel) return "Sin plazo propio";
  if (record.deadline === "overdue") return `Venció el ${record.dueLabel}`;
  return `Vence el ${record.dueLabel}`;
}

function DeadlineCell({ record }: { record: SiiRecordView }) {
  if (!record.dueLabel) return <span className="text-xs text-muted-foreground">Sin plazo propio</span>;
  if (record.deadline === "overdue") return <StatusBadge tone="danger">{deadlineText(record)}</StatusBadge>;
  if (record.deadline === "due-soon") return <StatusBadge tone="warning">{deadlineText(record)}</StatusBadge>;
  return <span className="font-mono text-sm">{deadlineText(record)}</span>;
}

/** Lo que impide o retrasa el envío de un registro pendiente, en una frase. */
function pendingNote(record: SiiRecordView) {
  if (record.blockedReason) return `No se puede enviar todavía: ${record.blockedReason}`;
  if (record.status === "SENT") return record.aeatErrorMessage;
  if (record.sendFailed) return `Último intento fallido (${formatCount(record.attempts, "intento")}): ${record.aeatErrorMessage ?? ""}${record.nextAttemptAt ? ` Próximo intento: ${formatDateTime(record.nextAttemptAt)}.` : ""}`;
  return null;
}

const errorText = (record: SiiRecordView) => `${record.aeatErrorCode ? `${record.aeatErrorCode}: ` : ""}${record.aeatErrorMessage ?? ""}`;

function InvoiceCell({ record }: { record: SiiRecordView }) {
  return (
    <>
      <Link className="font-mono font-semibold text-link hover:underline" href={invoiceHref(record)}>{record.invoiceNumber}</Link>
      <span className="block text-xs text-muted-foreground">
        {siiBookLabels[record.book]} · {record.invoiceDate.replaceAll("-", "/")}{record.counterpartyName ? ` · ${record.counterpartyName}` : ""}
      </span>
    </>
  );
}

export default async function SiiPage() {
  const ctx = await requireContext("fiscal.read");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  const overview = await getSiiOverview(ctx.company.id);
  const canWrite = can(ctx.membership.role, "fiscal.write");
  const currency = ctx.company.baseCurrencyCode;
  const money = (value: string | null) => (value ? formatMoney(value, currency) : "—");
  const { eligibility } = overview;
  const sendable = overview.pending.filter((record) => record.status === "PENDING" && !record.blockedReason).length;
  const accepted = (overview.counts.ACCEPTED ?? 0) + (overview.counts.ACCEPTED_WITH_ERRORS ?? 0);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Fiscalidad"
        title="SII · Suministro Inmediato de Información"
        description="Envío a la Agencia Tributaria del detalle de tus facturas emitidas y recibidas, en un plazo de cuatro días hábiles."
        backHref="/fiscal"
        backLabel="Volver a fiscalidad"
        meta={(
          <>
            <StatusBadge tone={eligibility.supported ? "success" : eligibility.enabled ? "danger" : "neutral"}>{eligibility.supported ? "Activado" : eligibility.enabled ? "Activado, sin servicio" : "Sin activar"}</StatusBadge>
            {eligibility.enabled && overview.environment === "test" ? <StatusBadge tone="warning">ENTORNO DE PRUEBAS</StatusBadge> : null}
          </>
        )}
        actions={<Link className={buttonVariants({ variant: "outline" })} href="/settings/fiscal">Configuración fiscal</Link>}
      />

      {!eligibility.enabled ? (
        <>
          <InlineAlert tone="info" title="El SII no está activado en esta empresa">
            El SII es obligatorio para las empresas que liquidan el IVA cada mes: grandes empresas (más de 6.010.121,04 € de facturación), grupos de IVA
            y las inscritas en el registro de devolución mensual (REDEME). El resto puede acogerse de forma voluntaria. Si es tu caso, márcalo en{" "}
            <Link className="font-bold text-link underline underline-offset-2" href="/settings/fiscal">Configuración › Fiscalidad</Link>. Mientras no lo actives, aquí no se envía nada.
          </InlineAlert>
          <EmptyState title="Nada que mostrar" description="Activa el SII en la configuración fiscal para empezar a suministrar tus facturas." />
        </>
      ) : (
        <>
          <InlineAlert tone="info" title="Con el SII dejas de presentar los modelos 347 y 390 y de llevar los libros registro aparte">
            Quien está en el SII lleva los libros registro de IVA a través de la sede de la Agencia Tributaria con estos envíos, y queda exonerado de la
            declaración anual de operaciones con terceros (modelo 347) y del resumen anual de IVA (modelo 390). El modelo 303 se sigue presentando, cada mes.
            Esta aplicación sigue ofreciendo el 347 y el 390 en Fiscalidad por si los necesitas como comprobación: no los presentes si estás en el SII.
          </InlineAlert>

          {!eligibility.supported ? <InlineAlert tone="danger" title="El SII está activado, pero no se puede suministrar">{eligibility.reason}</InlineAlert> : null}
          {overview.environmentProblem ? <InlineAlert tone="danger" title="Falta configurar el entorno de la AEAT">{overview.environmentProblem} Mientras tanto no se crea ni se envía ningún registro. Avisa al administrador del sistema.</InlineAlert> : null}
          {eligibility.supported && !overview.environmentProblem && !overview.transport.enabled ? (
            <InlineAlert tone="warning" title="El envío a la AEAT no está conectado">
              {overview.transport.reason} Las facturas se van preparando en la bandeja de salida, con su plazo, pero no salen. Avisa al administrador del sistema.
            </InlineAlert>
          ) : null}
          {eligibility.supported && overview.transport.enabled && !overview.certificate && !overview.transport.systemCertificate ? (
            <InlineAlert tone="danger" title="Falta el certificado electrónico">
              El SII se envía con el certificado electrónico de la empresa (el mismo que usa VERI*FACTU). Súbelo en{" "}
              <Link className="font-bold text-link underline underline-offset-2" href="/settings/fiscal#verifactu">Configuración › Fiscalidad</Link>.
            </InlineAlert>
          ) : null}
          {overview.certificate?.expired ? (
            <InlineAlert tone="danger" title="El certificado electrónico ha caducado">
              No se puede enviar nada hasta que subas uno vigente en <Link className="font-bold text-link underline underline-offset-2" href="/settings/fiscal#verifactu">Configuración › Fiscalidad</Link>.
            </InlineAlert>
          ) : null}
          {overview.environment === "test" && overview.transport.enabled ? (
            <InlineAlert tone="warning" title="Entorno de pruebas de la AEAT">Lo que se envía desde este servidor va al entorno de pruebas: no tiene validez fiscal y Hacienda no lo recibe como suministro real.</InlineAlert>
          ) : null}
          {overview.otherEnvironmentCount > 0 ? (
            <InlineAlert tone="info" title="Hay registros de otro entorno">
              {formatCount(overview.otherEnvironmentCount, "registro")} de esta empresa {overview.otherEnvironmentCount === 1 ? "pertenece" : "pertenecen"} al otro entorno de la AEAT y no se {overview.otherEnvironmentCount === 1 ? "muestra" : "muestran"} ni se {overview.otherEnvironmentCount === 1 ? "envía" : "envían"} desde aquí.
            </InlineAlert>
          ) : null}
          {overview.overdue.length > 0 ? (
            <InlineAlert tone="danger" title={`${formatCount(overview.overdue.length, "factura fuera de plazo", "facturas fuera de plazo")}`}>
              El plazo legal es de cuatro días hábiles desde la expedición (emitidas) o desde el registro contable (recibidas). Envíalas cuanto antes:
              el retraso se sanciona con el 0,5 % del importe de la factura, con un mínimo de 300 € y un máximo de 6.000 € por trimestre.
              {" "}Facturas: {overview.overdue.slice(0, 8).map((record) => record.invoiceNumber).join(", ")}{overview.overdue.length > 8 ? "…" : ""}.
            </InlineAlert>
          ) : null}

          <section className="grid gap-3 md:grid-cols-4">
            <MetricCard label="Pendientes de envío" value={overview.pending.length} helper={overview.transport.enabled ? "Se envían automáticamente" : "Envío sin conectar"} tone={overview.pending.length > 0 ? "warning" : "success"} />
            <MetricCard label="Fuera de plazo" value={overview.overdue.length} helper="Sin aceptar y con el plazo vencido" tone={overview.overdue.length > 0 ? "danger" : "success"} />
            <MetricCard label="Rechazadas o con errores" value={overview.rejected.length} helper="Necesitan tu atención" tone={overview.rejected.length > 0 ? "danger" : "success"} />
            <MetricCard label="Aceptadas por la AEAT" value={accepted} helper={`Entorno: ${overview.environment ? siiEnvironmentLabels[overview.environment] : "sin configurar"}`} tone={accepted > 0 ? "success" : "neutral"} />
          </section>

          <PageSection
            title="Acciones"
            description={`Las facturas se revisan y se envían solas cada pocos minutos.${overview.lastDetectionAt ? ` Última revisión: ${formatDateTime(overview.lastDetectionAt)}.` : " Todavía no se ha hecho ninguna revisión."}`}
          >
            <div className="space-y-4">
              <SiiActions canWrite={canWrite && eligibility.supported} sendableCount={sendable} transportEnabled={overview.transport.enabled} />
              {canWrite && eligibility.supported ? (
                <div>
                  <SiiSinceForm since={overview.sinceKey} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Por defecto, el 1 de enero del año en que activas el SII: los libros del SII abarcan el año natural completo. Las facturas anteriores a esta fecha no se envían.
                  </p>
                </div>
              ) : null}
            </div>
          </PageSection>

          <PageSection title="Rechazadas y aceptadas con errores" description="Corrige el dato en la factura (o en la ficha del cliente o proveedor): se volverá a enviar sola. Si el dato ya era correcto, pulsa «Reenviar».">
            {overview.rejected.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ninguna factura rechazada.</p>
            ) : (
              <>
                <TableContainer className="hidden md:block">
                  <Table className="min-w-[48rem]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Factura</TableHead>
                        <TableHead>Comunicación</TableHead>
                        <TableHead className="text-right">Importe</TableHead>
                        <TableHead>Estado y error de la AEAT</TableHead>
                        <TableHead>Plazo</TableHead>
                        <TableHead><span className="sr-only">Acciones</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.rejected.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell><InvoiceCell record={record} /></TableCell>
                          <TableCell className="text-xs">{siiOperationLabels[record.operation]} · {record.fiscalYear}/{record.period}</TableCell>
                          <TableCell className="text-right font-mono">{money(record.totalAmount)}</TableCell>
                          <TableCell>
                            <StatusBadge tone={siiStatusTone[record.status]}>{siiStatusLabels[record.status]}</StatusBadge>
                            <span className="mt-1 block max-w-md text-xs text-danger-text">{errorText(record)}</span>
                          </TableCell>
                          <TableCell><DeadlineCell record={record} /></TableCell>
                          <TableCell>{canWrite ? <SiiResendButton invoiceNumber={record.invoiceNumber} recordId={record.id} /> : null}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <MobileRecordList aria-label="Rechazadas y aceptadas con errores">
                  {overview.rejected.map((record) => (
                    <MobileRecord aside={<StatusBadge tone={siiStatusTone[record.status]}>{siiStatusLabels[record.status]}</StatusBadge>} key={record.id} title={<Link className="font-mono text-link hover:underline" href={invoiceHref(record)}>{record.invoiceNumber}</Link>}>
                      <MobileRecordFields>
                        <MobileRecordField label="Libro">{siiBookLabels[record.book]}</MobileRecordField>
                        <MobileRecordField label="Comunicación">{siiOperationLabels[record.operation]}</MobileRecordField>
                        <MobileRecordField label="Importe" numeric>{money(record.totalAmount)}</MobileRecordField>
                        <MobileRecordField label="Plazo">{deadlineText(record)}</MobileRecordField>
                      </MobileRecordFields>
                      <p className="mt-2 border-t border-window-shadow pt-2 text-danger-text">{errorText(record)}</p>
                      {canWrite ? <div className="mt-2"><SiiResendButton invoiceNumber={record.invoiceNumber} recordId={record.id} /></div> : null}
                    </MobileRecord>
                  ))}
                </MobileRecordList>
              </>
            )}
          </PageSection>

          <PageSection title="Pendientes de envío" description="Bandeja de salida, ordenada por plazo. Las altas llevan su fecha límite; las modificaciones y las bajas no tienen plazo propio.">
            {overview.pending.length === 0 ? (
              <EmptyState title="No hay nada pendiente" description="Todas las facturas del periodo están comunicadas." />
            ) : (
              <>
                <TableContainer className="hidden md:block">
                  <Table className="min-w-[44rem]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Factura</TableHead>
                        <TableHead>Comunicación</TableHead>
                        <TableHead className="text-right">Importe</TableHead>
                        <TableHead>Plazo</TableHead>
                        <TableHead>Situación</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.pending.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell><InvoiceCell record={record} /></TableCell>
                          <TableCell className="text-xs">{siiOperationLabels[record.operation]} · {record.fiscalYear}/{record.period}</TableCell>
                          <TableCell className="text-right font-mono">{money(record.totalAmount)}</TableCell>
                          <TableCell><DeadlineCell record={record} /></TableCell>
                          <TableCell>
                            <StatusBadge tone={record.blockedReason ? "danger" : siiStatusTone[record.status]}>{record.blockedReason ? "Bloqueada" : siiStatusLabels[record.status]}</StatusBadge>
                            {pendingNote(record) ? <span className="mt-1 block max-w-md text-xs text-muted-foreground">{pendingNote(record)}</span> : null}
                            {canWrite && (record.status === "SENT" || (record.sendFailed && record.nextAttemptAt)) ? (
                              <span className="mt-1 block"><SiiResendButton invoiceNumber={record.invoiceNumber} label={record.status === "SENT" ? "Reenviar" : "Reintentar ya"} recordId={record.id} /></span>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <MobileRecordList aria-label="Pendientes de envío">
                  {overview.pending.map((record) => (
                    <MobileRecord
                      aside={<StatusBadge tone={record.blockedReason ? "danger" : siiStatusTone[record.status]}>{record.blockedReason ? "Bloqueada" : siiStatusLabels[record.status]}</StatusBadge>}
                      key={record.id}
                      title={<Link className="font-mono text-link hover:underline" href={invoiceHref(record)}>{record.invoiceNumber}</Link>}
                    >
                      <MobileRecordFields>
                        <MobileRecordField label="Libro">{siiBookLabels[record.book]}</MobileRecordField>
                        <MobileRecordField label="Comunicación">{siiOperationLabels[record.operation]}</MobileRecordField>
                        <MobileRecordField label="Importe" numeric>{money(record.totalAmount)}</MobileRecordField>
                        <MobileRecordField label="Plazo">{deadlineText(record)}</MobileRecordField>
                      </MobileRecordFields>
                      {pendingNote(record) ? <p className="mt-2 border-t border-window-shadow pt-2 text-muted-foreground">{pendingNote(record)}</p> : null}
                      {canWrite && (record.status === "SENT" || (record.sendFailed && record.nextAttemptAt)) ? (
                        <div className="mt-2"><SiiResendButton invoiceNumber={record.invoiceNumber} label={record.status === "SENT" ? "Reenviar" : "Reintentar ya"} recordId={record.id} /></div>
                      ) : null}
                    </MobileRecord>
                  ))}
                </MobileRecordList>
              </>
            )}
          </PageSection>

          <PageSection
            title="Últimas aceptadas"
            description={overview.acceptedTotal > overview.accepted.length ? `Se muestran las ${overview.accepted.length} más recientes de ${overview.acceptedTotal}. La descarga CSV las incluye todas.` : "Comunicaciones aceptadas por la AEAT, con su código seguro de verificación (CSV)."}
          >
            {overview.accepted.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay ninguna comunicación aceptada.</p>
            ) : (
              <>
                <TableContainer className="hidden md:block">
                  <Table className="min-w-[44rem]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Factura</TableHead>
                        <TableHead>Comunicación</TableHead>
                        <TableHead className="text-right">Importe</TableHead>
                        <TableHead>Enviada</TableHead>
                        <TableHead>CSV de la AEAT</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.accepted.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell><InvoiceCell record={record} /></TableCell>
                          <TableCell className="text-xs">{siiOperationLabels[record.operation]} · {record.fiscalYear}/{record.period}</TableCell>
                          <TableCell className="text-right font-mono">{money(record.totalAmount)}</TableCell>
                          <TableCell className="text-xs">{record.sentAt ? formatDateTime(record.sentAt) : "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{record.aeatCsv ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <MobileRecordList aria-label="Últimas aceptadas">
                  {overview.accepted.map((record) => (
                    <MobileRecord aside={<StatusBadge tone="success">{siiOperationLabels[record.operation]}</StatusBadge>} key={record.id} title={<Link className="font-mono text-link hover:underline" href={invoiceHref(record)}>{record.invoiceNumber}</Link>}>
                      <MobileRecordFields>
                        <MobileRecordField label="Libro">{siiBookLabels[record.book]}</MobileRecordField>
                        <MobileRecordField label="Importe" numeric>{money(record.totalAmount)}</MobileRecordField>
                        <MobileRecordField label="Enviada">{record.sentAt ? formatDateTime(record.sentAt) : "—"}</MobileRecordField>
                        <MobileRecordField label="CSV">{record.aeatCsv ?? "—"}</MobileRecordField>
                      </MobileRecordFields>
                    </MobileRecord>
                  ))}
                </MobileRecordList>
              </>
            )}
          </PageSection>

          <PageSection title="Qué se envía y qué no" description="Para que sepas hasta dónde llega esta pantalla.">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>Se envían los libros de <strong>facturas expedidas</strong> y de <strong>facturas recibidas</strong>: altas, modificaciones y bajas.</li>
              <li>No se envían todavía el libro de bienes de inversión (anual), el de determinadas operaciones intracomunitarias, los cobros en metálico de más de 6.000 € ni los cobros y pagos del criterio de caja. Si te afectan, comunícalos desde la sede de la Agencia Tributaria.</li>
              <li>Las importaciones se envían con su DUA: anota el número y la fecha del DUA en la factura de compra.</li>
              <li>Los festivos que no cuentan para el plazo son los nacionales; los autonómicos y locales sí cuentan.</li>
            </ul>
          </PageSection>
        </>
      )}
    </PageShell>
  );
}

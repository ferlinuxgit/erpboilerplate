import Link from "next/link";

import { EInvoiceDownloadButton } from "@/components/invoices/einvoice-actions";
import { EInvoiceFaceActions } from "@/components/invoices/einvoice-face-actions";
import { EInvoiceStatusForm } from "@/components/invoices/einvoice-status-form";
import { InlineAlert, PageSection } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Dir3Codes } from "@/server/einvoice/dir3";
import { faceCancellationLabels, faceEnvironmentLabels, faceProcessingLabels } from "@/server/einvoice/face";
import { getEInvoiceOverview, type EInvoiceFormat } from "@/server/einvoice/service";
import { EINVOICE_STATUSES, einvoiceRejectionLabels, einvoiceStatusLabels, type EInvoiceRejectionCode, type EInvoiceStatus } from "@/server/einvoice/status";
import { civilDateKey } from "@/server/invoices/issue-checks";

const statusTone: Record<EInvoiceStatus, "neutral" | "info" | "success" | "danger"> = {
  SENT: "neutral",
  RECEIVED: "info",
  ACCEPTED: "info",
  REJECTED: "danger",
  PAID: "success",
};

function ProblemList({ items }: { items: string[] }) {
  return items.length === 1 ? <>{items[0]}</> : <ul className="list-disc space-y-1 pl-4">{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

const formatLabels: Record<EInvoiceFormat, string> = { FACTURAE: "Facturae", UBL: "UBL", UBL_AEAT: "UBL de la AEAT" };

function dir3Summary(codes: Dir3Codes) {
  return [
    codes.accountingOffice ? `oficina contable ${codes.accountingOffice}` : null,
    codes.managingBody ? `órgano gestor ${codes.managingBody}` : null,
    codes.processingUnit ? `unidad tramitadora ${codes.processingUnit}` : null,
    codes.proposingBody ? `órgano proponente ${codes.proposingBody}` : null,
  ].filter(Boolean).join(", ");
}

const isoDate = (value: string) => formatDate(`${value}T00:00:00Z`);

/**
 * Factura electrónica en la ficha de una factura emitida: descarga de Facturae (firmada o sin
 * firmar) y de UBL, avisos de lo que falta, ficheros ya generados y registro de estados.
 * No se pinta nada si la empresa no tiene ninguno de los formatos (por territorio fiscal).
 */
export async function EInvoiceCard({ companyId, invoiceId, canManage }: { companyId: string; invoiceId: string; canManage: boolean }) {
  const overview = await getEInvoiceOverview(companyId, invoiceId);
  if (!overview || (!overview.availability.facturae && !overview.availability.ubl)) return null;
  const { availability, certificate, facturae, ubl, ublAeat, documents, statuses, summary, faceConfig } = overview;
  const facturaeReady = facturae.problems.length === 0;
  const signedCopy = documents.find((document) => document.format === "FACTURAE" && document.signed);
  const face = signedCopy?.face ?? null;
  // Estados que aún tiene sentido anotar (la validación completa la hace el servidor).
  const availableStatuses = EINVOICE_STATUSES.filter((status) => {
    if (status === "SENT") return !summary.sentOn;
    if (status === "RECEIVED") return !summary.receivedOn;
    if (status === "ACCEPTED") return summary.commercial?.status !== "ACCEPTED";
    if (status === "PAID") return !summary.paidOn && summary.commercial?.status !== "REJECTED";
    return true;
  });

  return (
    <PageSection
      data-testid="einvoice-card"
      description="Fichero estructurado de esta factura para presentarlo en FACe (Administraciones públicas) o entregarlo a otra empresa."
      title="Factura electrónica"
    >
      <div className="space-y-5 text-sm">
        {availability.facturae ? (
          <div className="space-y-2" data-testid="einvoice-facturae">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wide">Factura electrónica (Facturae 3.2.2)</h3>
            <p className="text-xs text-muted-foreground">
              Es el formato que exigen las Administraciones públicas españolas. Para FACe tiene que ir firmada con el certificado electrónico de la empresa.
            </p>
            {!facturaeReady ? (
              <InlineAlert title="Faltan datos para generar el Facturae" tone="danger"><ProblemList items={facturae.problems} /></InlineAlert>
            ) : null}
            {facturaeReady && facturae.warnings.length > 0 ? (
              <InlineAlert title="Revisa antes de presentarla" tone="warning"><ProblemList items={facturae.warnings} /></InlineAlert>
            ) : null}
            {facturaeReady && !certificate.available && certificate.message ? (
              <InlineAlert title="No se puede firmar desde aquí" tone="warning">
                {certificate.message}{" "}
                <Link className="text-link underline" href="/fiscal/verifactu">Ir a la configuración del certificado</Link>
              </InlineAlert>
            ) : null}
            {facturaeReady ? (
              <div className="flex flex-wrap gap-2">
                {canManage && certificate.available ? (
                  <EInvoiceDownloadButton invoiceId={invoiceId} request={{ format: "facturae", signed: true }} testId="einvoice-facturae-signed" variant="default">
                    Descargar firmada (.xsig)
                  </EInvoiceDownloadButton>
                ) : null}
                <EInvoiceDownloadButton invoiceId={invoiceId} request={{ format: "facturae" }} testId="einvoice-facturae-unsigned">
                  Descargar sin firmar (.xml)
                </EInvoiceDownloadButton>
                {canManage && certificate.available && signedCopy && !face?.registryNumber ? (
                  <EInvoiceDownloadButton invoiceId={invoiceId} request={{ format: "facturae", signed: true, regenerate: true }} testId="einvoice-facturae-resign">
                    Firmar de nuevo
                  </EInvoiceDownloadButton>
                ) : null}
              </div>
            ) : null}
            {facturaeReady && faceConfig.enabled ? (
              <div className="space-y-2" data-testid="einvoice-face">
                {faceConfig.problem ? (
                  <InlineAlert title="El envío a FACe no está bien configurado" tone="danger">{faceConfig.problem} Avisa al administrador del sistema.</InlineAlert>
                ) : null}
                {face?.registryNumber ? (
                  <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]" data-testid="einvoice-face-status">
                    <dt className="font-medium">Registro en FACe</dt>
                    <dd className="font-mono">{face.registryNumber}{face.environment === "staging" ? " (ENTORNO DE PRUEBAS)" : ""}</dd>
                    {face.submittedAt ? (<><dt className="font-medium">Remitida</dt><dd>{formatDateTime(face.submittedAt)}{face.contactEmail ? ` · avisos a ${face.contactEmail}` : ""}</dd></>) : null}
                    <dt className="font-medium">Tramitación</dt>
                    <dd>{face.processing ? `${faceProcessingLabels[face.processing.code] ?? face.processing.description ?? face.processing.code} (${face.processing.code})${face.processing.reason ? `: ${face.processing.reason}` : ""}` : "Sin consultar todavía"}</dd>
                    {face.cancellation ? (<><dt className="font-medium">Anulación</dt><dd>{faceCancellationLabels[face.cancellation.code] ?? face.cancellation.description ?? face.cancellation.code} ({face.cancellation.code}){face.cancellation.reason ? `: ${face.cancellation.reason}` : ""}</dd></>) : null}
                    {face.checkedAt ? (<><dt className="font-medium">Última consulta</dt><dd>{formatDateTime(face.checkedAt)}</dd></>) : null}
                  </dl>
                ) : null}
                {face?.lastError ? <InlineAlert title="Último error de FACe" tone="warning">{face.lastError}</InlineAlert> : null}
                {canManage && faceConfig.environment && certificate.available ? (
                  <EInvoiceFaceActions
                    environmentLabel={faceEnvironmentLabels[faceConfig.environment]}
                    invoiceId={invoiceId}
                    production={faceConfig.environment === "production"}
                    sent={Boolean(face?.registryNumber)}
                  />
                ) : null}
              </div>
            ) : null}
            <details className="text-xs">
              <summary className="cursor-pointer font-medium">Cómo presentarla en FACe a mano</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>Comprueba que la ficha del cliente tiene los tres códigos DIR3 (oficina contable, órgano gestor y unidad tramitadora): los indica el propio organismo y se pueden consultar en el directorio de face.gob.es.</li>
                <li>Descarga la factura firmada. Si no tienes el certificado subido, descárgala sin firmar y fírmala con AutoFirma (la aplicación gratuita del Gobierno), eligiendo el formato de firma «Factura electrónica».</li>
                <li>Entra en <a className="text-link underline" href="https://face.gob.es" rel="noopener noreferrer" target="_blank">face.gob.es</a>, opción «Remitir factura», indica un correo de contacto y sube el fichero (.xsig). Puedes añadir hasta cinco anexos (PDF, imágenes, ZIP o texto).</li>
                <li>Guarda el justificante con el número de registro que te da FACe: con él se consulta en face.gob.es el estado de la factura (registrada, contabilizada, pagada, rechazada o anulada). Anota aquí abajo el envío.</li>
                <li>Si te equivocaste, desde face.gob.es puedes solicitar la anulación indicando el motivo; la decide el órgano destinatario.</li>
              </ol>
              {!faceConfig.enabled ? (
                <p className="mt-2 text-muted-foreground">La remisión automática a FACe no está activada en este servidor (la activa el administrador del sistema, y exige dar de alta el certificado de la empresa en face.gob.es).</p>
              ) : null}
            </details>
          </div>
        ) : null}

        {availability.ubl ? (
          <div className="space-y-2 border-t border-window-dark-shadow pt-4" data-testid="einvoice-ubl">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wide">Factura entre empresas (UBL 2.1 · EN 16931)</h3>
            <p className="text-xs text-muted-foreground">
              Formato europeo para intercambiar facturas con otras empresas y plataformas privadas. Sigue el núcleo de la norma europea EN 16931.
            </p>
            {ubl.problems.length > 0 ? (
              <InlineAlert title="No se puede generar el UBL de esta factura" tone="warning"><ProblemList items={ubl.problems} /></InlineAlert>
            ) : (
              <>
                {ubl.warnings.length > 0 ? <InlineAlert title="Ten en cuenta" tone="warning"><ProblemList items={ubl.warnings} /></InlineAlert> : null}
                <div className="flex flex-wrap gap-2">
                  <EInvoiceDownloadButton invoiceId={invoiceId} request={{ format: "ubl" }} testId="einvoice-ubl-download">Descargar UBL (.xml)</EInvoiceDownloadButton>
                </div>
              </>
            )}
          </div>
        ) : null}

        {availability.ublAeat ? (
          <div className="space-y-2 border-t border-window-dark-shadow pt-4" data-testid="einvoice-ubl-aeat">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wide">Solución pública de la AEAT (UBL 2.5)</h3>
            <p className="text-xs text-muted-foreground">
              Perfil de la factura electrónica entre empresas de la Orden HAC/1028/2026 (Real Decreto 238/2026), con la clave de régimen, el tipo de rectificativa,
              el QR, las retenciones y el recargo de equivalencia. La aplicación todavía no la remite a la AEAT: descárgala para subirla a la solución pública o
              entregarla a tu plataforma de facturación. El fichero no se ha podido probar contra el validador de la AEAT.
            </p>
            {ublAeat.problems.length > 0 ? (
              <InlineAlert title="No se puede generar con el perfil de la AEAT" tone="warning"><ProblemList items={ublAeat.problems} /></InlineAlert>
            ) : (
              <>
                {ublAeat.warnings.length > 0 ? <InlineAlert title="Ten en cuenta" tone="warning"><ProblemList items={ublAeat.warnings} /></InlineAlert> : null}
                <div className="flex flex-wrap gap-2">
                  <EInvoiceDownloadButton invoiceId={invoiceId} request={{ format: "ubl-aeat" }} testId="einvoice-ubl-aeat-download">Descargar UBL de la AEAT (.xml)</EInvoiceDownloadButton>
                </div>
              </>
            )}
          </div>
        ) : null}

        {documents.length > 0 ? (
          <div className="space-y-2 border-t border-window-dark-shadow pt-4" data-testid="einvoice-documents">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wide">Ficheros generados</h3>
            <ul className="space-y-1 text-xs">
              {documents.map((document) => (
                <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5" key={document.id}>
                  <span className="font-medium">{formatLabels[document.format]} {document.signed ? "firmada" : "sin firmar"}</span>
                  <span className="text-muted-foreground">{document.fileName} · {formatDateTime(document.generatedAt)}</span>
                  <span className="break-all font-mono text-muted-foreground" title="Huella SHA-256 del fichero conservado">{document.sha256.slice(0, 16)}…</span>
                  {document.signerSubject ? <span className="text-muted-foreground">Firmada por: {document.signerSubject}</span> : null}
                  {document.dir3Codes ? <span className="text-muted-foreground">DIR3 usados: {dir3Summary(document.dir3Codes)}</span> : null}
                  {document.customerIban ? <span className="text-muted-foreground">IBAN de domiciliación usado: {document.customerIban}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {availability.statuses ? (
          <div className="space-y-3 border-t border-window-dark-shadow pt-4" data-testid="einvoice-statuses">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wide">Estados de la factura electrónica</h3>
              {summary.current ? <StatusBadge tone={statusTone[summary.current]}>{einvoiceStatusLabels[summary.current]}</StatusBadge> : <StatusBadge tone="neutral">Sin anotar</StatusBadge>}
            </div>
            <p className="text-xs text-muted-foreground">
              Con la factura electrónica obligatoria entre empresas, el cliente debe comunicarte si acepta o rechaza la factura y cuándo la paga por completo,
              en un máximo de cuatro días hábiles (art. 10 del Real Decreto 238/2026). Mientras no exista la conexión con la solución pública de la AEAT,
              anótalo aquí cuando te lo comunique. Sin rechazo, la factura se da por aceptada. Cuando cobres la factura, puedes descargar el mensaje de cobro
              para la solución pública de la AEAT (la aplicación aún no lo envía).
            </p>
            {statuses.length > 0 ? (
              <ul className="space-y-1 text-xs" data-testid="einvoice-status-history">
                {statuses.map((entry) => (
                  <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5" key={entry.id}>
                    <StatusBadge tone={statusTone[entry.status]}>{einvoiceStatusLabels[entry.status]}</StatusBadge>
                    <span className="font-mono">{isoDate(entry.effectiveDate)}</span>
                    {entry.status === "REJECTED" ? (
                      <span>
                        {entry.rejectionCode && entry.rejectionCode in einvoiceRejectionLabels ? `${einvoiceRejectionLabels[entry.rejectionCode as EInvoiceRejectionCode]}: ` : ""}
                        {entry.reason}
                      </span>
                    ) : null}
                    {entry.deadline ? <span className="text-muted-foreground">Plazo del cliente para comunicarlo: hasta el {isoDate(entry.deadline)} (sin contar festivos)</span> : null}
                    {entry.status === "PAID" ? (
                      <a
                        className="text-link underline"
                        data-testid="einvoice-settlement-message"
                        download
                        href={`/api/invoices/${invoiceId}/einvoice/status/${entry.id}/message`}
                        title="Mensaje UBL de cobro (anexo II de la Orden HAC/1028/2026) para comunicarlo a la solución pública de la AEAT"
                      >
                        Descargar comunicación de cobro (UBL)
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {canManage ? <EInvoiceStatusForm available={availableStatuses} invoiceId={invoiceId} today={civilDateKey(new Date())} /> : null}
          </div>
        ) : null}
      </div>
    </PageSection>
  );
}

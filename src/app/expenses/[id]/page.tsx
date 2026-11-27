import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ExpenseDocumentAttach } from "@/components/expenses/expense-document-attach";
import { RegisterSupplierPaymentButton } from "@/components/purchases/register-supplier-payment-button";
import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";
import {
  EmptyState,
  InlineAlert,
  MetricCard,
  PageHeader,
  PageSection,
  PageShell,
} from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  MobileRecord,
  MobileRecordField,
  MobileRecordFields,
  MobileRecordList,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supplierInvoice } from "@/db/schema";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import {
  invoicePaymentStatusLabels,
  invoicePaymentStatusTone,
  statusLabel,
} from "@/lib/status-labels";
import { missingDocumentJobIds } from "@/server/ocr/document-recovery";
import { supplierVatTreatmentLabels, type SupplierVatTreatment } from "@/lib/fiscal-spain";
import { getExpenseInvoice } from "@/server/supplier-invoices/service";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const ctx = await requireContext("expense.read");
    const { id } = await params;
    const [row] = await db
      .select({ number: supplierInvoice.number, supplierDocumentNumber: supplierInvoice.supplierDocumentNumber })
      .from(supplierInvoice)
      .where(and(eq(supplierInvoice.id, id), eq(supplierInvoice.companyId, ctx.company.id)))
      .limit(1);
    return { title: row ? `Factura de proveedor ${row.supplierDocumentNumber || row.number}` : "Factura de proveedor" };
  } catch {
    return { title: "Factura de proveedor" };
  }
}

// Attachment URLs are user-provided: only render same-origin paths or http(s).
function isSafeAttachmentUrl(url: string) {
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function accountLabel(line: { expenseAccountCode: string | null; expenseAccountName: string | null }) {
  return line.expenseAccountCode ? `${line.expenseAccountCode} - ${line.expenseAccountName}` : "Cuenta por defecto";
}

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireContext("expense.read");
  const { id } = await params;
  const expense = await getExpenseInvoice(ctx.company.id, id);
  if (!expense) notFound();
  const canManage = can(ctx.membership.role, "purchase.write") || can(ctx.membership.role, "expense.write");
  const currency = expense.currencyCode ?? ctx.company.baseCurrencyCode;
  // Documentos cuyo archivo ya no está en el servidor (se perdieron en un despliegue sin volumen).
  const missingDocuments = await missingDocumentJobIds(ctx.company.id, expense.id);
  const isMissing = (fileUrl: string) => missingDocuments.has(/^\/api\/expenses\/ocr\/([^/]+)\/file$/.exec(fileUrl)?.[1] ?? "");
  const isRectification = expense.documentKind === "RECTIFICATION";
  // Abono vivo: nada que pagar; el importe es un saldo a favor frente al proveedor.
  const isCreditBalance = expense.status !== "VOID" && Number(expense.totalAmount) < 0;
  const hasSurcharge = Number(expense.surchargeAmount) !== 0;
  const negativeClass = (value: string | number) => (Number(value) < 0 ? "text-danger-text" : undefined);
  const registerDetails = [
    expense.operationDate ? `Fecha de operación: ${formatDate(expense.operationDate)}` : null,
    expense.vatTreatment ? `IVA: ${supplierVatTreatmentLabels[expense.vatTreatment as SupplierVatTreatment] ?? expense.vatTreatment}` : null,
    expense.isSimplified ? "Factura simplificada / ticket sin NIF" : expense.supplierTaxId ? `NIF del proveedor: ${expense.supplierTaxId}` : "Proveedor sin NIF",
    expense.importDuaNumber ? `DUA ${expense.importDuaNumber}${expense.importDuaDate ? ` del ${formatDate(expense.importDuaDate)}` : ""}` : null,
  ].filter(Boolean);

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[
          { label: "Aprovisionamiento" },
          { label: "Facturas de proveedor", href: "/expenses" },
          { label: expense.supplierDocumentNumber || expense.number },
        ]}
        title={expense.supplierDocumentNumber || expense.number}
        description={[
          `${expense.supplierName} · ${formatDate(expense.issueDate)}`,
          // Factura registrada tarde: su IVA computa en el periodo de la fecha de registro.
          formatDate(expense.accountingDate) !== formatDate(expense.issueDate) ? `registrada el ${formatDate(expense.accountingDate)}` : null,
          expense.voidedAt ? `anulada el ${formatDate(expense.voidedAt)}` : null,
        ].filter(Boolean).join(" · ")}
        meta={
          <>
            {isRectification ? <StatusBadge tone="warning">Rectificativa</StatusBadge> : null}
            <StatusBadge tone={isCreditBalance ? "info" : invoicePaymentStatusTone(expense.paymentStatus)}>
              {isCreditBalance ? "Saldo a favor" : statusLabel(invoicePaymentStatusLabels, expense.paymentStatus)}
            </StatusBadge>
          </>
        }
        actions={
          <>
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={`/suppliers/${expense.supplierPartnerId}`}
            >
              Ver proveedor
            </Link>
            {expense.purchaseOrderId ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                href={`/purchases/orders/${expense.purchaseOrderId}`}
              >
                Ver pedido
              </Link>
            ) : null}
            {expense.goodsReceiptId ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                href={`/purchases/receipts/${expense.goodsReceiptId}`}
              >
                Ver recepción
              </Link>
            ) : null}
            {canManage && expense.status !== "VOID" && !isRectification ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                data-testid="register-rectification"
                href={`/expenses/new?rectifies=${expense.id}`}
              >
                Registrar abono / rectificativa
              </Link>
            ) : null}
            {canManage &&
            Number(expense.outstandingAmount) > 0 &&
            expense.paymentStatus !== "VOID" ? (
              <RegisterSupplierPaymentButton
                currencyCode={ctx.company.baseCurrencyCode}
                invoiceId={expense.id}
                outstandingAmount={Number(expense.outstandingAmount)}
              />
            ) : null}
            {canManage && expense.status === "VOID" ? (
              <DeleteButton
                description="La factura anulada, sus líneas, adjuntos y asientos contables compensados se eliminarán definitivamente."
                label="Eliminar"
                redirectTo="/expenses"
                successMessage="Factura anulada eliminada."
                title="Eliminar factura anulada"
                url={`/api/expenses/${expense.id}/hard-delete`}
              />
            ) : null}
          </>
        }
      />

      {isRectification ? (
        <InlineAlert title="Factura rectificativa (abono del proveedor)" tone="info">
          {expense.rectifiedInvoiceId ? (
            <>Rectifica la factura <Link className="font-bold text-link underline" href={`/expenses/${expense.rectifiedInvoiceId}`}>{expense.rectifiedDocumentNumber || "original"}</Link></>
          ) : expense.rectifiedDocumentNumber ? (
            <>Rectifica la factura {expense.rectifiedDocumentNumber}</>
          ) : (
            <>Sin factura rectificada identificada</>
          )}
          {expense.rectifiedIssueDate ? ` del ${formatDate(expense.rectifiedIssueDate)}` : ""}.
          {expense.rectificationReason ? ` Motivo: ${expense.rectificationReason}.` : ""}
          {isCreditBalance ? " Los importes en negativo son un saldo a tu favor frente al proveedor: no hay nada que pagar." : ""}
        </InlineAlert>
      ) : null}

      <section className={`grid grid-cols-2 gap-3 ${hasSurcharge ? "md:grid-cols-5" : "md:grid-cols-4"}`}>
        <MetricCard label="Base" value={formatMoney(expense.subtotalAmount, currency)} />
        <MetricCard label="IVA" value={formatMoney(expense.taxAmount, currency)} />
        {hasSurcharge ? <MetricCard label="Recargo de equivalencia" value={formatMoney(expense.surchargeAmount, currency)} /> : null}
        <MetricCard
          label="Retención"
          value={formatMoney(expense.retentionAmount, currency)}
        />
        {isCreditBalance ? (
          <MetricCard label="Saldo a favor" value={formatMoney(Math.abs(Number(expense.totalAmount)), currency)} helper="Total del abono; no genera pago" tone="success" />
        ) : (
          <MetricCard
            label="Pendiente"
            value={formatMoney(expense.outstandingAmount, currency)}
            helper={Number(expense.rectifiedAmount) !== 0 ? `Rectificativas registradas: ${formatMoney(expense.rectifiedAmount, currency)}` : undefined}
            tone={Number(expense.outstandingAmount) > 0 ? "warning" : "success"}
          />
        )}
      </section>

      <p className="text-xs text-muted-foreground" data-testid="expense-register-details">{registerDetails.join(" · ")}</p>

      <PageSection
        title="Líneas"
        description="Desglose contable y fiscal de la factura."
      >
        <TableContainer className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Concepto</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                <TableHead className="text-right" title="Parte del IVA que se recupera">IVA deducible</TableHead>
                <TableHead className="text-right" title="Retención de IRPF">Retención</TableHead>
                {hasSurcharge ? <TableHead className="text-right" title="Recargo de equivalencia soportado">Recargo eq.</TableHead> : null}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expense.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.description}</TableCell>
                  <TableCell>
                    {accountLabel(line)}
                    {line.isInvestmentGood ? <span className="ml-2 text-xs font-bold text-info-text">Bien de inversión</span> : null}
                  </TableCell>
                  <TableCell className={`whitespace-nowrap text-right ${negativeClass(line.subtotalAmount) ?? ""}`}>
                    {formatMoney(line.subtotalAmount, currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatPercent(line.taxRate)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatPercent(line.taxDeductiblePct)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatPercent(line.retentionRate)}
                  </TableCell>
                  {hasSurcharge ? <TableCell className="text-right">{formatPercent(line.surchargeRate)}</TableCell> : null}
                  <TableCell className={`whitespace-nowrap text-right ${negativeClass(line.lineTotal) ?? ""}`}>
                    {formatMoney(line.lineTotal, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <MobileRecordList aria-label="Líneas de la factura">
          {expense.lines.map((line) => (
            <MobileRecord aside={formatMoney(line.lineTotal, currency)} key={line.id} title={line.description}>
              <MobileRecordFields>
                <MobileRecordField label="Cuenta">{accountLabel(line)}</MobileRecordField>
                <MobileRecordField label="Base" numeric>{formatMoney(line.subtotalAmount, currency)}</MobileRecordField>
                <MobileRecordField label="IVA" numeric>{formatPercent(line.taxRate)}</MobileRecordField>
                <MobileRecordField label="IVA deducible" numeric>{formatPercent(line.taxDeductiblePct)}</MobileRecordField>
                <MobileRecordField label="Retención" numeric>{formatPercent(line.retentionRate)}</MobileRecordField>
                {hasSurcharge ? <MobileRecordField label="Recargo eq." numeric>{formatPercent(line.surchargeRate)}</MobileRecordField> : null}
                {line.isInvestmentGood ? <MobileRecordField label="Clase">Bien de inversión</MobileRecordField> : null}
              </MobileRecordFields>
            </MobileRecord>
          ))}
        </MobileRecordList>
      </PageSection>

      {expense.rectifications.length > 0 ? (
        <PageSection
          title="Rectificativas y abonos"
          description="Documentos del proveedor que rectifican esta factura. Su importe queda como saldo a favor en la cuenta del proveedor; no se descuenta solo de lo pendiente de esta factura."
        >
          <div className="space-y-2" data-testid="expense-rectifications">
            {expense.rectifications.map((rectification) => (
              <div className="flex items-center justify-between border-b border-border/70 py-3 text-sm last:border-b-0" key={rectification.id}>
                <div>
                  <Link className="font-mono font-semibold text-link hover:underline" href={`/expenses/${rectification.id}`}>
                    {rectification.supplierDocumentNumber || rectification.number}
                  </Link>
                  <p className="text-muted-foreground">
                    {formatDate(rectification.issueDate)}
                    {rectification.rectificationReason ? ` · ${rectification.rectificationReason}` : ""}
                    {rectification.status === "VOID" ? " · anulada" : ""}
                  </p>
                </div>
                <p className={`font-mono font-semibold ${negativeClass(rectification.totalAmount) ?? ""}`}>
                  {formatMoney(rectification.totalAmount, currency)}
                </p>
              </div>
            ))}
          </div>
        </PageSection>
      ) : null}

      <PageSection
        title="Pagos"
        description="Importes aplicados a esta factura de proveedor."
      >
        {expense.payments.length === 0 ? (
          <EmptyState
            title="Sin pagos"
            description={
              isCreditBalance
                ? "Un abono no se paga: su importe queda a tu favor en la cuenta del proveedor."
                : canManage && Number(expense.outstandingAmount) > 0 && expense.paymentStatus !== "VOID"
                  ? "La factura conserva todo su saldo pendiente. Registra el pago desde la cabecera cuando se abone."
                  : "La factura conserva todo su saldo pendiente."
            }
          />
        ) : (
          <div className="space-y-2">
            {expense.payments.map((payment) => (
              <div
                className="flex items-center justify-between border-b border-border/70 py-3 text-sm last:border-b-0"
                key={payment.id}
              >
                <div>
                  <p className="font-mono font-semibold">
                    {payment.number}
                  </p>
                  <p className="text-muted-foreground">
                    {formatDate(payment.postedAt)}
                  </p>
                </div>
                <p className="font-mono font-semibold">
                  {formatMoney(
                    payment.amountApplied,
                    ctx.company.baseCurrencyCode,
                  )}
                </p>
              </div>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection
        actions={canManage ? <ExpenseDocumentAttach expenseId={expense.id} replacesMissing={missingDocuments.size > 0} /> : undefined}
        title="Adjuntos"
        description={missingDocuments.size > 0
          ? "El documento de esta factura ya no está en el servidor. Vuelve a subirlo con «Reponer documento»: los enlaces y la exportación lo recuperan."
          : "Documentos vinculados a la factura de proveedor."}
      >
        {expense.attachments.length === 0 ? (
          <EmptyState
            title="Sin adjuntos"
            description="Esta factura no tiene documentos vinculados."
          />
        ) : (
          <div className="space-y-2">
            {expense.attachments.map((attachment) => (
              <div
                className="flex items-center justify-between gap-3 rounded-surface border border-window-shadow p-3"
                key={attachment.id}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{attachment.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {attachment.contentType ?? "Documento"}
                  </p>
                </div>
                {isMissing(attachment.fileUrl) ? (
                  <StatusBadge tone="warning">Documento no disponible</StatusBadge>
                ) : isSafeAttachmentUrl(attachment.fileUrl) ? (
                  <Link
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    href={attachment.fileUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Abrir
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">Enlace no disponible</span>
                )}
              </div>
            ))}
          </div>
        )}
      </PageSection>

      {expense.notes ? (
        <PageSection title="Notas" description="Observaciones internas.">
          <p className="whitespace-pre-wrap text-sm">{expense.notes}</p>
        </PageSection>
      ) : null}
    </PageShell>
  );
}

import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ExpenseDocumentAttach } from "@/components/expenses/expense-document-attach";
import { SupplierCreditActions } from "@/components/expenses/supplier-credit-actions";
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
import { bankAccount, fixedAsset, supplierInvoice } from "@/db/schema";
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
import { supplierInvoiceOutstandingSql } from "@/server/supplier-invoices/outstanding";
import { getExpenseInvoice } from "@/server/supplier-invoices/service";
import { treasuryAccountLabel } from "@/lib/treasury-accounts";

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
  const creditRemaining = Number(expense.creditRemainingAmount);
  const creditedAmount = Number(expense.creditedAmount);
  const canAccount = can(ctx.membership.role, "accounting.write");
  const hasInvestmentGoods = expense.status !== "VOID" && !isRectification && expense.lines.some((line) => line.isInvestmentGood);
  // Saldo a favor por aplicar: facturas pendientes del mismo proveedor y bancos para la devolución.
  const [creditTargets, creditBanks, linkedAssets] = await Promise.all([
    canManage && creditRemaining > 0
      ? db
          .select({ id: supplierInvoice.id, number: supplierInvoice.number, supplierDocumentNumber: supplierInvoice.supplierDocumentNumber, outstanding: supplierInvoiceOutstandingSql.mapWith(Number) })
          .from(supplierInvoice)
          .where(and(
            eq(supplierInvoice.companyId, ctx.company.id),
            eq(supplierInvoice.supplierPartnerId, expense.supplierPartnerId),
            ne(supplierInvoice.status, "VOID"),
            sql`${supplierInvoiceOutstandingSql} > 0`,
          ))
          .orderBy(sql`${supplierInvoice.dueDate} asc nulls last`, asc(supplierInvoice.issueDate))
          .limit(200)
      : Promise.resolve([]),
    canManage && creditRemaining > 0
      ? db
          .select({ id: bankAccount.id, bankName: bankAccount.bankName, iban: bankAccount.iban })
          .from(bankAccount)
          .where(and(eq(bankAccount.companyId, ctx.company.id), eq(bankAccount.isActive, true)))
          .orderBy(asc(bankAccount.bankName))
      : Promise.resolve([]),
    hasInvestmentGoods
      ? db
          .select({ id: fixedAsset.id, code: fixedAsset.code, description: fixedAsset.description })
          .from(fixedAsset)
          .where(and(eq(fixedAsset.companyId, ctx.company.id), eq(fixedAsset.supplierInvoiceId, expense.id)))
          .orderBy(desc(fixedAsset.createdAt))
      : Promise.resolve([]),
  ]);
  const negativeClass = (value: string | number) => (Number(value) < 0 ? "text-danger-text" : undefined);
  const registerDetails = [
    expense.operationDate ? `Fecha de operación: ${formatDate(expense.operationDate)}` : null,
    expense.vatTreatment ? `IVA: ${supplierVatTreatmentLabels[expense.vatTreatment as SupplierVatTreatment] ?? expense.vatTreatment}` : null,
    expense.isSimplified ? "Factura simplificada / ticket sin NIF" : expense.supplierTaxId ? `NIF del proveedor: ${expense.supplierTaxId}` : "Proveedor sin NIF",
    expense.importDuaNumber ? `DUA ${expense.importDuaNumber}${expense.importDuaDate ? ` del ${formatDate(expense.importDuaDate)}` : ""}` : null,
    expense.supplierCashAccounting ? "Proveedor en criterio de caja (el IVA se deduce al pagar)" : null,
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
            {canManage && isCreditBalance && creditRemaining > 0 ? (
              <SupplierCreditActions
                bankAccounts={creditBanks.map((account) => ({ id: account.id, label: treasuryAccountLabel(account) }))}
                creditId={expense.id}
                currencyCode={currency}
                invoices={creditTargets.map((row) => ({ id: row.id, label: row.supplierDocumentNumber || row.number, outstanding: row.outstanding }))}
                remaining={creditRemaining}
              />
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
          {isCreditBalance
            ? creditRemaining > 0
              ? ` Quedan ${formatMoney(creditRemaining, currency)} a tu favor frente al proveedor: compénsalos con otra factura suya o registra el cobro si te los devuelve.`
              : " El abono ya está compensado o devuelto por completo."
            : ""}
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
          <MetricCard
            label="Saldo a favor"
            value={formatMoney(creditRemaining, currency)}
            helper={`Abono de ${formatMoney(Math.abs(Number(expense.totalAmount)), currency)}; lo demás ya está compensado o devuelto`}
            tone="success"
          />
        ) : (
          <MetricCard
            label="Pendiente"
            value={formatMoney(expense.outstandingAmount, currency)}
            helper={creditedAmount > 0
              ? `Total ${formatMoney(expense.totalAmount, currency)} − abonos compensados ${formatMoney(creditedAmount, currency)} − pagos ${formatMoney(expense.paidAmount, currency)}`
              : Number(expense.rectifiedAmount) !== 0 ? `Rectificativas registradas: ${formatMoney(expense.rectifiedAmount, currency)}` : undefined}
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
          description="Documentos del proveedor que rectifican esta factura. Un abono se descuenta de lo pendiente de esta factura; lo que sobre queda como saldo a favor del proveedor."
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

      {hasInvestmentGoods ? (
        <PageSection
          title="Inmovilizado"
          description="Esta factura tiene bienes de inversión. Dalos de alta como inmovilizado para que el programa calcule y contabilice su amortización."
        >
          <div className="space-y-2" data-testid="expense-fixed-assets">
            {linkedAssets.map((asset) => (
              <div className="flex items-center justify-between border-b border-border/70 py-2 text-sm last:border-b-0" key={asset.id}>
                <Link className="font-semibold text-link hover:underline" href={`/accounting/assets/${asset.id}`}>
                  <span className="font-mono">{asset.code}</span> · {asset.description}
                </Link>
                <StatusBadge tone="success">Dado de alta</StatusBadge>
              </div>
            ))}
            {canAccount ? expense.lines.filter((line) => line.isInvestmentGood).map((line) => (
              <div className="flex items-center justify-between gap-3 border-b border-border/70 py-2 text-sm last:border-b-0" key={line.id}>
                <div className="min-w-0">
                  <p className="truncate font-medium">{line.description}</p>
                  <p className="text-xs text-muted-foreground">{accountLabel(line)} · {formatMoney(line.subtotalAmount, currency)}</p>
                </div>
                <Link
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  data-testid="expense-create-fixed-asset"
                  href={`/accounting/assets/new?supplierInvoiceId=${expense.id}&lineId=${line.id}`}
                >
                  Dar de alta como inmovilizado
                </Link>
              </div>
            )) : linkedAssets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tu rol no permite dar de alta bienes de inmovilizado.</p>
            ) : null}
          </div>
        </PageSection>
      ) : null}

      {expense.creditApplications.asInvoice.length > 0 || expense.creditApplications.asCredit.length > 0 ? (
        <PageSection
          title={isCreditBalance ? "Aplicación del abono" : "Abonos compensados"}
          description={isCreditBalance
            ? "Facturas con las que se ha compensado este abono y devoluciones cobradas por banco."
            : "Abonos del proveedor descontados de lo pendiente de esta factura. No generan asiento: ya están en la cuenta del proveedor."}
        >
          <div className="space-y-2" data-testid="expense-credit-applications">
            {[...expense.creditApplications.asInvoice.map((row) => ({ ...row, href: `/expenses/${row.creditInvoiceId}`, kind: "Abono" })),
              ...expense.creditApplications.asCredit.map((row) => ({ ...row, href: row.supplierInvoiceId ? `/expenses/${row.supplierInvoiceId}` : null, kind: row.supplierInvoiceId ? "Factura" : "Devolución por banco" }))].map((row) => (
              <div className="flex items-center justify-between gap-3 border-b border-border/70 py-3 text-sm last:border-b-0" key={row.id}>
                <div>
                  {row.href ? (
                    <Link className="font-mono font-semibold text-link hover:underline" href={row.href}>{row.supplierDocumentNumber || row.documentNumber}</Link>
                  ) : (
                    <p className="font-semibold">{row.kind}</p>
                  )}
                  <p className="text-muted-foreground">{row.href ? `${row.kind} · ` : ""}{formatDate(row.appliedAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-mono font-semibold">{formatMoney(row.amount, currency)}</p>
                  {canManage ? (
                    <DeleteButton
                      description={row.href ? "La factura volverá a tener ese importe pendiente de pago y el abono lo recuperará como saldo a favor." : "Se anulará el asiento del cobro y el abono recuperará ese saldo a favor."}
                      label="Quitar"
                      successMessage="Compensación quitada."
                      title={row.href ? "Quitar compensación" : "Quitar cobro de la devolución"}
                      url={`/api/supplier-credits/${row.id}`}
                    />
                  ) : null}
                </div>
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
                ? "Un abono no se paga: se compensa con facturas del proveedor o se cobra si te lo devuelve."
                : canManage && Number(expense.outstandingAmount) > 0 && expense.paymentStatus !== "VOID"
                  ? "Registra el pago desde la cabecera cuando se abone."
                  : "No hay pagos registrados para esta factura."
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

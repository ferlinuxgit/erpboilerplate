"use client";

import { WarningCircle } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput, PercentInput } from "@/components/ui/number-input";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow, stackedOnMobile } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate, formatDecimalInput, formatMoney, parseDecimalInput } from "@/lib/format";
import { buildReceiptInvoiceLines, priceVariance, receiptInvoiceTotals, type OrderLineRef, type ReceiptLineRef } from "@/lib/purchase-invoice";
import { dueDateInputFor } from "@/lib/supplier-defaults";
import { defaultSurchargeRate } from "@/server/supplier-invoices/document-rules";
import { cn } from "@/lib/utils";

export type PurchaseInvoiceDialogContext = {
  purchaseOrderId: string;
  supplierPartnerId: string;
  paymentTermsDays: number | null;
  receipts: Array<{ id: string; number: string; receivedAt: Date | string; invoiceId: string | null; invoiceNumber: string | null }>;
  orderLines: OrderLineRef[];
  receiptLines: ReceiptLineRef[];
  itemTaxRates: Array<[string, number]>;
  fallbackTaxRate: number | null;
};

type FieldErrors = Partial<Record<"supplierDocumentNumber" | "issueDate" | "dueDate" | "receipts" | "importDua", string>>;
type LineEdit = { unitPrice: string; taxRate: string; surchargeRate?: string; isInvestmentGood?: boolean };

function todayInputValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function toIsoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

/**
 * Registra la factura del proveedor de una o varias recepciones del mismo pedido.
 * Los precios son editables (con aviso si difieren del pedido) y el IVA sale del artículo:
 * nunca se aplica un 0 % en silencio.
 */
export function CreateSupplierInvoiceFromReceiptButton({
  context,
  currencyCode = "EUR",
  initialReceiptIds,
  label = "Registrar factura",
}: {
  context: PurchaseInvoiceDialogContext;
  currencyCode?: string;
  initialReceiptIds?: string[];
  label?: string;
}) {
  const router = useRouter();
  const openReceipts = context.receipts.filter((receipt) => !receipt.invoiceId);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [selectedReceiptIds, setSelectedReceiptIds] = useState<string[]>(() => (initialReceiptIds?.length ? initialReceiptIds : openReceipts.map((receipt) => receipt.id)).filter((id) => openReceipts.some((receipt) => receipt.id === id)));
  const [supplierDocumentNumber, setSupplierDocumentNumber] = useState("");
  const [issueDate, setIssueDate] = useState(todayInputValue);
  const [dueDate, setDueDate] = useState(() => dueDateInputFor(todayInputValue(), context.paymentTermsDays));
  const [dueDateEdited, setDueDateEdited] = useState(false);
  const [notes, setNotes] = useState("");
  // Datos del libro registro que la mayoría de las facturas no necesitan (sección plegada).
  const [operationDate, setOperationDate] = useState("");
  const [importDuaNumber, setImportDuaNumber] = useState("");
  const [importDuaDate, setImportDuaDate] = useState("");
  const [hasSurcharge, setHasSurcharge] = useState(false);
  const [edits, setEdits] = useState<Record<string, LineEdit>>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const idSuffix = context.purchaseOrderId;

  const proposedLines = useMemo(() => buildReceiptInvoiceLines({
    receiptLines: context.receiptLines.filter((line) => selectedReceiptIds.includes(line.goodsReceiptId)),
    orderLines: context.orderLines,
    itemTaxRates: new Map(context.itemTaxRates),
    fallbackTaxRate: context.fallbackTaxRate,
  }), [context.fallbackTaxRate, context.itemTaxRates, context.orderLines, context.receiptLines, selectedReceiptIds]);

  const lines = proposedLines.map((line) => {
    const edit = edits[line.goodsReceiptLineId];
    const unitPriceText = edit?.unitPrice ?? formatDecimalInput(line.unitPrice, { minimumFractionDigits: 2 });
    const taxRateText = edit?.taxRate ?? (Number.isFinite(line.taxRate) ? formatDecimalInput(line.taxRate) : "");
    const unitPrice = parseDecimalInput(unitPriceText, { maximumFractionDigits: 2 });
    const taxRate = parseDecimalInput(taxRateText, { maximumFractionDigits: 2 });
    // Recargo de equivalencia: el que corresponde al IVA de la línea salvo que se escriba otro.
    const surchargeRateText = edit?.surchargeRate ?? formatDecimalInput(defaultSurchargeRate(taxRate ?? 0));
    const surchargeRate = hasSurcharge ? parseDecimalInput(surchargeRateText, { maximumFractionDigits: 2 }) : 0;
    return { ...line, unitPriceText, taxRateText, surchargeRateText, parsedUnitPrice: unitPrice, parsedTaxRate: taxRate, parsedSurchargeRate: surchargeRate, isInvestmentGood: edit?.isInvestmentGood ?? false };
  });
  const surchargeTotal = lines.reduce((sum, line) => sum + Math.round(line.quantity * (line.parsedUnitPrice ?? 0) * (line.parsedSurchargeRate ?? 0)) / 100, 0);
  const totals = receiptInvoiceTotals(lines.map((line) => ({ quantity: line.quantity, unitPrice: line.parsedUnitPrice ?? 0, taxRate: line.parsedTaxRate ?? 0 })));
  const varianceCount = lines.filter((line) => line.parsedUnitPrice !== null && priceVariance(line.orderUnitPrice, line.parsedUnitPrice).significant).length;

  function editLine(lineId: string, patch: Partial<LineEdit>) {
    setEdits((current) => {
      const line = lines.find((candidate) => candidate.goodsReceiptLineId === lineId);
      const base: LineEdit = current[lineId] ?? { unitPrice: line?.unitPriceText ?? "", taxRate: line?.taxRateText ?? "" };
      return { ...current, [lineId]: { ...base, ...patch } };
    });
  }

  function toggleReceipt(receiptId: string, checked: boolean) {
    setSelectedReceiptIds((current) => (checked ? [...new Set([...current, receiptId])] : current.filter((id) => id !== receiptId)));
  }

  function validate() {
    const nextErrors: FieldErrors = {};
    const nextLineErrors: Record<string, string> = {};
    if (selectedReceiptIds.length === 0) nextErrors.receipts = "Elige al menos una recepción.";
    if (!supplierDocumentNumber.trim()) nextErrors.supplierDocumentNumber = "Indica el número de la factura del proveedor.";
    if (!issueDate) nextErrors.issueDate = "Indica la fecha de emisión.";
    if (dueDate && issueDate && dueDate < issueDate) nextErrors.dueDate = "El vencimiento no puede ser anterior a la emisión.";
    if (importDuaDate && !importDuaNumber.trim()) nextErrors.importDua = "Indica el número del DUA.";
    for (const line of lines) {
      if (line.parsedUnitPrice === null || line.parsedUnitPrice < 0) nextLineErrors[`${line.goodsReceiptLineId}-price`] = "Precio no válido.";
      if (line.parsedTaxRate === null || line.parsedTaxRate < 0 || line.parsedTaxRate > 100) nextLineErrors[`${line.goodsReceiptLineId}-tax`] = "Indica el IVA (p. ej. 21).";
      if (hasSurcharge && (line.parsedSurchargeRate === null || line.parsedSurchargeRate < 0 || line.parsedSurchargeRate > 100)) nextLineErrors[`${line.goodsReceiptLineId}-surcharge`] = "Recargo no válido (p. ej. 5,2).";
    }
    setFieldErrors(nextErrors);
    setLineErrors(nextLineErrors);
    return Object.keys(nextErrors).length === 0 && Object.keys(nextLineErrors).length === 0;
  }

  if (openReceipts.length === 0) return null;

  return (
    <>
      <Button onClick={() => setOpen(true)} type="button">{label}</Button>
      <Dialog
        description="Registra la factura del proveedor de una o varias entregas de este pedido. El número interno se asigna solo."
        initialFocusId={`supplier-document-${idSuffix}`}
        onClose={() => setOpen(false)}
        open={open}
        size="xl"
        title="Registrar factura de proveedor"
      >
        <form
          className="space-y-3"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setFormError(null);
            if (!validate()) {
              const message = "Revisa los campos marcados antes de registrar la factura.";
              setFormError(message);
              toast.error(message);
              return;
            }
            setPending(true);
            try {
              const response = await fetch("/api/supplier-invoices", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...getCsrfHeader() },
                body: JSON.stringify({
                  supplierPartnerId: context.supplierPartnerId,
                  purchaseOrderId: context.purchaseOrderId,
                  goodsReceiptIds: selectedReceiptIds,
                  supplierDocumentNumber,
                  issueDate: toIsoDate(issueDate),
                  dueDate: dueDate ? toIsoDate(dueDate) : undefined,
                  operationDate: operationDate ? toIsoDate(operationDate) : undefined,
                  importDuaNumber: importDuaNumber.trim() || undefined,
                  importDuaDate: importDuaDate ? toIsoDate(importDuaDate) : undefined,
                  notes,
                  lines: lines.map((line) => ({
                    itemId: line.itemId ?? undefined,
                    purchaseOrderLineId: line.purchaseOrderLineId ?? undefined,
                    goodsReceiptLineId: line.goodsReceiptLineId,
                    description: line.description,
                    quantity: line.quantity,
                    unitPrice: line.parsedUnitPrice ?? 0,
                    taxRate: line.parsedTaxRate ?? 0,
                    surchargeRate: hasSurcharge ? line.parsedSurchargeRate ?? 0 : 0,
                    // Sin marcar, el servidor lo deduce de la cuenta (grupo 2 = bien de inversión).
                    isInvestmentGood: line.isInvestmentGood || undefined,
                  })),
                }),
              });
              if (!response.ok) throw new Error(await readApiError(response, "No se pudo registrar la factura de proveedor."));
              const result = (await response.json().catch(() => null)) as { id?: string } | null;
              if (!result?.id) throw new Error("La factura se ha registrado, pero no se pudo abrir. Revisa el listado de facturas de proveedor.");
              toast.success("Factura de proveedor registrada.");
              setOpen(false);
              router.push(`/expenses/${result.id}`);
              router.refresh();
            } catch (error) {
              const message = errorMessage(error, "No se pudo registrar la factura de proveedor. Inténtalo de nuevo.");
              setFormError(message);
              toast.error(message);
            } finally {
              setPending(false);
            }
          }}
        >
          <fieldset className="space-y-1 border border-window-shadow p-2">
            <legend className="px-1 font-mono text-xs font-bold">Entregas que cubre la factura</legend>
            {openReceipts.map((receipt) => (
              <label className="flex items-center gap-2 text-xs" htmlFor={`invoice-receipt-${receipt.id}`} key={receipt.id}>
                <input checked={selectedReceiptIds.includes(receipt.id)} id={`invoice-receipt-${receipt.id}`} onChange={(event) => toggleReceipt(receipt.id, event.target.checked)} type="checkbox" />
                <span className="font-mono font-bold">{receipt.number}</span>
                <span className="text-muted-foreground">{formatDate(receipt.receivedAt)}</span>
              </label>
            ))}
            {context.receipts.some((receipt) => receipt.invoiceId) ? (
              <p className="text-xs text-muted-foreground">
                Ya facturadas: {context.receipts.filter((receipt) => receipt.invoiceId).map((receipt) => `${receipt.number} (${receipt.invoiceNumber})`).join(", ")}.
              </p>
            ) : null}
            {fieldErrors.receipts ? <p className="font-mono text-xs text-destructive" role="alert">{fieldErrors.receipts}</p> : null}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-3">
            <AccessibleField className="sm:col-span-3" error={fieldErrors.supplierDocumentNumber} helperText="Tal como aparece en la factura recibida." id={`supplier-document-${idSuffix}`} label="Número de la factura del proveedor" required>
              <Input onChange={(event) => setSupplierDocumentNumber(event.target.value)} placeholder="Ej. F-2026-1842" value={supplierDocumentNumber} />
            </AccessibleField>
            <AccessibleField error={fieldErrors.issueDate} id={`supplier-issue-${idSuffix}`} label="Fecha de la factura" required>
              <Input
                onChange={(event) => {
                  setIssueDate(event.target.value);
                  if (!dueDateEdited) setDueDate(dueDateInputFor(event.target.value, context.paymentTermsDays));
                }}
                type="date"
                value={issueDate}
              />
            </AccessibleField>
            <AccessibleField error={fieldErrors.dueDate} helperText={context.paymentTermsDays !== null && !dueDateEdited ? `Fecha + ${context.paymentTermsDays} días de pago del proveedor.` : "Opcional."} id={`supplier-due-${idSuffix}`} label="Vencimiento">
              <Input min={issueDate} onChange={(event) => { setDueDate(event.target.value); setDueDateEdited(true); }} type="date" value={dueDate} />
            </AccessibleField>
            <AccessibleField id={`supplier-notes-${idSuffix}`} label="Notas">
              <Textarea className="min-h-8" onChange={(event) => setNotes(event.target.value)} placeholder="Información interna" value={notes} />
            </AccessibleField>
          </div>

          <details className="border border-window-shadow bg-window-panel" data-testid="purchase-invoice-register-details" open={Boolean(operationDate || importDuaNumber || importDuaDate || hasSurcharge || fieldErrors.importDua)}>
            <summary className="cursor-pointer px-3 py-2 font-mono text-xs font-bold">Más datos: fecha de operación, importación (DUA), recargo de equivalencia y bienes de inversión</summary>
            <div className="grid gap-3 border-t border-window-shadow p-2.5 sm:grid-cols-3">
              <AccessibleField helperText="Solo si la entrega fue en una fecha distinta de la de la factura." id={`supplier-operation-${idSuffix}`} label="Fecha de operación">
                <Input max={issueDate || undefined} onChange={(event) => setOperationDate(event.target.value)} type="date" value={operationDate} />
              </AccessibleField>
              <AccessibleField error={fieldErrors.importDua} helperText="Solo importaciones: documento aduanero." id={`supplier-dua-number-${idSuffix}`} label="N.º de DUA">
                <Input maxLength={40} onChange={(event) => setImportDuaNumber(event.target.value)} placeholder="Ej. 26ES00280112345678" value={importDuaNumber} />
              </AccessibleField>
              <AccessibleField helperText="Fecha de admisión por la aduana." id={`supplier-dua-date-${idSuffix}`} label="Fecha del DUA">
                <Input onChange={(event) => setImportDuaDate(event.target.value)} type="date" value={importDuaDate} />
              </AccessibleField>
              <label className="flex items-center gap-2 text-xs sm:col-span-3" htmlFor={`supplier-surcharge-${idSuffix}`}>
                <input checked={hasSurcharge} data-testid="purchase-invoice-has-surcharge" id={`supplier-surcharge-${idSuffix}`} onChange={(event) => setHasSurcharge(event.target.checked)} type="checkbox" />
                La factura lleva recargo de equivalencia (se añade una columna con el tipo de cada línea)
              </label>
              <p className="text-xs text-muted-foreground sm:col-span-3">
                Marca «Bien de inversión» en las líneas de elementos que se usarán más de un año (maquinaria, equipos…). ¿Es un abono o una
                rectificativa? Regístrala desde la factura original con «Registrar abono / rectificativa».
              </p>
            </div>
          </details>

          {/* En móvil cada línea es una tarjeta con sus campos (mismo DOM, sin duplicar). */}
          <TableContainer aria-label="Líneas de la factura" className={stackedOnMobile.container} role="group">
            <Table className={cn("md:min-w-[40rem]", stackedOnMobile.table)}>
              <TableHeader className={stackedOnMobile.header}>
                <TableRow>
                  <TableHead scope="col">Concepto</TableHead>
                  <TableHead className="text-right" scope="col">Cantidad</TableHead>
                  <TableHead className="text-right" scope="col">Precio unitario</TableHead>
                  <TableHead className="text-right" scope="col">IVA %</TableHead>
                  {hasSurcharge ? <TableHead className="text-right" scope="col">Recargo %</TableHead> : null}
                  <TableHead className="text-right" scope="col">Base</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={stackedOnMobile.body}>
                {lines.length === 0 ? (
                  <TableRow className={stackedOnMobile.row}><TableCell className={cn("text-muted-foreground", stackedOnMobile.title)} colSpan={hasSurcharge ? 6 : 5}>Elige al menos una entrega.</TableCell></TableRow>
                ) : lines.map((line) => {
                  const variance = line.parsedUnitPrice !== null ? priceVariance(line.orderUnitPrice, line.parsedUnitPrice) : null;
                  const priceError = lineErrors[`${line.goodsReceiptLineId}-price`];
                  const taxError = lineErrors[`${line.goodsReceiptLineId}-tax`];
                  return (
                    <TableRow className={cn("align-top", stackedOnMobile.row)} key={line.goodsReceiptLineId}>
                      <TableCell className={stackedOnMobile.title}>
                        <span className="block font-bold">{line.description}</span>
                        <span className="text-muted-foreground">Entrega {line.goodsReceiptNumber}</span>
                        <label className="mt-0.5 flex items-center gap-1.5 text-xs" htmlFor={`investment-${line.goodsReceiptLineId}`}>
                          <input checked={line.isInvestmentGood} id={`investment-${line.goodsReceiptLineId}`} onChange={(event) => editLine(line.goodsReceiptLineId, { isInvestmentGood: event.target.checked })} type="checkbox" />
                          Bien de inversión
                        </label>
                      </TableCell>
                      <TableCell className={cn("text-right", stackedOnMobile.cell)} data-label="Cantidad">{formatDecimalInput(line.quantity, { maximumFractionDigits: 3 })}</TableCell>
                      <TableCell className={cn("w-36", stackedOnMobile.wide, "max-md:w-auto")} data-label="Precio unitario">
                        <MoneyInput
                          aria-describedby={variance?.significant ? `variance-${line.goodsReceiptLineId}` : undefined}
                          aria-invalid={priceError ? true : undefined}
                          aria-label={`Precio unitario de ${line.description}`}
                          className="pointer-coarse:min-h-11"
                          currencySymbol={currencyCode === "EUR" ? "€" : currencyCode}
                          onChange={(event) => editLine(line.goodsReceiptLineId, { unitPrice: event.target.value })}
                          value={line.unitPriceText}
                        />
                        {variance?.significant ? (
                          <p className="mt-0.5 flex items-start gap-1 text-warning-text" id={`variance-${line.goodsReceiptLineId}`}>
                            <WarningCircle aria-hidden="true" className="mt-0.5 shrink-0" />
                            Pedido: {formatMoney(line.orderUnitPrice, currencyCode)} ({variance.difference > 0 ? "+" : ""}{formatDecimalInput(variance.pct, { maximumFractionDigits: 1 })} %)
                          </p>
                        ) : null}
                        {priceError ? <p className="mt-0.5 text-danger-text" role="alert">{priceError}</p> : null}
                      </TableCell>
                      <TableCell className={cn("w-28", stackedOnMobile.wide, "max-md:w-auto")} data-label="IVA %">
                        <PercentInput
                          aria-invalid={taxError ? true : undefined}
                          aria-label={`IVA de ${line.description}`}
                          className="pointer-coarse:min-h-11"
                          onChange={(event) => editLine(line.goodsReceiptLineId, { taxRate: event.target.value })}
                          placeholder="21"
                          value={line.taxRateText}
                        />
                        {line.taxRateSource === "default" && edits[line.goodsReceiptLineId]?.taxRate === undefined ? <p className="mt-0.5 text-muted-foreground">IVA general de la empresa: el artículo no tiene IVA propio.</p> : null}
                        {line.taxRateSource === "none" && !line.taxRateText ? <p className="mt-0.5 text-warning-text">El artículo no tiene IVA configurado: indícalo.</p> : null}
                        {taxError ? <p className="mt-0.5 text-danger-text" role="alert">{taxError}</p> : null}
                      </TableCell>
                      {hasSurcharge ? (
                        <TableCell className={cn("w-24", stackedOnMobile.wide, "max-md:w-auto")} data-label="Recargo %">
                          <PercentInput
                            aria-invalid={lineErrors[`${line.goodsReceiptLineId}-surcharge`] ? true : undefined}
                            aria-label={`Recargo de equivalencia de ${line.description}`}
                            className="pointer-coarse:min-h-11"
                            onChange={(event) => editLine(line.goodsReceiptLineId, { surchargeRate: event.target.value })}
                            value={line.surchargeRateText}
                          />
                          {lineErrors[`${line.goodsReceiptLineId}-surcharge`] ? <p className="mt-0.5 text-danger-text" role="alert">{lineErrors[`${line.goodsReceiptLineId}-surcharge`]}</p> : null}
                        </TableCell>
                      ) : null}
                      <TableCell className={cn("text-right", stackedOnMobile.cell)} data-label="Base">{formatMoney(line.quantity * (line.parsedUnitPrice ?? 0), currencyCode)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {varianceCount > 0 ? `${varianceCount === 1 ? "1 precio difiere" : `${varianceCount} precios difieren`} del pedido: comprueba que coincide con la factura.` : "Los precios coinciden con el pedido."}
            </p>
            <dl className="min-w-48 font-mono text-xs tabular-nums">
              <div className="flex justify-between gap-3"><dt>Base</dt><dd>{formatMoney(totals.subtotal, currencyCode)}</dd></div>
              <div className="flex justify-between gap-3 text-muted-foreground"><dt>+ IVA</dt><dd>{formatMoney(totals.tax, currencyCode)}</dd></div>
              {hasSurcharge ? <div className="flex justify-between gap-3 text-muted-foreground"><dt>+ Recargo eq.</dt><dd>{formatMoney(surchargeTotal, currencyCode)}</dd></div> : null}
              <div className="flex justify-between gap-3 border-t border-window-shadow pt-0.5 text-sm font-bold"><dt>Total</dt><dd>{formatMoney(totals.total + (hasSurcharge ? surchargeTotal : 0), currencyCode)}</dd></div>
            </dl>
          </div>

          <FormErrorMessage>{formError}</FormErrorMessage>
          <DialogFooter>
            <Button onClick={() => setOpen(false)} type="button" variant="outline">Cancelar</Button>
            <SubmitButton disabled={lines.length === 0} pending={pending} pendingLabel="Registrando…">Registrar factura</SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

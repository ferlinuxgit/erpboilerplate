"use client";

import { Eye, Plus, Trash, WarningCircle } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AccountPicker } from "@/components/ui/account-picker";
import { AccessibleField, FormErrorMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput, PercentInput, QuantityInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { SupplierPicker } from "@/components/suppliers/supplier-picker";
import type { AccountOption } from "@/lib/account-aliases";
import { supplierVatTreatmentLabels } from "@/lib/fiscal-spain";
import { formatMoney } from "@/lib/format";
import { dueDateInputFor, parseSupplierVatTreatment, SUPPLIER_VAT_TREATMENTS } from "@/lib/supplier-defaults";
import { cn } from "@/lib/utils";

import { DocumentPreview, type DocumentSource } from "./document-preview";
import { applySupplierToItem, emptyDuplicate, type BatchItem, type BatchSupplier, type DraftLine } from "./expense-batch-model";
import { isBlockingWarning, reviewLineTotal, reviewReasonLabels, type ItemReadiness } from "./expense-review";

export type PurchaseOrderRelation = { id: string; number: string; supplierPartnerId: string };
export type GoodsReceiptRelation = { id: string; number: string; purchaseOrderId: string; supplierPartnerId: string };

const vatOptions = SUPPLIER_VAT_TREATMENTS.map((treatment) => [treatment, supplierVatTreatmentLabels[treatment]] as const);

const confidenceLabels = { high: "alta", medium: "media", low: "baja" } as const;

function documentSource(item: BatchItem): DocumentSource | null {
  if (item.file) return { kind: "file", file: item.file };
  if (item.fileUrl) return { kind: "url", url: item.fileUrl, contentType: item.contentType, fileName: item.fileName };
  return null;
}

/**
 * Revisión de un documento a pantalla partida: el original a la izquierda (zoom y páginas)
 * y los datos leídos a la derecha. En móvil se apila y el documento se abre a demanda.
 */
export function ExpenseBatchItemReview({
  baseCurrencyCode,
  expenseAccounts,
  goodsReceipts,
  item,
  onPatch,
  onPost,
  purchaseOrders,
  readiness,
  suppliers,
}: {
  baseCurrencyCode: string;
  expenseAccounts: AccountOption[];
  goodsReceipts: GoodsReceiptRelation[];
  item: BatchItem;
  onPatch: (patch: Partial<BatchItem> | ((item: BatchItem) => BatchItem)) => void;
  onPost: () => void;
  purchaseOrders: PurchaseOrderRelation[];
  readiness: ItemReadiness | null;
  suppliers: BatchSupplier[];
}) {
  const [showPreviewOnMobile, setShowPreviewOnMobile] = useState(false);
  const disabled = item.status !== "DONE";
  const source = documentSource(item);
  const idBase = item.localId;
  const selectedSupplier = suppliers.find((supplier) => supplier.id === item.supplierPartnerId);
  const supplierDefaultAccount = selectedSupplier?.defaults?.defaultExpenseAccountId ?? null;
  const total = readiness?.total ?? item.lines.reduce((sum, line) => sum + reviewLineTotal(line), 0);
  const totalsMismatch = readiness?.reasons.includes("totals") ?? false;
  const accountMissing = readiness?.reasons.includes("account") ?? false;
  const currencySymbol = item.currencyCode === "EUR" ? "€" : item.currencyCode;

  function patchLine(lineId: string, patch: Partial<DraftLine>) {
    onPatch((current) => ({ ...current, lines: current.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)) }));
  }

  function selectSupplier(supplierId: string) {
    onPatch((current) => {
      const linkedOrder = purchaseOrders.find((order) => order.id === current.purchaseOrderId);
      const keepOrder = !linkedOrder || linkedOrder.supplierPartnerId === supplierId;
      const next: BatchItem = {
        ...current,
        supplierPartnerId: supplierId,
        purchaseOrderId: keepOrder ? current.purchaseOrderId : "",
        goodsReceiptId: keepOrder ? current.goodsReceiptId : "",
        duplicate: emptyDuplicate,
      };
      return applySupplierToItem(next, suppliers.find((supplier) => supplier.id === supplierId));
    });
  }

  function changeIssueDate(issueDate: string) {
    onPatch((current) => ({
      ...current,
      issueDate,
      duplicate: emptyDuplicate,
      // Si el vencimiento se calculó con los días del proveedor, se recalcula con la nueva fecha.
      dueDate: current.dueDateEdited || current.draft?.dueDate ? current.dueDate : dueDateInputFor(issueDate, selectedSupplier?.defaults?.paymentTermsDays) || current.dueDate,
    }));
  }

  function selectPurchaseOrder(purchaseOrderId: string) {
    const order = purchaseOrders.find((candidate) => candidate.id === purchaseOrderId);
    const receiptBelongsToOrder = goodsReceipts.find((receipt) => receipt.id === item.goodsReceiptId)?.purchaseOrderId === purchaseOrderId;
    onPatch({ purchaseOrderId, goodsReceiptId: receiptBelongsToOrder ? item.goodsReceiptId : "", duplicate: emptyDuplicate });
    if (order && order.supplierPartnerId !== item.supplierPartnerId) selectSupplier(order.supplierPartnerId);
  }

  function selectGoodsReceipt(goodsReceiptId: string) {
    const receipt = goodsReceipts.find((candidate) => candidate.id === goodsReceiptId);
    onPatch({ goodsReceiptId, purchaseOrderId: receipt?.purchaseOrderId ?? item.purchaseOrderId, duplicate: emptyDuplicate });
    if (receipt && receipt.supplierPartnerId !== item.supplierPartnerId) selectSupplier(receipt.supplierPartnerId);
  }

  function addLine() {
    onPatch((current) => ({
      ...current,
      lines: [...current.lines, {
        id: crypto.randomUUID(),
        description: "",
        expenseAccountId: supplierDefaultAccount ?? "",
        accountSource: supplierDefaultAccount ? "supplier" : "none",
        quantity: "1",
        unitPrice: "",
        taxRate: current.lines[0]?.taxRate ?? "21",
        taxDeductiblePct: current.lines[0]?.taxDeductiblePct ?? "100",
        retentionRate: current.lines[0]?.retentionRate ?? "0",
        deductibleEdited: false,
      }],
    }));
  }

  const warnings = item.draft?.warnings ?? [];
  const hasBlocking = warnings.some(isBlockingWarning);

  return (
    <div className="grid gap-3 border-t border-window-shadow p-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="lg:sticky lg:top-2 lg:self-start">
        <Button className="mb-2 w-full lg:hidden" onClick={() => setShowPreviewOnMobile((current) => !current)} size="sm" type="button" variant="outline">
          <Eye aria-hidden="true" /> {showPreviewOnMobile ? "Ocultar documento" : "Ver documento"}
        </Button>
        {source ? (
          <DocumentPreview className={cn("lg:flex lg:max-h-[80vh]", showPreviewOnMobile ? "flex max-h-[70vh]" : "hidden")} key={item.localId} source={source} />
        ) : (
          <p className={cn("border border-dashed border-window-dark-shadow p-3 text-xs text-muted-foreground lg:block", showPreviewOnMobile ? "block" : "hidden")}>El documento original no está disponible.</p>
        )}
      </div>

      <form
        aria-label={`Revisión de ${item.fileName}`}
        className="space-y-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) onPost();
        }}
      >
        {item.draft ? (
          <p className="text-xs text-muted-foreground">
            Lectura de confianza <strong>{confidenceLabels[item.draft.confidence]}</strong>. Compara cada dato con el documento.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <AccessibleField className="sm:col-span-2" helperText={!item.supplierPartnerId ? "Si no lo encuentras, se creará con el nombre y NIF de abajo al registrar." : selectedSupplier?.defaults?.defaultExpenseAccountId ? "Se han aplicado sus valores habituales (cuenta, retención, vencimiento)." : undefined} id={`supplier-${idBase}`} label="Proveedor">
            <SupplierPicker
              disabled={disabled}
              id={`supplier-${idBase}`}
              onChange={selectSupplier}
              onCreateRequested={() => onPatch({ supplierPartnerId: "" })}
              placeholder="Busca por nombre o NIF"
              suppliers={suppliers}
              value={item.supplierPartnerId}
            />
          </AccessibleField>
          {!item.supplierPartnerId ? (
            <>
              <AccessibleField helperText="Nombre o NIF: al menos uno." id={`supplier-name-${idBase}`} label="Nombre del proveedor nuevo">
                <Input disabled={disabled} onChange={(event) => onPatch({ supplierName: event.target.value })} value={item.supplierName} />
              </AccessibleField>
              <AccessibleField id={`supplier-tax-${idBase}`} label="NIF / CIF / VAT">
                <Input disabled={disabled} onChange={(event) => onPatch({ supplierTaxId: event.target.value, duplicate: emptyDuplicate })} value={item.supplierTaxId} />
              </AccessibleField>
            </>
          ) : null}
          <AccessibleField id={`number-${idBase}`} label="N.º de factura" required>
            <Input disabled={disabled} onChange={(event) => onPatch({ supplierDocumentNumber: event.target.value, duplicate: emptyDuplicate })} value={item.supplierDocumentNumber} />
          </AccessibleField>
          <AccessibleField id={`date-${idBase}`} label="Fecha de la factura" required>
            <Input disabled={disabled} onChange={(event) => changeIssueDate(event.target.value)} type="date" value={item.issueDate} />
          </AccessibleField>
          <AccessibleField
            helperText={selectedSupplier?.defaults?.paymentTermsDays !== null && selectedSupplier?.defaults?.paymentTermsDays !== undefined && !item.dueDateEdited && !item.draft?.dueDate ? `Calculado: fecha + ${selectedSupplier.defaults.paymentTermsDays} días de pago del proveedor.` : "Fecha límite para pagarla."}
            id={`due-date-${idBase}`}
            label="Vencimiento"
          >
            <Input disabled={disabled} min={item.issueDate || undefined} onChange={(event) => onPatch({ dueDate: event.target.value, dueDateEdited: true })} type="date" value={item.dueDate} />
          </AccessibleField>
          <AccessibleField helperText={item.currencyCode !== baseCurrencyCode ? `Solo se pueden registrar facturas en ${baseCurrencyCode}.` : undefined} id={`currency-${idBase}`} label="Moneda" required>
            <Input disabled={disabled} maxLength={3} onChange={(event) => onPatch({ currencyCode: event.target.value.toUpperCase() })} value={item.currencyCode} />
          </AccessibleField>
          <AccessibleField helperText="Normalmente automático; cambia solo si la factura indica otra cosa (p. ej. «inversión del sujeto pasivo»)." id={`vat-${idBase}`} label="Tratamiento de IVA">
            <Select disabled={disabled} onChange={(event) => onPatch({ vatTreatment: parseSupplierVatTreatment(event.target.value) ?? "" })} value={item.vatTreatment}>
              <option value="">Automático según el país</option>
              {vatOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </AccessibleField>
        </div>

        <details className="border border-window-shadow bg-window-panel" open={Boolean(item.purchaseOrderId || item.goodsReceiptId)}>
          <summary className="cursor-pointer px-3 py-2 font-mono text-xs font-bold">Relacionar con un pedido o recepción (opcional)</summary>
          <div className="grid gap-3 border-t border-window-shadow p-2.5 sm:grid-cols-2">
            <AccessibleField id={`purchase-order-${idBase}`} label="Pedido de compra">
              <Select disabled={disabled} onChange={(event) => selectPurchaseOrder(event.target.value)} value={item.purchaseOrderId}>
                <option value="">Sin pedido relacionado</option>
                {purchaseOrders.filter((order) => !item.supplierPartnerId || order.supplierPartnerId === item.supplierPartnerId).map((order) => <option key={order.id} value={order.id}>{order.number}</option>)}
              </Select>
            </AccessibleField>
            <AccessibleField id={`goods-receipt-${idBase}`} label="Recepción">
              <Select disabled={disabled} onChange={(event) => selectGoodsReceipt(event.target.value)} value={item.goodsReceiptId}>
                <option value="">Sin recepción relacionada</option>
                {goodsReceipts.filter((receipt) => (item.purchaseOrderId ? receipt.purchaseOrderId === item.purchaseOrderId : !item.supplierPartnerId || receipt.supplierPartnerId === item.supplierPartnerId)).map((receipt) => <option key={receipt.id} value={receipt.id}>{receipt.number}</option>)}
              </Select>
            </AccessibleField>
          </div>
        </details>

        <fieldset className="space-y-2 border border-window-shadow p-2.5">
          <legend className="px-1 font-mono text-xs font-bold">Líneas · {formatMoney(total, item.currencyCode)}</legend>
          <p className="text-xs text-muted-foreground">
            <strong>Base</strong>: importe sin IVA. <strong>Deducible</strong>: parte del IVA que recuperas (100 % si el gasto es solo del negocio).{" "}
            <strong>Retención</strong>: IRPF que te descuenta un profesional (15 %) o el casero de un local (19 %); si la factura no la indica, déjalo en 0.
          </p>
          {item.lines.map((line, lineIndex) => {
            const lineLabel = item.lines.length > 1 ? ` (línea ${lineIndex + 1})` : "";
            const needsAccount = !line.expenseAccountId || line.accountSource === "none";
            const suggestedIds = [line.accountSource !== "none" && line.accountSource !== "user" ? line.expenseAccountId : "", supplierDefaultAccount ?? ""].filter(Boolean);
            return (
              <div className="grid gap-2 border-b border-window-shadow pb-2 last:border-b-0 sm:grid-cols-2 xl:grid-cols-6" key={line.id} role="group" aria-label={`Línea ${lineIndex + 1}`}>
                <AccessibleField className="sm:col-span-2 xl:col-span-3" id={`line-description-${line.id}`} label={`Concepto${lineLabel}`}>
                  <Input disabled={disabled} onChange={(event) => patchLine(line.id, { description: event.target.value })} value={line.description} />
                </AccessibleField>
                <AccessibleField
                  className="sm:col-span-2 xl:col-span-3"
                  error={needsAccount && accountMissing ? "Revisar cuenta: elige en qué se ha gastado." : undefined}
                  helperText={line.accountSource === "ai" || line.accountSource === "ocr" ? "Propuesta por la lectura del documento: compruébala." : line.accountSource === "supplier" ? "Cuenta habitual de este proveedor." : undefined}
                  id={`line-account-${line.id}`}
                  label={`Cuenta de gasto${lineLabel}`}
                >
                  <AccountPicker
                    accounts={expenseAccounts}
                    disabled={disabled}
                    id={`line-account-${line.id}`}
                    onChange={(accountId) => patchLine(line.id, { expenseAccountId: accountId, accountSource: accountId ? "user" : "none" })}
                    recentKey="expense"
                    suggestedIds={suggestedIds}
                    value={line.expenseAccountId}
                  />
                </AccessibleField>
                <AccessibleField id={`quantity-${line.id}`} label={`Cantidad${lineLabel}`}>
                  <QuantityInput disabled={disabled} onChange={(event) => patchLine(line.id, { quantity: event.target.value })} value={line.quantity} />
                </AccessibleField>
                <AccessibleField id={`unitPrice-${line.id}`} label={`Base${lineLabel}`}>
                  <MoneyInput currencySymbol={currencySymbol} disabled={disabled} onChange={(event) => patchLine(line.id, { unitPrice: event.target.value })} value={line.unitPrice} />
                </AccessibleField>
                <AccessibleField id={`taxRate-${line.id}`} label={`IVA${lineLabel}`}>
                  <PercentInput disabled={disabled} onChange={(event) => patchLine(line.id, { taxRate: event.target.value })} value={line.taxRate} />
                </AccessibleField>
                <AccessibleField id={`taxDeductiblePct-${line.id}`} label={`Deducible${lineLabel}`}>
                  <PercentInput disabled={disabled} onChange={(event) => patchLine(line.id, { taxDeductiblePct: event.target.value, deductibleEdited: true })} value={line.taxDeductiblePct} />
                </AccessibleField>
                <AccessibleField id={`retentionRate-${line.id}`} label={`Retención${lineLabel}`}>
                  <PercentInput disabled={disabled} onChange={(event) => patchLine(line.id, { retentionRate: event.target.value })} value={line.retentionRate} />
                </AccessibleField>
                <div className="flex items-end justify-between gap-2">
                  <p className="pb-2 font-mono text-xs font-bold tabular-nums">{formatMoney(reviewLineTotal(line), item.currencyCode)}</p>
                  <Button aria-label={`Eliminar línea ${lineIndex + 1}`} disabled={disabled || item.lines.length === 1} onClick={() => onPatch((current) => ({ ...current, lines: current.lines.filter((candidate) => candidate.id !== line.id) }))} size="icon-sm" title="Eliminar línea" type="button" variant="ghost">
                    <Trash aria-hidden="true" />
                  </Button>
                </div>
              </div>
            );
          })}
          <Button disabled={disabled} onClick={addLine} size="sm" type="button" variant="outline">
            <Plus aria-hidden="true" /> Añadir línea
          </Button>
        </fieldset>

        {warnings.length > 0 ? (
          <div className="border border-warning bg-warning/10 p-2 text-xs text-warning-text">
            <ul className="space-y-0.5">
              {warnings.map((warning) => (
                <li className="flex items-start gap-2" key={warning}><WarningCircle aria-hidden="true" className="mt-0.5 shrink-0" />{warning}</li>
              ))}
            </ul>
            {hasBlocking ? (
              <label className="mt-2 flex items-center gap-2 font-mono font-bold" htmlFor={`ack-blocking-${idBase}`}>
                <input checked={item.acknowledgeBlocking} disabled={disabled} id={`ack-blocking-${idBase}`} onChange={(event) => onPatch({ acknowledgeBlocking: event.target.checked })} type="checkbox" />
                He corregido y revisado los datos bloqueantes
              </label>
            ) : null}
          </div>
        ) : null}
        {totalsMismatch ? (
          <p className="font-mono text-xs text-destructive">
            Las líneas suman {formatMoney(total, item.currencyCode)} y el documento indica {formatMoney(item.draft?.totalAmount ?? 0, item.currencyCode)}. Corrige base, IVA o retención.
          </p>
        ) : null}
        {item.duplicate.level !== "none" ? (
          <div className={cn("border px-3 py-2 text-xs", item.duplicate.level === "exact" ? "border-destructive bg-destructive/10 text-danger-text" : "border-warning bg-warning/10 text-warning-text")} role="status">
            <p className="font-mono font-bold">{item.duplicate.level === "exact" ? "Esta factura ya está registrada" : "Hay otra factura del mismo proveedor, fecha e importe"}</p>
            {item.duplicate.matches.map((match) => <a className="mt-1 block underline" href={`/expenses/${match.invoiceId}`} key={match.invoiceId} rel="noreferrer" target="_blank">Ver {match.number}</a>)}
            {item.duplicate.level === "possible" ? (
              <label className="mt-2 flex items-center gap-2 font-mono font-bold" htmlFor={`ack-possible-${idBase}`}>
                <input checked={item.acknowledgePossible} disabled={disabled} id={`ack-possible-${idBase}`} onChange={(event) => onPatch({ acknowledgePossible: event.target.checked })} type="checkbox" />
                Confirmo que es una factura distinta
              </label>
            ) : null}
          </div>
        ) : null}
        {readiness && !readiness.ready && readiness.reasons.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Pendiente para el registro en bloque: {readiness.reasons.map((reason) => reviewReasonLabels[reason].toLocaleLowerCase("es-ES")).join(" · ")}.
          </p>
        ) : null}
        <FormErrorMessage>{item.error}</FormErrorMessage>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-xs" htmlFor={`reviewed-${idBase}`}>
            <input checked={item.reviewed} disabled={disabled} id={`reviewed-${idBase}`} onChange={(event) => onPatch({ reviewed: event.target.checked })} type="checkbox" />
            Revisada: los datos coinciden con el documento
          </label>
          <SubmitButton className="w-full sm:w-auto" disabled={item.duplicate.level === "exact" || totalsMismatch} pending={item.status === "POSTING"} pendingLabel="Registrando…">
            Registrar factura
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}

"use client";

import { FileText, MagnifyingGlass as Search, Plus, Trash as Trash2, UploadSimple as Upload } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ExpenseBatchUpload } from "@/components/expenses/expense-batch-upload";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput, PercentInput, QuantityInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import {
  isSelfAssessedTreatment,
  resolveSupplierVatTreatment,
  supplierVatTreatmentLabels,
  type SupplierVatTreatment,
} from "@/lib/fiscal-spain";
import { formatMoney, parseDecimalInput } from "@/lib/format";

type ExpenseAccount = { id: string; code: string; name: string };
type Supplier = { id: string; number: string; name: string; taxId: string | null; countryCode?: string | null };

const supplierVatTreatmentOptions = Object.entries(supplierVatTreatmentLabels) as Array<[SupplierVatTreatment, string]>;
type PurchaseOrderRelation = { id: string; number: string; supplierPartnerId: string };
type GoodsReceiptRelation = { id: string; number: string; purchaseOrderId: string; supplierPartnerId: string };

type ExpenseLineDraft = {
  id: string;
  description: string;
  expenseAccountId: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  taxDeductiblePct: string;
  retentionRate: string;
};

type AttachmentDraft = {
  fileName: string;
  fileUrl: string;
};

type CreationMode = "ocr" | "manual";
type SupplierDialogMode = "choice" | "search" | "new";

type CreateExpenseInvoiceFormProps = {
  baseCurrencyCode: string;
  expenseAccounts: ExpenseAccount[];
  goodsReceipts: GoodsReceiptRelation[];
  initialSupplierId?: string;
  purchaseOrders: PurchaseOrderRelation[];
  suppliers: Supplier[];
};

function todayInputValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

const percent = (value: string) => parseDecimalInput(value) ?? Number.NaN;
const money = (value: string) => parseDecimalInput(value, { maximumFractionDigits: 2 }) ?? Number.NaN;

function toIsoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

function newLine(expenseAccountId: string): ExpenseLineDraft {
  return {
    id: crypto.randomUUID(),
    description: "Gasto operativo",
    expenseAccountId,
    quantity: "1",
    unitPrice: "100",
    taxRate: "21",
    taxDeductiblePct: "100",
    retentionRate: "0",
  };
}

function lineTotals(line: ExpenseLineDraft) {
  const quantity = percent(line.quantity);
  const unitPrice = money(line.unitPrice);
  const taxRate = percent(line.taxRate);
  const retentionRate = percent(line.retentionRate);
  const subtotal = Number.isFinite(quantity * unitPrice) ? quantity * unitPrice : 0;
  const tax = subtotal * (Number.isFinite(taxRate) ? taxRate : 0) / 100;
  const retention = subtotal * (Number.isFinite(retentionRate) ? retentionRate : 0) / 100;
  return { subtotal, tax, retention, total: subtotal + tax - retention };
}

export function CreateExpenseInvoiceForm({ baseCurrencyCode, expenseAccounts, goodsReceipts, initialSupplierId, purchaseOrders, suppliers }: CreateExpenseInvoiceFormProps) {
  const router = useRouter();
  const validInitialSupplierId = suppliers.some((supplier) => supplier.id === initialSupplierId) ? initialSupplierId ?? "" : "";
  const [creationMode, setCreationMode] = useState<CreationMode | null>(null);
  const [supplierMode, setSupplierMode] = useState<"existing" | "new">(suppliers.length > 0 ? "existing" : "new");
  const [supplierPartnerId, setSupplierPartnerId] = useState(validInitialSupplierId);
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [goodsReceiptId, setGoodsReceiptId] = useState("");
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [supplierDialogMode, setSupplierDialogMode] = useState<SupplierDialogMode>(suppliers.length > 0 ? "choice" : "new");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierTaxSearch, setSupplierTaxSearch] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierTaxId, setSupplierTaxId] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [supplierAddressLine2, setSupplierAddressLine2] = useState("");
  const [supplierPostalCode, setSupplierPostalCode] = useState("");
  const [supplierCity, setSupplierCity] = useState("");
  const [supplierProvince, setSupplierProvince] = useState("");
  const [supplierCountryCode, setSupplierCountryCode] = useState("ES");
  const [supplierDocumentNumber, setSupplierDocumentNumber] = useState("");
  const [issueDate, setIssueDate] = useState(todayInputValue());
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ExpenseLineDraft[]>([newLine(expenseAccounts[0]?.id ?? "")]);
  const [attachment, setAttachment] = useState<AttachmentDraft>({ fileName: "", fileUrl: "" });
  const [ocrJobId, setOcrJobId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [vatTreatmentOverride, setVatTreatmentOverride] = useState<SupplierVatTreatment | null>(null);
  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierPartnerId) ?? null;
  const supplierCountryForVat = supplierMode === "existing" ? selectedSupplier?.countryCode : supplierCountryCode;
  // Por defecto se deduce del país del proveedor; si el usuario lo cambia, prevalece su elección.
  const vatTreatment = vatTreatmentOverride ?? resolveSupplierVatTreatment(null, supplierCountryForVat);
  const selfAssessedVat = isSelfAssessedTreatment(vatTreatment);
  const availablePurchaseOrders = purchaseOrders.filter((order) => !supplierPartnerId || order.supplierPartnerId === supplierPartnerId);
  const availableGoodsReceipts = goodsReceipts.filter((receipt) => purchaseOrderId
    ? receipt.purchaseOrderId === purchaseOrderId
    : !supplierPartnerId || receipt.supplierPartnerId === supplierPartnerId);

  const preview = useMemo(
    () => lines.reduce(
      (totals, line) => {
        const current = lineTotals(line);
        return {
          subtotal: totals.subtotal + current.subtotal,
          tax: totals.tax + current.tax,
          retention: totals.retention + current.retention,
          total: totals.total + current.total,
        };
      },
      { subtotal: 0, tax: 0, retention: 0, total: 0 },
    ),
    [lines],
  );
  // En autorepercusión el proveedor no cobra el IVA: lo pagadero es base − retención.
  const payable = (totals: { subtotal: number; retention: number; total: number }) => selfAssessedVat ? totals.subtotal - totals.retention : totals.total;

  const filteredSuppliers = useMemo(() => {
    const textQuery = supplierSearch.trim().toLocaleLowerCase();
    const taxQuery = supplierTaxSearch.trim().toLocaleLowerCase();
    return suppliers.filter((supplier) => {
      const text = `${supplier.number} ${supplier.name}`.toLocaleLowerCase();
      const tax = (supplier.taxId ?? "").toLocaleLowerCase();
      return (!textQuery || text.includes(textQuery)) && (!taxQuery || tax.includes(taxQuery));
    });
  }, [supplierSearch, supplierTaxSearch, suppliers]);

  function updateLine(id: string, patch: Partial<ExpenseLineDraft>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [...current, newLine(expenseAccounts[0]?.id ?? "")]);
  }

  function removeLine(id: string) {
    setLines((current) => current.length > 1 ? current.filter((line) => line.id !== id) : current);
  }

  function selectSupplier(supplierId: string) {
    setSupplierPartnerId(supplierId);
    const selected = suppliers.find((supplier) => supplier.id === supplierId);
    setSupplierTaxId(selected?.taxId ?? "");
  }

  function openSupplierDialog(mode: SupplierDialogMode = "choice") {
    setSupplierDialogMode(suppliers.length > 0 ? mode : "new");
    setSupplierDialogOpen(true);
  }

  function chooseExistingSupplier(supplierId: string) {
    setSupplierMode("existing");
    selectSupplier(supplierId);
    if (purchaseOrderId && purchaseOrders.find((order) => order.id === purchaseOrderId)?.supplierPartnerId !== supplierId) {
      setPurchaseOrderId("");
      setGoodsReceiptId("");
    }
    setSupplierName("");
    setSupplierDialogOpen(false);
  }

  function chooseNewSupplier() {
    setSupplierMode("new");
    setSupplierPartnerId("");
    setPurchaseOrderId("");
    setGoodsReceiptId("");
    setSupplierName("");
    setSupplierTaxId("");
    setSupplierDialogMode("new");
  }

  function selectPurchaseOrder(orderId: string) {
    setPurchaseOrderId(orderId);
    if (!orderId) {
      setGoodsReceiptId("");
      return;
    }
    const order = purchaseOrders.find((candidate) => candidate.id === orderId);
    if (order) {
      setSupplierMode("existing");
      selectSupplier(order.supplierPartnerId);
      setSupplierName("");
    }
    if (goodsReceiptId && goodsReceipts.find((receipt) => receipt.id === goodsReceiptId)?.purchaseOrderId !== orderId) {
      setGoodsReceiptId("");
    }
  }

  function selectGoodsReceipt(receiptId: string) {
    setGoodsReceiptId(receiptId);
    if (!receiptId) return;
    const receipt = goodsReceipts.find((candidate) => candidate.id === receiptId);
    if (receipt) {
      setPurchaseOrderId(receipt.purchaseOrderId);
      setSupplierMode("existing");
      selectSupplier(receipt.supplierPartnerId);
      setSupplierName("");
    }
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const nextErrors: Record<string, string> = {};
      if (supplierMode === "existing" && !supplierPartnerId) nextErrors.supplier = "Selecciona el proveedor de la factura.";
      if (supplierMode === "new" && !supplierName.trim() && !supplierTaxId.trim()) nextErrors.supplier = "Indica el nombre o el CIF/NIF del proveedor.";
      if (!issueDate) nextErrors.issueDate = "Indica la fecha de la factura.";
      if (dueDate && issueDate && dueDate < issueDate) nextErrors.dueDate = "El vencimiento no puede ser anterior a la fecha de la factura.";
      const parsedLines = lines.map((line) => {
        const quantity = percent(line.quantity);
        const unitPrice = money(line.unitPrice);
        const taxRate = percent(line.taxRate);
        const taxDeductiblePct = percent(line.taxDeductiblePct);
        const retentionRate = percent(line.retentionRate);
        if (!line.expenseAccountId) nextErrors[`${line.id}-account`] = "Elige la cuenta de gasto.";
        if (!line.description.trim()) nextErrors[`${line.id}-description`] = "Escribe el concepto.";
        if (!Number.isFinite(quantity) || quantity <= 0) nextErrors[`${line.id}-quantity`] = "Debe ser mayor que cero.";
        if (!Number.isFinite(unitPrice) || unitPrice < 0) nextErrors[`${line.id}-price`] = "Indica una base igual o mayor que cero.";
        for (const [key, value] of [["tax", taxRate], ["deductible", taxDeductiblePct], ["retention", retentionRate]] as const) {
          if (!Number.isFinite(value) || value < 0 || value > 100) nextErrors[`${line.id}-${key}`] = "Entre 0 y 100 %.";
        }
        return {
          expenseAccountId: line.expenseAccountId,
          description: line.description,
          quantity,
          unitPrice,
          taxRate,
          taxDeductiblePct,
          retentionRate,
        };
      });
      setFieldErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) {
        const firstKey = Object.keys(nextErrors)[0];
        const targetId = firstKey === "supplier" ? "expense-select-supplier" : firstKey === "issueDate" ? "expense-issue-date" : firstKey === "dueDate" ? "expense-due-date" : `expense-line-${firstKey.slice(firstKey.lastIndexOf("-") + 1)}-${firstKey.slice(0, firstKey.lastIndexOf("-"))}`;
        requestAnimationFrame(() => document.getElementById(targetId)?.focus());
        throw new Error("Revisa los campos marcados antes de registrar la factura.");
      }

      const attachments = !ocrJobId && attachment.fileName.trim() && attachment.fileUrl.trim()
        ? [{ fileName: attachment.fileName, fileUrl: attachment.fileUrl }]
        : undefined;

      const response = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          supplierPartnerId: supplierMode === "existing" ? supplierPartnerId : undefined,
          supplierName: supplierMode === "new" ? supplierName : undefined,
          supplierTaxId: supplierMode === "new" ? supplierTaxId : undefined,
          supplierEmail: supplierMode === "new" ? supplierEmail : undefined,
          supplierPhone: supplierMode === "new" ? supplierPhone : undefined,
          supplierAddress: supplierMode === "new" ? supplierAddress : undefined,
          supplierAddressLine2: supplierMode === "new" ? supplierAddressLine2 : undefined,
          supplierPostalCode: supplierMode === "new" ? supplierPostalCode : undefined,
          supplierCity: supplierMode === "new" ? supplierCity : undefined,
          supplierProvince: supplierMode === "new" ? supplierProvince : undefined,
          supplierCountryCode: supplierMode === "new" ? supplierCountryCode : undefined,
          supplierDocumentNumber,
          purchaseOrderId: purchaseOrderId || undefined,
          goodsReceiptId: goodsReceiptId || undefined,
          issueDate: toIsoDate(issueDate),
          dueDate: dueDate ? toIsoDate(dueDate) : undefined,
          notes,
          ocrJobId: ocrJobId ?? undefined,
          vatTreatment,
          attachments,
          lines: parsedLines,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo registrar la factura de proveedor."));
      const created = (await response.json()) as { id?: string };
      setSupplierName("");
      setSupplierTaxId("");
      setSupplierEmail("");
      setSupplierPhone("");
      setSupplierAddress("");
      setSupplierAddressLine2("");
      setSupplierPostalCode("");
      setSupplierCity("");
      setSupplierProvince("");
      setSupplierCountryCode("ES");
      setVatTreatmentOverride(null);
      setSupplierDocumentNumber("");
      setPurchaseOrderId("");
      setGoodsReceiptId("");
      setIssueDate(todayInputValue());
      setDueDate("");
      setNotes("");
      setLines([newLine(expenseAccounts[0]?.id ?? "")]);
      setAttachment({ fileName: "", fileUrl: "" });
      setOcrJobId(null);
      toast.success("Factura de proveedor contabilizada correctamente.");
      if (created.id) {
        router.push(`/expenses/${created.id}`);
      }
      router.refresh();
    } catch (submissionError) {
      const message = errorMessage(submissionError, "No se pudo registrar la factura de proveedor.");
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!creationMode) {
    const modeCard = "rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 text-left shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)] hover:bg-window-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
    return (
      <div aria-label="Cómo quieres registrar la factura" className="grid gap-3 md:grid-cols-2" role="group">
        <button autoFocus className={modeCard} onClick={() => setCreationMode("ocr")} type="button">
          <Upload className="mb-2 size-5 text-primary" aria-hidden="true" />
          <span className="block font-mono text-sm font-bold">Con OCR (recomendado)</span>
          <span className="mt-1 block text-xs text-muted-foreground">Sube el PDF o la foto de la factura: leemos proveedor, fechas e importes para que solo tengas que revisar.</span>
        </button>
        <button className={modeCard} onClick={() => setCreationMode("manual")} type="button">
          <FileText className="mb-2 size-5 text-primary" aria-hidden="true" />
          <span className="block font-mono text-sm font-bold">Manual</span>
          <span className="mt-1 block text-xs text-muted-foreground">Introduce proveedor, fechas e importes a mano, sin analizar un archivo.</span>
        </button>
      </div>
    );
  }

  if (creationMode === "ocr") {
    return <ExpenseBatchUpload baseCurrencyCode={baseCurrencyCode} expenseAccounts={expenseAccounts} goodsReceipts={goodsReceipts} onBack={() => setCreationMode(null)} purchaseOrders={purchaseOrders} suppliers={suppliers} />;
  }

  const lineError = (line: ExpenseLineDraft, field: string) => fieldErrors[`${line.id}-${field}`];
  const sectionClass = "space-y-3 rounded-[2px] border border-window-dark-shadow bg-card p-3";
  const currencySymbol = baseCurrencyCode === "EUR" ? "€" : baseCurrencyCode;

  return (
    <>
    <form className="space-y-3" noValidate onSubmit={onSubmit}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[2px] border border-window-dark-shadow bg-window-panel p-2">
        <div>
          <p className="font-mono text-xs font-bold">Modo de registro: manual</p>
          <RequiredFieldsNote />
        </div>
        <Button onClick={() => setCreationMode(null)} size="sm" type="button" variant="outline">
          Cambiar modo
        </Button>
      </div>
      {expenseAccounts.length === 0 ? (
        <FormErrorMessage>No hay cuentas de gasto activas. Crea al menos una en Contabilidad › Plan contable (grupo 6) antes de registrar gastos.</FormErrorMessage>
      ) : null}
      <section className={sectionClass} aria-labelledby="expense-supplier-title">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-mono text-sm font-bold" id="expense-supplier-title">Proveedor<span className="text-destructive" aria-hidden="true"> *</span><span className="sr-only"> (obligatorio)</span></h2>
            <p className="text-xs text-muted-foreground">Busca un proveedor existente o crea uno nuevo desde el selector.</p>
          </div>
          <Button aria-describedby={fieldErrors.supplier ? "expense-supplier-error" : undefined} aria-invalid={fieldErrors.supplier ? true : undefined} autoFocus id="expense-select-supplier" onClick={() => openSupplierDialog()} type="button" variant="outline">
            <Search aria-hidden="true" />
            Seleccionar proveedor
          </Button>
        </div>
        {supplierMode === "existing" && selectedSupplier ? (
          <div className="rounded-[2px] border border-window-dark-shadow bg-window-panel p-2">
            <p className="font-mono text-xs font-bold">{selectedSupplier.name}</p>
            <p className="text-xs text-muted-foreground">{selectedSupplier.taxId ?? "Proveedor existente"}</p>
          </div>
        ) : supplierMode === "new" && (supplierName || supplierTaxId) ? (
          <div className="rounded-[2px] border border-window-dark-shadow bg-window-panel p-2">
            <p className="font-mono text-xs font-bold">{supplierName || `Proveedor ${supplierTaxId}`}</p>
            <p className="text-xs text-muted-foreground">{supplierTaxId || "Proveedor nuevo"} · se creará al registrar la factura</p>
          </div>
        ) : (
          <p className="border border-dashed border-window-dark-shadow p-2 text-xs text-muted-foreground">Pulsa «Seleccionar proveedor» para buscarlo o crearlo.</p>
        )}
        {fieldErrors.supplier ? <p className="font-mono text-xs text-destructive" id="expense-supplier-error" role="alert">{fieldErrors.supplier}</p> : null}
        <AccessibleField
          className="md:max-w-sm"
          helperText={selfAssessedVat
            ? "El IVA se autorrepercute: no se paga al proveedor."
            : "Se propone según el país del proveedor; cámbialo si la operación lo requiere."}
          id="expense-vat-treatment"
          label="Tratamiento de IVA"
        >
          <Select onChange={(event) => setVatTreatmentOverride(event.target.value as SupplierVatTreatment)} value={vatTreatment}>
            {supplierVatTreatmentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </AccessibleField>
      </section>

      <section className={sectionClass} aria-labelledby="supplier-invoice-relation-title">
        <div>
          <h2 className="font-mono text-sm font-bold" id="supplier-invoice-relation-title">Relación con compras <span className="font-normal text-muted-foreground">(opcional)</span></h2>
          <p className="text-xs text-muted-foreground">Al elegir una recepción se completan automáticamente su pedido y proveedor.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <AccessibleField id="expense-purchase-order" label="Pedido de compra">
            <Select onChange={(event) => selectPurchaseOrder(event.target.value)} value={purchaseOrderId}>
              <option value="">Sin pedido relacionado</option>
              {availablePurchaseOrders.map((order) => <option key={order.id} value={order.id}>{order.number}</option>)}
            </Select>
          </AccessibleField>
          <AccessibleField id="expense-goods-receipt" label="Recepción de mercancía">
            <Select onChange={(event) => selectGoodsReceipt(event.target.value)} value={goodsReceiptId}>
              <option value="">Sin recepción relacionada</option>
              {availableGoodsReceipts.map((receipt) => <option key={receipt.id} value={receipt.id}>{receipt.number}</option>)}
            </Select>
          </AccessibleField>
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-4">
        <AccessibleField helperText="El número que aparece en la factura recibida." id="expense-supplier-number" label="Factura proveedor">
          <Input onChange={(event) => setSupplierDocumentNumber(event.target.value)} placeholder="FRA-123" value={supplierDocumentNumber} />
        </AccessibleField>
        <AccessibleField error={fieldErrors.issueDate} id="expense-issue-date" label="Fecha" required>
          <Input onChange={(event) => setIssueDate(event.target.value)} required type="date" value={issueDate} />
        </AccessibleField>
        <AccessibleField error={fieldErrors.dueDate} helperText="Opcional: fecha límite de pago." id="expense-due-date" label="Vence">
          <Input min={issueDate || undefined} onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} />
        </AccessibleField>
        <div className="space-y-1">
          {ocrJobId ? (
            <>
              <p className="font-mono text-[0.72rem] font-bold">Adjunto</p>
              <div className="flex min-h-8 items-center justify-between gap-3 rounded-[2px] border border-window-dark-shadow bg-primary/5 px-2 py-1 text-xs">
                <span className="min-w-0"><span className="block truncate font-bold">{attachment.fileName}</span><span className="block text-[0.68rem] text-muted-foreground">Original almacenado · se asociará automáticamente</span></span>
                {attachment.fileUrl ? <a className="shrink-0 font-bold text-primary hover:underline" href={attachment.fileUrl} rel="noreferrer" target="_blank">Abrir</a> : null}
              </div>
            </>
          ) : (
            <div className="grid gap-2">
              <AccessibleField id="expense-attachment-name" label="Adjunto: nombre">
                <Input onChange={(event) => setAttachment((current) => ({ ...current, fileName: event.target.value }))} placeholder="factura.pdf" value={attachment.fileName} />
              </AccessibleField>
              <AccessibleField id="expense-attachment-url" label="Adjunto: enlace">
                <Input onChange={(event) => setAttachment((current) => ({ ...current, fileUrl: event.target.value }))} placeholder="https://..." type="url" value={attachment.fileUrl} />
              </AccessibleField>
            </div>
          )}
        </div>
      </div>

      <section aria-labelledby="expense-lines-title" className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-mono text-sm font-bold" id="expense-lines-title">Líneas</h2>
            <p className="text-xs text-muted-foreground">Base sin IVA. «Ded.» es el porcentaje de IVA deducible; «Ret.» la retención IRPF.</p>
          </div>
          <Button onClick={addLine} size="sm" type="button" variant="outline">
            <Plus aria-hidden="true" />
            Añadir línea
          </Button>
        </div>
        {lines.map((line, index) => (
          <fieldset className="rounded-[2px] border border-window-dark-shadow bg-card p-2" key={line.id}>
            <legend className="sr-only">Línea {index + 1}</legend>
            <div className="grid gap-2 lg:grid-cols-12">
              <AccessibleField className="lg:col-span-3" error={lineError(line, "description")} id={`expense-line-description-${line.id}`} label="Concepto" required>
                <Input onChange={(event) => updateLine(line.id, { description: event.target.value })} required value={line.description} />
              </AccessibleField>
              <AccessibleField className="lg:col-span-3" error={lineError(line, "account")} id={`expense-line-account-${line.id}`} label="Cuenta" required>
                <Select onChange={(event) => updateLine(line.id, { expenseAccountId: event.target.value })} required value={line.expenseAccountId}>
                  {expenseAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.code} - {account.name}</option>
                  ))}
                </Select>
              </AccessibleField>
              <AccessibleField error={lineError(line, "quantity")} id={`expense-line-quantity-${line.id}`} label="Cant." required>
                <QuantityInput onChange={(event) => updateLine(line.id, { quantity: event.target.value })} required value={line.quantity} />
              </AccessibleField>
              <AccessibleField error={lineError(line, "price")} id={`expense-line-price-${line.id}`} label="Base" required>
                <MoneyInput currencySymbol={currencySymbol} onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })} required value={line.unitPrice} />
              </AccessibleField>
              <AccessibleField error={lineError(line, "tax")} id={`expense-line-tax-${line.id}`} label="IVA" required>
                <PercentInput onChange={(event) => updateLine(line.id, { taxRate: event.target.value })} required value={line.taxRate} />
              </AccessibleField>
              <AccessibleField error={lineError(line, "deductible")} id={`expense-line-deductible-${line.id}`} label="Ded." required>
                <PercentInput onChange={(event) => updateLine(line.id, { taxDeductiblePct: event.target.value })} required value={line.taxDeductiblePct} />
              </AccessibleField>
              <AccessibleField error={lineError(line, "retention")} id={`expense-line-retention-${line.id}`} label="Ret." required>
                <PercentInput onChange={(event) => updateLine(line.id, { retentionRate: event.target.value })} required value={line.retentionRate} />
              </AccessibleField>
              <div className="flex items-end justify-between gap-2">
                <p className="pb-2 font-mono text-xs font-bold tabular-nums">{formatMoney(payable(lineTotals(line)), baseCurrencyCode)}</p>
                <Button aria-label={`Eliminar línea ${index + 1}`} disabled={lines.length === 1} onClick={() => removeLine(line.id)} size="icon" title="Eliminar línea" type="button" variant="ghost">
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>
          </fieldset>
        ))}
      </section>

      <div className="grid gap-3 lg:grid-cols-4">
        <AccessibleField className="lg:col-span-3" helperText="Opcional; solo de uso interno." id="expense-notes" label="Notas">
          <Textarea onChange={(event) => setNotes(event.target.value)} value={notes} />
        </AccessibleField>
        <aside aria-label="Total previsto" aria-live="polite" className="border-l-4 border-l-primary bg-window-panel p-3 font-mono text-xs tabular-nums">
          <p className="font-bold uppercase tracking-[0.05em]">Total previsto</p>
          <dl className="mt-1 space-y-0.5">
            <div className="flex justify-between gap-3"><dt>Base</dt><dd>{formatMoney(preview.subtotal, baseCurrencyCode)}</dd></div>
            <div className="flex justify-between gap-3 text-muted-foreground"><dt>{selfAssessedVat ? "IVA autorrepercutido" : "+ IVA"}</dt><dd>{formatMoney(preview.tax, baseCurrencyCode)}</dd></div>
            <div className="flex justify-between gap-3 text-muted-foreground"><dt>− Retención</dt><dd>{formatMoney(preview.retention, baseCurrencyCode)}</dd></div>
          </dl>
          <p className="mt-1 border-t border-window-shadow pt-1 text-lg font-bold">{formatMoney(payable(preview), baseCurrencyCode)}</p>
        </aside>
      </div>

      <FormErrorMessage id="expense-invoice-error">{error}</FormErrorMessage>
      <FormActions sticky>
        <SubmitButton disabled={expenseAccounts.length === 0} pending={isLoading} pendingLabel="Registrando…">
          Registrar factura
        </SubmitButton>
      </FormActions>
    </form>
    <Dialog
      description="Busca un proveedor existente o prepara uno nuevo para esta factura."
      initialFocusId={supplierDialogMode === "search" ? "expense-supplier-search" : "expense-new-supplier-name"}
      onClose={() => setSupplierDialogOpen(false)}
      open={supplierDialogOpen}
      size="xl"
      title="Seleccionar proveedor"
    >
      {supplierDialogMode === "choice" ? (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">Elige si quieres buscar un proveedor existente o crear uno nuevo para esta factura.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className="rounded-[2px] border border-window-dark-shadow bg-window-panel p-2 text-left hover:bg-window-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              onClick={() => setSupplierDialogMode("search")}
              type="button"
            >
              <span className="block font-mono text-xs font-bold">Buscar existente</span>
              <span className="mt-1 block text-xs text-muted-foreground">Selecciona un proveedor ya registrado.</span>
            </button>
            <button
              className="rounded-[2px] border border-window-dark-shadow bg-window-panel p-2 text-left hover:bg-window-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              onClick={chooseNewSupplier}
              type="button"
            >
              <span className="block font-mono text-xs font-bold">Crear nuevo</span>
              <span className="mt-1 block text-xs text-muted-foreground">Añade los datos fiscales mínimos.</span>
            </button>
          </div>
        </div>
      ) : null}

      {supplierDialogMode === "search" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <AccessibleField id="expense-supplier-search" label="Número o nombre del proveedor">
              <Input onChange={(event) => setSupplierSearch(event.target.value)} value={supplierSearch} />
            </AccessibleField>
            <AccessibleField id="expense-supplier-tax-search" label="CIF/NIF">
              <Input onChange={(event) => setSupplierTaxSearch(event.target.value)} value={supplierTaxSearch} />
            </AccessibleField>
          </div>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {filteredSuppliers.length === 0 ? (
              <p className="border border-dashed border-window-dark-shadow p-2 text-xs text-muted-foreground">No hay proveedores que coincidan con la búsqueda.</p>
            ) : (
              filteredSuppliers.map((supplier) => (
                <button
                  className="w-full rounded-[2px] border border-window-dark-shadow bg-window-panel p-2 text-left hover:bg-window-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  key={supplier.id}
                  onClick={() => chooseExistingSupplier(supplier.id)}
                  type="button"
                >
                  <span className="block font-mono text-xs font-bold">{supplier.number} · {supplier.name}</span>
                  <span className="block text-xs text-muted-foreground">{supplier.taxId ?? "Proveedor registrado"}</span>
                </button>
              ))
            )}
          </div>
          <div className="flex justify-between gap-2">
            <Button onClick={chooseNewSupplier} type="button" variant="secondary">
              Crear nuevo proveedor
            </Button>
            <Button onClick={() => setSupplierDialogMode("choice")} type="button" variant="outline">
              Volver
            </Button>
          </div>
        </div>
      ) : null}

      {supplierDialogMode === "new" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <AccessibleField className="md:col-span-2" id="expense-new-supplier-name" label="Nombre / razón social">
              <Input onChange={(event) => setSupplierName(event.target.value)} value={supplierName} />
            </AccessibleField>
          <AccessibleField id="expense-new-supplier-tax-id" label="CIF/NIF">
              <Input onChange={(event) => setSupplierTaxId(event.target.value)} placeholder="B12345674" value={supplierTaxId} />
            </AccessibleField>
          <AccessibleField id="expense-new-supplier-country" label="País">
              <Input maxLength={2} onChange={(event) => setSupplierCountryCode(event.target.value.toUpperCase())} value={supplierCountryCode} />
            </AccessibleField>
          <AccessibleField id="expense-new-supplier-email" label="Email">
              <Input onChange={(event) => setSupplierEmail(event.target.value)} type="email" value={supplierEmail} />
            </AccessibleField>
          <AccessibleField id="expense-new-supplier-phone" label="Teléfono">
              <Input onChange={(event) => setSupplierPhone(event.target.value)} value={supplierPhone} />
            </AccessibleField>
          <AccessibleField className="md:col-span-2" id="expense-new-supplier-address" label="Dirección fiscal">
              <Input onChange={(event) => setSupplierAddress(event.target.value)} value={supplierAddress} />
            </AccessibleField>
          <AccessibleField className="md:col-span-2" id="expense-new-supplier-address-2" label="Dirección 2">
              <Input onChange={(event) => setSupplierAddressLine2(event.target.value)} value={supplierAddressLine2} />
            </AccessibleField>
          <AccessibleField id="expense-new-supplier-postal-code" label="CP">
              <Input onChange={(event) => setSupplierPostalCode(event.target.value)} value={supplierPostalCode} />
            </AccessibleField>
          <AccessibleField id="expense-new-supplier-city" label="Ciudad">
              <Input onChange={(event) => setSupplierCity(event.target.value)} value={supplierCity} />
            </AccessibleField>
          <AccessibleField id="expense-new-supplier-province" label="Provincia">
              <Input onChange={(event) => setSupplierProvince(event.target.value)} value={supplierProvince} />
            </AccessibleField>
          <div className="flex items-end gap-2">
            <Button
              onClick={() => {
                setSupplierMode("new");
                setSupplierPartnerId("");
                setPurchaseOrderId("");
                setGoodsReceiptId("");
                setSupplierDialogOpen(false);
              }}
              type="button"
            >
              Usar este proveedor
            </Button>
          </div>
          <div className="flex gap-2 md:col-span-2">
            {suppliers.length > 0 ? (
              <Button onClick={() => setSupplierDialogMode("search")} type="button" variant="secondary">
                Buscar existente
              </Button>
            ) : null}
            <Button onClick={() => setSupplierDialogOpen(false)} type="button" variant="outline">
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
    </>
  );
}

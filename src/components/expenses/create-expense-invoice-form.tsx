"use client";

import { Camera, FileText, Paperclip, Plus, Trash as Trash2, UploadSimple as Upload } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { SupplierPicker, searchSuppliers } from "@/components/suppliers/supplier-picker";
import { AccountPicker } from "@/components/ui/account-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput, PercentInput, QuantityInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AccountOption } from "@/lib/account-aliases";
import { getCsrfHeader } from "@/lib/csrf-client";
import { normalizeTaxIdentity } from "@/lib/expense-dedup";
import { isSelfAssessedTreatment, resolveSupplierVatTreatment, supplierVatTreatmentLabels, type SupplierVatTreatment } from "@/lib/fiscal-spain";
import { formatMoney, parseDecimalInput } from "@/lib/format";
import { applySupplierDefaultsToLine, dueDateInputFor, parseSupplierVatTreatment, SUPPLIER_VAT_TREATMENTS, type AccountSource, type SupplierDefaults } from "@/lib/supplier-defaults";

import type { DuplicateAssessment } from "./expense-batch-model";

type Supplier = { id: string; number: string; name: string; taxId: string | null; countryCode?: string | null; isActive?: boolean; defaults?: SupplierDefaults };
type PurchaseOrderRelation = { id: string; number: string; supplierPartnerId: string };
type GoodsReceiptRelation = { id: string; number: string; purchaseOrderId: string; supplierPartnerId: string };

const vatOptions = SUPPLIER_VAT_TREATMENTS.map((treatment) => [treatment, supplierVatTreatmentLabels[treatment]] as const);

type ExpenseLineDraft = {
  id: string;
  description: string;
  expenseAccountId: string;
  accountSource: AccountSource;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  taxDeductiblePct: string;
  retentionRate: string;
  deductibleEdited: boolean;
};

type UploadedAttachment = { jobId: string; fileName: string; fileUrl: string | null };

type NewSupplierDraft = {
  name: string;
  taxId: string;
  countryCode: string;
  email: string;
  phone: string;
  address: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  province: string;
};

const emptyNewSupplier: NewSupplierDraft = { name: "", taxId: "", countryCode: "ES", email: "", phone: "", address: "", addressLine2: "", postalCode: "", city: "", province: "" };

type CreateExpenseInvoiceFormProps = {
  baseCurrencyCode: string;
  expenseAccounts: AccountOption[];
  goodsReceipts: GoodsReceiptRelation[];
  initialSupplierId?: string;
  purchaseOrders: PurchaseOrderRelation[];
  suppliers: Supplier[];
  /** Documentos esperando en la bandeja (se ofrece continuar con ellos). */
  pendingInboxCount?: number;
};

const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

function todayInputValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

const decimal = (value: string) => parseDecimalInput(value) ?? Number.NaN;
const money = (value: string) => parseDecimalInput(value, { maximumFractionDigits: 2 }) ?? Number.NaN;

function toIsoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

/** Línea vacía: sin concepto ni importe inventados y sin cuenta elegida en silencio. */
function newLine(defaults?: SupplierDefaults, id: string = crypto.randomUUID()): ExpenseLineDraft {
  const line: ExpenseLineDraft = {
    id,
    description: "",
    expenseAccountId: "",
    accountSource: "none",
    quantity: "1",
    unitPrice: "",
    taxRate: "21",
    taxDeductiblePct: "100",
    retentionRate: "0",
    deductibleEdited: false,
  };
  return defaults ? applySupplierDefaultsToLine(line, defaults) : line;
}

function lineTotals(line: ExpenseLineDraft) {
  const quantity = decimal(line.quantity);
  const unitPrice = money(line.unitPrice);
  const taxRate = decimal(line.taxRate);
  const retentionRate = decimal(line.retentionRate);
  const subtotal = Number.isFinite(quantity * unitPrice) ? quantity * unitPrice : 0;
  const tax = subtotal * (Number.isFinite(taxRate) ? taxRate : 0) / 100;
  const retention = subtotal * (Number.isFinite(retentionRate) ? retentionRate : 0) / 100;
  return { subtotal, tax, retention, total: subtotal + tax - retention };
}

export function CreateExpenseInvoiceForm({ baseCurrencyCode, expenseAccounts, goodsReceipts, initialSupplierId, pendingInboxCount = 0, purchaseOrders, suppliers }: CreateExpenseInvoiceFormProps) {
  const router = useRouter();
  const initialSupplier = suppliers.find((supplier) => supplier.id === initialSupplierId);
  const [creationMode, setCreationMode] = useState<"manual" | null>(initialSupplier ? "manual" : null);
  const [supplierPartnerId, setSupplierPartnerId] = useState(initialSupplier?.id ?? "");
  const [newSupplier, setNewSupplier] = useState<NewSupplierDraft | null>(null);
  const [newSupplierDialogOpen, setNewSupplierDialogOpen] = useState(false);
  const [newSupplierDraft, setNewSupplierDraft] = useState<NewSupplierDraft>(emptyNewSupplier);
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [goodsReceiptId, setGoodsReceiptId] = useState("");
  const [supplierDocumentNumber, setSupplierDocumentNumber] = useState("");
  const [issueDate, setIssueDate] = useState(todayInputValue);
  const [dueDate, setDueDate] = useState(() => dueDateInputFor(todayInputValue(), initialSupplier?.defaults?.paymentTermsDays));
  const [dueDateEdited, setDueDateEdited] = useState(false);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ExpenseLineDraft[]>(() => [newLine(initialSupplier?.defaults, "line-1")]);
  const [attachment, setAttachment] = useState<UploadedAttachment | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [vatTreatmentOverride, setVatTreatmentOverride] = useState<SupplierVatTreatment | null>(initialSupplier?.defaults?.defaultVatTreatment ?? null);
  const [duplicate, setDuplicate] = useState<DuplicateAssessment | null>(null);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);

  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierPartnerId) ?? null;
  const supplierDefaults = selectedSupplier?.defaults;
  const supplierCountryForVat = selectedSupplier ? selectedSupplier.countryCode : newSupplier?.countryCode;
  // Por defecto se deduce del país del proveedor (o su valor habitual); si el usuario lo cambia, prevalece su elección.
  const vatTreatment = vatTreatmentOverride ?? resolveSupplierVatTreatment(null, supplierCountryForVat);
  const selfAssessedVat = isSelfAssessedTreatment(vatTreatment);
  const availablePurchaseOrders = purchaseOrders.filter((order) => !supplierPartnerId || order.supplierPartnerId === supplierPartnerId);
  const availableGoodsReceipts = goodsReceipts.filter((receipt) => (purchaseOrderId ? receipt.purchaseOrderId === purchaseOrderId : !supplierPartnerId || receipt.supplierPartnerId === supplierPartnerId));
  const supplierSuggestionIds = supplierDefaults?.defaultExpenseAccountId ? [supplierDefaults.defaultExpenseAccountId] : [];

  const preview = useMemo(
    () => lines.reduce(
      (totals, line) => {
        const current = lineTotals(line);
        return { subtotal: totals.subtotal + current.subtotal, tax: totals.tax + current.tax, retention: totals.retention + current.retention, total: totals.total + current.total };
      },
      { subtotal: 0, tax: 0, retention: 0, total: 0 },
    ),
    [lines],
  );
  // En autorepercusión el proveedor no cobra el IVA: lo pagadero es base − retención.
  const payable = (totals: { subtotal: number; retention: number; total: number }) => (selfAssessedVat ? totals.subtotal - totals.retention : totals.total);

  // Coincidencias con proveedores existentes mientras se escribe uno nuevo (evita duplicados).
  const existingMatches = useMemo(() => {
    const taxKey = normalizeTaxIdentity(newSupplierDraft.taxId, newSupplierDraft.countryCode);
    const byTax = taxKey.length >= 5 ? suppliers.filter((supplier) => normalizeTaxIdentity(supplier.taxId, newSupplierDraft.countryCode) === taxKey) : [];
    const byName = newSupplierDraft.name.trim().length >= 3 ? searchSuppliers(suppliers, newSupplierDraft.name, 5) : [];
    return [...new Map([...byTax, ...byName].map((supplier) => [supplier.id, supplier])).values()].slice(0, 5);
  }, [newSupplierDraft.countryCode, newSupplierDraft.name, newSupplierDraft.taxId, suppliers]);
  const exactTaxMatch = existingMatches.find((supplier) => {
    const taxKey = normalizeTaxIdentity(newSupplierDraft.taxId, newSupplierDraft.countryCode);
    return taxKey.length >= 5 && normalizeTaxIdentity(supplier.taxId, newSupplierDraft.countryCode) === taxKey;
  });

  function resetDuplicate() {
    setDuplicate(null);
    setDuplicateAcknowledged(false);
  }

  function updateLine(id: string, patch: Partial<ExpenseLineDraft>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
    resetDuplicate();
  }

  function chooseSupplier(supplierId: string) {
    const supplier = suppliers.find((candidate) => candidate.id === supplierId);
    setSupplierPartnerId(supplierId);
    setNewSupplier(null);
    resetDuplicate();
    if (purchaseOrderId && purchaseOrders.find((order) => order.id === purchaseOrderId)?.supplierPartnerId !== supplierId) {
      setPurchaseOrderId("");
      setGoodsReceiptId("");
    }
    const defaults = supplier?.defaults;
    if (!defaults) return;
    // Valores habituales del proveedor: sin pisar lo que el usuario ya ha elegido.
    setLines((current) => current.map((line) => applySupplierDefaultsToLine(line, defaults, { userEditedDeductible: line.deductibleEdited })));
    if (defaults.defaultVatTreatment) setVatTreatmentOverride(defaults.defaultVatTreatment);
    if (!dueDateEdited) setDueDate(dueDateInputFor(issueDate, defaults.paymentTermsDays));
  }

  function changeIssueDate(value: string) {
    setIssueDate(value);
    resetDuplicate();
    if (!dueDateEdited) setDueDate(dueDateInputFor(value, supplierDefaults?.paymentTermsDays));
  }

  function openNewSupplierDialog(query: string) {
    const looksLikeTaxId = /^[A-Z0-9]{8,}$/i.test(query.replace(/[\s.-]/g, "")) && /\d/.test(query);
    setNewSupplierDraft({ ...emptyNewSupplier, ...(newSupplier ?? {}), ...(query ? (looksLikeTaxId ? { taxId: query } : { name: query }) : {}) });
    setNewSupplierDialogOpen(true);
  }

  function confirmNewSupplier() {
    if (!newSupplierDraft.name.trim() && !newSupplierDraft.taxId.trim()) {
      toast.error("Indica al menos el nombre o el NIF del proveedor.");
      return;
    }
    if (exactTaxMatch) {
      chooseSupplier(exactTaxMatch.id);
      setNewSupplierDialogOpen(false);
      toast.info(`Ya existía ${exactTaxMatch.name} con ese NIF: se usa el existente.`);
      return;
    }
    setSupplierPartnerId("");
    setNewSupplier(newSupplierDraft);
    setPurchaseOrderId("");
    setGoodsReceiptId("");
    resetDuplicate();
    setNewSupplierDialogOpen(false);
  }

  function selectPurchaseOrder(orderId: string) {
    setPurchaseOrderId(orderId);
    if (!orderId) {
      setGoodsReceiptId("");
      return;
    }
    const order = purchaseOrders.find((candidate) => candidate.id === orderId);
    if (order && order.supplierPartnerId !== supplierPartnerId) chooseSupplier(order.supplierPartnerId);
    if (goodsReceiptId && goodsReceipts.find((receipt) => receipt.id === goodsReceiptId)?.purchaseOrderId !== orderId) setGoodsReceiptId("");
  }

  function selectGoodsReceipt(receiptId: string) {
    setGoodsReceiptId(receiptId);
    if (!receiptId) return;
    const receipt = goodsReceipts.find((candidate) => candidate.id === receiptId);
    if (receipt) {
      setPurchaseOrderId(receipt.purchaseOrderId);
      if (receipt.supplierPartnerId !== supplierPartnerId) chooseSupplier(receipt.supplierPartnerId);
    }
  }

  async function uploadAttachment(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(`${file.name} supera el límite de 12 MB.`);
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/expenses/attachments", { method: "POST", headers: getCsrfHeader(), body: formData });
      if (!response.ok) throw new Error(await readApiError(response, `No se pudo subir ${file.name}.`));
      const payload = (await response.json()) as { id: string; fileName: string; fileUrl: string | null };
      setAttachment({ jobId: payload.id, fileName: payload.fileName, fileUrl: payload.fileUrl });
      resetDuplicate();
      toast.success("Justificante adjuntado.");
    } catch (uploadError) {
      toast.error(errorMessage(uploadError, "No se pudo subir el archivo."));
    } finally {
      setIsUploading(false);
    }
  }

  async function checkDuplicate(total: number) {
    const response = await fetch("/api/expenses/duplicate-check", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getCsrfHeader() },
      body: JSON.stringify({
        supplierPartnerId: supplierPartnerId || undefined,
        supplierTaxId: supplierPartnerId ? undefined : newSupplier?.taxId || undefined,
        supplierName: supplierPartnerId ? undefined : newSupplier?.name || undefined,
        supplierCountryCode: supplierPartnerId ? undefined : newSupplier?.countryCode || undefined,
        supplierDocumentNumber: supplierDocumentNumber || undefined,
        issueDate: toIsoDate(issueDate),
        totalAmount: Math.max(Math.round(total * 100) / 100, 0),
        ocrJobId: attachment?.jobId,
      }),
    });
    if (!response.ok) throw new Error(await readApiError(response, "No se pudo comprobar si la factura ya está registrada."));
    return (await response.json()) as DuplicateAssessment;
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const nextErrors: Record<string, string> = {};
    if (!supplierPartnerId && !newSupplier) nextErrors.supplier = "Elige el proveedor o créalo.";
    if (!issueDate) nextErrors.issueDate = "Indica la fecha de la factura.";
    if (dueDate && issueDate && dueDate < issueDate) nextErrors.dueDate = "El vencimiento no puede ser anterior a la fecha de la factura.";
    const parsedLines = lines.map((line) => {
      const quantity = decimal(line.quantity);
      const unitPrice = money(line.unitPrice);
      const taxRate = decimal(line.taxRate);
      const taxDeductiblePct = decimal(line.taxDeductiblePct);
      const retentionRate = decimal(line.retentionRate);
      if (!line.description.trim()) nextErrors[`${line.id}-description`] = "Escribe el concepto (p. ej. «Luz de marzo»).";
      if (!line.expenseAccountId) nextErrors[`${line.id}-account`] = "Elige en qué se ha gastado: busca por palabra (luz, alquiler, gestoría…).";
      if (!Number.isFinite(quantity) || quantity <= 0) nextErrors[`${line.id}-quantity`] = "Debe ser mayor que cero.";
      if (!Number.isFinite(unitPrice) || unitPrice < 0) nextErrors[`${line.id}-price`] = "Indica el importe sin IVA (p. ej. 100,00).";
      for (const [key, value] of [["tax", taxRate], ["deductible", taxDeductiblePct], ["retention", retentionRate]] as const) {
        if (!Number.isFinite(value) || value < 0 || value > 100) nextErrors[`${line.id}-${key}`] = "Entre 0 y 100 %.";
      }
      return { expenseAccountId: line.expenseAccountId, description: line.description.trim(), quantity, unitPrice, taxRate, taxDeductiblePct, retentionRate };
    });
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const firstKey = Object.keys(nextErrors)[0];
      const fieldMap: Record<string, string> = { account: "account", description: "description", quantity: "quantity", price: "price", tax: "tax", deductible: "deductible", retention: "retention" };
      const separator = firstKey.lastIndexOf("-");
      const targetId = firstKey === "supplier" ? "expense-supplier" : firstKey === "issueDate" ? "expense-issue-date" : firstKey === "dueDate" ? "expense-due-date" : `expense-line-${fieldMap[firstKey.slice(separator + 1)]}-${firstKey.slice(0, separator)}`;
      requestAnimationFrame(() => document.getElementById(targetId)?.focus());
      const message = "Revisa los campos marcados antes de registrar la factura.";
      setError(message);
      toast.error(message);
      return;
    }

    setIsLoading(true);
    try {
      // Antes de contabilizar: ¿ya existe esta factura (mismo proveedor y número, o misma fecha e importe)?
      if (!duplicateAcknowledged) {
        const assessment = await checkDuplicate(payable(preview));
        if (assessment.level !== "none") {
          setDuplicate(assessment);
          const message = assessment.level === "exact"
            ? "Esta factura ya está registrada (mismo proveedor y número o mismo archivo). Revisa la existente."
            : "Hay otra factura del mismo proveedor con la misma fecha e importe. Confirma abajo que es distinta para registrarla.";
          setError(message);
          toast.error(message);
          requestAnimationFrame(() => document.getElementById("expense-duplicate-warning")?.focus());
          return;
        }
      } else if (duplicate?.level === "exact") {
        return;
      }

      const response = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          supplierPartnerId: supplierPartnerId || undefined,
          supplierName: supplierPartnerId ? undefined : newSupplier?.name,
          supplierTaxId: supplierPartnerId ? undefined : newSupplier?.taxId,
          supplierEmail: supplierPartnerId ? undefined : newSupplier?.email,
          supplierPhone: supplierPartnerId ? undefined : newSupplier?.phone,
          supplierAddress: supplierPartnerId ? undefined : newSupplier?.address,
          supplierAddressLine2: supplierPartnerId ? undefined : newSupplier?.addressLine2,
          supplierPostalCode: supplierPartnerId ? undefined : newSupplier?.postalCode,
          supplierCity: supplierPartnerId ? undefined : newSupplier?.city,
          supplierProvince: supplierPartnerId ? undefined : newSupplier?.province,
          supplierCountryCode: supplierPartnerId ? undefined : newSupplier?.countryCode,
          supplierDocumentNumber,
          purchaseOrderId: purchaseOrderId || undefined,
          goodsReceiptId: goodsReceiptId || undefined,
          issueDate: toIsoDate(issueDate),
          dueDate: dueDate ? toIsoDate(dueDate) : undefined,
          notes,
          ocrJobId: attachment?.jobId,
          vatTreatment,
          lines: parsedLines,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo registrar la factura de proveedor."));
      const created = (await response.json()) as { id?: string };
      toast.success("Factura de proveedor registrada y contabilizada.");
      if (created.id) router.push(`/expenses/${created.id}`);
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
    const modeCard = "block rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 text-left shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)] hover:bg-window-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
    return (
      <div className="space-y-3">
        <div aria-label="Cómo quieres registrar la factura" className="grid gap-3 md:grid-cols-2" role="group">
          <Link autoFocus className={modeCard} href="/expenses/inbox">
            <Upload className="mb-2 size-5 text-primary" aria-hidden="true" />
            <span className="block font-mono text-sm font-bold">Subir o fotografiar (recomendado)</span>
            <span className="mt-1 block text-xs text-muted-foreground">Sube PDF o fotos de una o varias facturas: se leen solas y solo tienes que revisarlas junto a la imagen.</span>
            <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary sm:hidden"><Camera aria-hidden="true" /> Puedes hacer la foto con el móvil</span>
          </Link>
          <button className={modeCard} onClick={() => setCreationMode("manual")} type="button">
            <FileText className="mb-2 size-5 text-primary" aria-hidden="true" />
            <span className="block font-mono text-sm font-bold">Escribirla a mano</span>
            <span className="mt-1 block text-xs text-muted-foreground">Introduce proveedor, fechas e importes tú mismo; puedes adjuntar el justificante.</span>
          </button>
        </div>
        {pendingInboxCount > 0 ? (
          <p className="text-xs">
            Tienes {pendingInboxCount === 1 ? "1 documento" : `${pendingInboxCount} documentos`} esperando revisión en la{" "}
            <Link className="font-bold text-primary underline" href="/expenses/inbox">bandeja pendiente</Link>.
          </p>
        ) : null}
      </div>
    );
  }

  const lineError = (line: ExpenseLineDraft, field: string) => fieldErrors[`${line.id}-${field}`];
  const sectionClass = "space-y-3 rounded-[2px] border border-window-dark-shadow bg-card p-3";
  const currencySymbol = baseCurrencyCode === "EUR" ? "€" : baseCurrencyCode;

  return (
    <>
      <form className="space-y-3" noValidate onSubmit={onSubmit}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[2px] border border-window-dark-shadow bg-window-panel p-2">
          <div>
            <p className="font-mono text-xs font-bold">Registro a mano</p>
            <RequiredFieldsNote />
          </div>
          <Button onClick={() => setCreationMode(null)} size="sm" type="button" variant="outline">Cambiar modo</Button>
        </div>
        {expenseAccounts.length === 0 ? (
          <FormErrorMessage>No hay cuentas de gasto activas. Crea al menos una en Contabilidad › Plan contable (grupo 6) antes de registrar gastos.</FormErrorMessage>
        ) : null}

        <section className={sectionClass} aria-labelledby="expense-supplier-title">
          <h2 className="font-mono text-sm font-bold" id="expense-supplier-title">Proveedor</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <AccessibleField
              error={fieldErrors.supplier}
              helperText={newSupplier ? `Nuevo: ${newSupplier.name || newSupplier.taxId}${newSupplier.taxId && newSupplier.name ? ` · ${newSupplier.taxId}` : ""}. Se dará de alta al registrar la factura.` : "Busca por nombre o NIF. Si no existe, elige «Crear proveedor»."}
              id="expense-supplier"
              label="Proveedor"
              required
            >
              <SupplierPicker id="expense-supplier" onChange={chooseSupplier} onCreateRequested={openNewSupplierDialog} suppliers={suppliers} value={supplierPartnerId} />
            </AccessibleField>
            <AccessibleField
              helperText={selfAssessedVat ? "El IVA lo declaras tú (autorrepercusión): no se paga al proveedor." : "Se propone según el país o el valor habitual del proveedor; cámbialo solo si la factura lo indica."}
              id="expense-vat-treatment"
              label="Tratamiento de IVA"
            >
              <Select onChange={(event) => setVatTreatmentOverride(parseSupplierVatTreatment(event.target.value))} value={vatTreatment}>
                {vatOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </AccessibleField>
          </div>
        </section>

        <div className="grid gap-3 lg:grid-cols-4">
          <AccessibleField helperText="El número que aparece en la factura recibida. Sirve para detectar duplicados." id="expense-supplier-number" label="N.º de factura del proveedor">
            <Input onChange={(event) => { setSupplierDocumentNumber(event.target.value); resetDuplicate(); }} placeholder="Ej. F-2026-0123" value={supplierDocumentNumber} />
          </AccessibleField>
          <AccessibleField error={fieldErrors.issueDate} id="expense-issue-date" label="Fecha de la factura" required>
            <Input onChange={(event) => changeIssueDate(event.target.value)} required type="date" value={issueDate} />
          </AccessibleField>
          <AccessibleField
            error={fieldErrors.dueDate}
            helperText={!dueDateEdited && supplierDefaults?.paymentTermsDays !== null && supplierDefaults?.paymentTermsDays !== undefined ? `Calculado con los ${supplierDefaults.paymentTermsDays} días de pago del proveedor.` : "Opcional: fecha límite para pagarla."}
            id="expense-due-date"
            label="Vencimiento"
          >
            <Input min={issueDate || undefined} onChange={(event) => { setDueDate(event.target.value); setDueDateEdited(true); }} type="date" value={dueDate} />
          </AccessibleField>
          <div className="space-y-1">
            <p className="font-mono text-[0.72rem] font-bold">Justificante</p>
            {attachment ? (
              <div className="flex min-h-8 items-center justify-between gap-2 rounded-[2px] border border-window-dark-shadow bg-primary/5 px-2 py-1 text-xs">
                <span className="flex min-w-0 items-center gap-1"><Paperclip aria-hidden="true" className="shrink-0" /><span className="truncate font-bold">{attachment.fileName}</span></span>
                <span className="flex shrink-0 gap-2">
                  {attachment.fileUrl ? <a className="font-bold text-primary hover:underline" href={attachment.fileUrl} rel="noreferrer" target="_blank">Ver</a> : null}
                  <button className="font-bold text-destructive hover:underline" onClick={() => setAttachment(null)} type="button">Quitar</button>
                </span>
              </div>
            ) : (
              <label className="flex min-h-8 cursor-pointer items-center justify-center gap-2 border border-dashed border-window-dark-shadow bg-card px-2 py-1 text-xs font-bold hover:bg-window-highlight has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus" htmlFor="expense-attachment-file">
                <Paperclip aria-hidden="true" /> {isUploading ? "Subiendo…" : "Adjuntar PDF o foto"}
                <input
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  aria-describedby="expense-attachment-help"
                  className="sr-only"
                  disabled={isUploading}
                  id="expense-attachment-file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void uploadAttachment(file);
                  }}
                  type="file"
                />
              </label>
            )}
            <p className="text-xs text-muted-foreground" id="expense-attachment-help">Opcional · máx. 12 MB. Se guarda con la factura.</p>
          </div>
        </div>

        <details className={sectionClass} open={Boolean(purchaseOrderId || goodsReceiptId)}>
          <summary className="cursor-pointer font-mono text-sm font-bold">Relacionar con un pedido de compra <span className="font-normal text-muted-foreground">(opcional)</span></summary>
          <p className="text-xs text-muted-foreground">Al elegir una recepción se completan su pedido y proveedor.</p>
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
        </details>

        <section aria-labelledby="expense-lines-title" className="space-y-2">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="font-mono text-sm font-bold" id="expense-lines-title">Qué has comprado</h2>
              <p className="text-xs text-muted-foreground">
                <strong>Base</strong>: importe sin IVA. <strong>Deducible</strong>: parte del IVA que recuperas (100 % si es solo del negocio).{" "}
                <strong>Retención</strong>: IRPF que te descuenta un profesional (15 %) o un alquiler (19 %); si la factura no la muestra, 0.
              </p>
            </div>
            <Button onClick={() => setLines((current) => [...current, newLine(supplierDefaults)])} size="sm" type="button" variant="outline">
              <Plus aria-hidden="true" />
              Añadir línea
            </Button>
          </div>
          {lines.map((line, index) => (
            <fieldset className="rounded-[2px] border border-window-dark-shadow bg-card p-2" key={line.id}>
              <legend className="sr-only">Línea {index + 1}</legend>
              <div className="grid gap-2 lg:grid-cols-12">
                <AccessibleField className="lg:col-span-3" error={lineError(line, "description")} id={`expense-line-description-${line.id}`} label="Concepto" required>
                  <Input onChange={(event) => updateLine(line.id, { description: event.target.value })} placeholder="Ej. Luz de marzo" required value={line.description} />
                </AccessibleField>
                <AccessibleField
                  className="lg:col-span-3"
                  error={lineError(line, "account")}
                  helperText={line.accountSource === "supplier" ? "Cuenta habitual del proveedor." : undefined}
                  id={`expense-line-account-${line.id}`}
                  label="Tipo de gasto (cuenta)"
                  required
                >
                  <AccountPicker
                    accounts={expenseAccounts}
                    id={`expense-line-account-${line.id}`}
                    onChange={(accountId) => updateLine(line.id, { expenseAccountId: accountId, accountSource: accountId ? "user" : "none" })}
                    recentKey="expense"
                    suggestedIds={supplierSuggestionIds}
                    value={line.expenseAccountId}
                  />
                </AccessibleField>
                <AccessibleField error={lineError(line, "quantity")} id={`expense-line-quantity-${line.id}`} label="Cant." required>
                  <QuantityInput onChange={(event) => updateLine(line.id, { quantity: event.target.value })} required value={line.quantity} />
                </AccessibleField>
                <AccessibleField error={lineError(line, "price")} id={`expense-line-price-${line.id}`} label="Base" required>
                  <MoneyInput currencySymbol={currencySymbol} onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })} placeholder="0,00" required value={line.unitPrice} />
                </AccessibleField>
                <AccessibleField error={lineError(line, "tax")} id={`expense-line-tax-${line.id}`} label="IVA" required>
                  <PercentInput onChange={(event) => updateLine(line.id, { taxRate: event.target.value })} required value={line.taxRate} />
                </AccessibleField>
                <AccessibleField error={lineError(line, "deductible")} id={`expense-line-deductible-${line.id}`} label="Deducible" required>
                  <PercentInput onChange={(event) => updateLine(line.id, { taxDeductiblePct: event.target.value, deductibleEdited: true })} required value={line.taxDeductiblePct} />
                </AccessibleField>
                <AccessibleField error={lineError(line, "retention")} id={`expense-line-retention-${line.id}`} label="Retención" required>
                  <PercentInput onChange={(event) => updateLine(line.id, { retentionRate: event.target.value })} required value={line.retentionRate} />
                </AccessibleField>
                <div className="flex items-end justify-between gap-2">
                  <p className="pb-2 font-mono text-xs font-bold tabular-nums">{formatMoney(payable(lineTotals(line)), baseCurrencyCode)}</p>
                  <Button aria-label={`Eliminar línea ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => (current.length > 1 ? current.filter((candidate) => candidate.id !== line.id) : current))} size="icon" title="Eliminar línea" type="button" variant="ghost">
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
          <aside aria-label="Total previsto" className="border-l-4 border-l-primary bg-window-panel p-3 font-mono text-xs tabular-nums">
            <p className="font-bold uppercase tracking-[0.05em]">Total a pagar</p>
            <dl className="mt-1 space-y-0.5">
              <div className="flex justify-between gap-3"><dt>Base</dt><dd>{formatMoney(preview.subtotal, baseCurrencyCode)}</dd></div>
              <div className="flex justify-between gap-3 text-muted-foreground"><dt>{selfAssessedVat ? "IVA autorrepercutido" : "+ IVA"}</dt><dd>{formatMoney(preview.tax, baseCurrencyCode)}</dd></div>
              <div className="flex justify-between gap-3 text-muted-foreground"><dt>− Retención</dt><dd>{formatMoney(preview.retention, baseCurrencyCode)}</dd></div>
            </dl>
            <p className="mt-1 border-t border-window-shadow pt-1 text-lg font-bold">{formatMoney(payable(preview), baseCurrencyCode)}</p>
          </aside>
        </div>

        {duplicate && duplicate.level !== "none" ? (
          <div className={duplicate.level === "exact" ? "border border-destructive bg-destructive/10 p-2 text-xs text-danger-text" : "border border-warning bg-warning/10 p-2 text-xs text-warning-text"} id="expense-duplicate-warning" role="status" tabIndex={-1}>
            <p className="font-mono font-bold">{duplicate.level === "exact" ? "Esta factura ya está registrada" : "Posible duplicado: misma fecha e importe"}</p>
            {duplicate.matches.map((match) => <a className="mt-1 block underline" href={`/expenses/${match.invoiceId}`} key={match.invoiceId} rel="noreferrer" target="_blank">Ver {match.number}</a>)}
            {duplicate.level === "possible" ? (
              <label className="mt-2 flex items-center gap-2 font-mono font-bold" htmlFor="expense-duplicate-ack">
                <input checked={duplicateAcknowledged} id="expense-duplicate-ack" onChange={(event) => setDuplicateAcknowledged(event.target.checked)} type="checkbox" />
                Confirmo que es una factura distinta
              </label>
            ) : null}
          </div>
        ) : null}

        <FormErrorMessage id="expense-invoice-error">{error}</FormErrorMessage>
        <FormActions sticky>
          <SubmitButton disabled={expenseAccounts.length === 0 || isUploading || duplicate?.level === "exact" || (duplicate?.level === "possible" && !duplicateAcknowledged)} pending={isLoading} pendingLabel="Registrando…">
            Registrar factura
          </SubmitButton>
        </FormActions>
      </form>

      <Dialog
        description="Antes de crear uno nuevo, comprueba que no está ya dado de alta: buscamos por NIF y nombre mientras escribes."
        initialFocusId="expense-new-supplier-name"
        onClose={() => setNewSupplierDialogOpen(false)}
        open={newSupplierDialogOpen}
        size="xl"
        title="Nuevo proveedor"
      >
        <div className="grid gap-3 md:grid-cols-2">
          <AccessibleField className="md:col-span-2" id="expense-new-supplier-name" label="Nombre o razón social">
            <Input onChange={(event) => setNewSupplierDraft((current) => ({ ...current, name: event.target.value }))} value={newSupplierDraft.name} />
          </AccessibleField>
          <AccessibleField helperText="Con el NIF evitamos darlo de alta dos veces." id="expense-new-supplier-tax-id" label="NIF / CIF">
            <Input onChange={(event) => setNewSupplierDraft((current) => ({ ...current, taxId: event.target.value }))} placeholder="B12345674" value={newSupplierDraft.taxId} />
          </AccessibleField>
          <AccessibleField helperText="Código de 2 letras (ES, FR, PT…)." id="expense-new-supplier-country" label="País">
            <Input maxLength={2} onChange={(event) => setNewSupplierDraft((current) => ({ ...current, countryCode: event.target.value.toUpperCase() }))} value={newSupplierDraft.countryCode} />
          </AccessibleField>
          {existingMatches.length > 0 ? (
            <div className="border border-warning bg-warning/10 p-2 text-xs md:col-span-2" role="status">
              <p className="font-mono font-bold text-warning-text">{exactTaxMatch ? "Ya tienes un proveedor con este NIF" : "¿Es alguno de estos proveedores?"}</p>
              <ul className="mt-1 space-y-1">
                {existingMatches.map((supplier) => (
                  <li className="flex items-center justify-between gap-2" key={supplier.id}>
                    <span>{supplier.name} · {supplier.taxId ?? "sin NIF"}</span>
                    <Button onClick={() => { chooseSupplier(supplier.id); setNewSupplierDialogOpen(false); }} size="sm" type="button" variant="outline">Usar este</Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <details className="md:col-span-2">
            <summary className="cursor-pointer font-mono text-xs font-bold">Más datos (opcional): dirección y contacto</summary>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <AccessibleField id="expense-new-supplier-email" label="Email">
                <Input onChange={(event) => setNewSupplierDraft((current) => ({ ...current, email: event.target.value }))} type="email" value={newSupplierDraft.email} />
              </AccessibleField>
              <AccessibleField id="expense-new-supplier-phone" label="Teléfono">
                <Input onChange={(event) => setNewSupplierDraft((current) => ({ ...current, phone: event.target.value }))} value={newSupplierDraft.phone} />
              </AccessibleField>
              <AccessibleField className="md:col-span-2" id="expense-new-supplier-address" label="Dirección fiscal">
                <Input onChange={(event) => setNewSupplierDraft((current) => ({ ...current, address: event.target.value }))} value={newSupplierDraft.address} />
              </AccessibleField>
              <AccessibleField id="expense-new-supplier-postal-code" label="Código postal">
                <Input onChange={(event) => setNewSupplierDraft((current) => ({ ...current, postalCode: event.target.value }))} value={newSupplierDraft.postalCode} />
              </AccessibleField>
              <AccessibleField id="expense-new-supplier-city" label="Ciudad">
                <Input onChange={(event) => setNewSupplierDraft((current) => ({ ...current, city: event.target.value }))} value={newSupplierDraft.city} />
              </AccessibleField>
              <AccessibleField id="expense-new-supplier-province" label="Provincia">
                <Input onChange={(event) => setNewSupplierDraft((current) => ({ ...current, province: event.target.value }))} value={newSupplierDraft.province} />
              </AccessibleField>
            </div>
          </details>
        </div>
        <DialogFooter>
          <Button onClick={() => setNewSupplierDialogOpen(false)} type="button" variant="outline">Cancelar</Button>
          <Button onClick={confirmNewSupplier} type="button">{exactTaxMatch ? `Usar ${exactTaxMatch.name}` : "Usar este proveedor nuevo"}</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

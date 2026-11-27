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
import { FormTotalSummary } from "@/components/ui/form-total-summary";
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
import { defaultInvestmentGood, supplierTaxIdProblem, type SupplierDocumentKind } from "@/server/supplier-invoices/document-rules";

import type { DuplicateAssessment } from "./expense-batch-model";

type Supplier = { id: string; number: string; name: string; taxId: string | null; countryCode?: string | null; supplierKind?: string | null; isActive?: boolean; defaults?: SupplierDefaults };
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
  /** Recargo de equivalencia soportado (%). */
  surchargeRate: string;
  /** Bien de inversión (por defecto, las cuentas de inmovilizado). */
  isInvestmentGood: boolean;
  investmentEdited: boolean;
  deductibleEdited: boolean;
};

/** Factura que se rectifica, con sus líneas ya en negativo para proponer el abono total. */
export type RectifiedInvoicePrefill = {
  id: string;
  number: string;
  supplierDocumentNumber: string | null;
  /** AAAA-MM-DD */
  issueDate: string;
  supplierPartnerId: string;
  vatTreatment: SupplierVatTreatment | null;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    taxDeductiblePct: number;
    retentionRate: number;
    surchargeRate: number;
    expenseAccountId: string;
    isInvestmentGood: boolean;
  }>;
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
  /** País de la empresa: decide si un proveedor es nacional, de la UE o de fuera. */
  homeCountryCode?: string;
  expenseAccounts: AccountOption[];
  goodsReceipts: GoodsReceiptRelation[];
  initialSupplierId?: string;
  purchaseOrders: PurchaseOrderRelation[];
  suppliers: Supplier[];
  /** Documentos esperando en la bandeja (se ofrece continuar con ellos). */
  pendingInboxCount?: number;
  /** Módulo de lectura con IA activo: si no, se escribe directamente a mano. */
  readingEnabled?: boolean;
  /** Series activas del registro de facturas recibidas (la de por defecto primero). Con más de una se puede elegir. */
  expenseSeries?: ExpenseSeriesOption[];
  /** Alta directa de una rectificativa (abono) sin partir de una factura registrada. */
  initialKind?: SupplierDocumentKind;
  /** «Registrar abono / rectificativa» desde una factura: precarga proveedor, IVA, cuentas y líneas en negativo. */
  rectifiedInvoice?: RectifiedInvoicePrefill;
};

export type ExpenseSeriesOption = { id: string; code: string; name: string; isDefault: boolean; preview: string };

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
    surchargeRate: "0",
    isInvestmentGood: false,
    investmentEdited: false,
    deductibleEdited: false,
  };
  return defaults ? applySupplierDefaultsToLine(line, defaults) : line;
}

const draftNumber = (value: number) => String(value).replace(".", ",");

/** Líneas del abono propuestas a partir de la factura rectificada (ya vienen en negativo). */
function rectificationDraftLines(prefill: RectifiedInvoicePrefill): ExpenseLineDraft[] {
  return prefill.lines.map((line, index) => ({
    id: `rectified-${index + 1}`,
    description: line.description,
    expenseAccountId: line.expenseAccountId,
    accountSource: line.expenseAccountId ? "user" : "none",
    quantity: draftNumber(line.quantity),
    unitPrice: draftNumber(line.unitPrice),
    taxRate: draftNumber(line.taxRate),
    taxDeductiblePct: draftNumber(line.taxDeductiblePct),
    retentionRate: draftNumber(line.retentionRate),
    surchargeRate: draftNumber(line.surchargeRate),
    isInvestmentGood: line.isInvestmentGood,
    investmentEdited: true,
    deductibleEdited: true,
  }));
}

function lineTotals(line: ExpenseLineDraft, withSurcharge = false) {
  const quantity = decimal(line.quantity);
  const unitPrice = money(line.unitPrice);
  const taxRate = decimal(line.taxRate);
  const retentionRate = decimal(line.retentionRate);
  const surchargeRate = withSurcharge ? decimal(line.surchargeRate) : 0;
  const subtotal = Number.isFinite(quantity * unitPrice) ? quantity * unitPrice : 0;
  const tax = subtotal * (Number.isFinite(taxRate) ? taxRate : 0) / 100;
  const retention = subtotal * (Number.isFinite(retentionRate) ? retentionRate : 0) / 100;
  const surcharge = subtotal * (Number.isFinite(surchargeRate) ? surchargeRate : 0) / 100;
  return { subtotal, tax, retention, surcharge, total: subtotal + tax + surcharge - retention };
}

export function CreateExpenseInvoiceForm({ baseCurrencyCode, expenseSeries = [], homeCountryCode = "ES", expenseAccounts, goodsReceipts, initialKind = "INVOICE", initialSupplierId, pendingInboxCount = 0, purchaseOrders, readingEnabled = true, rectifiedInvoice, suppliers }: CreateExpenseInvoiceFormProps) {
  const router = useRouter();
  const initialSupplier = suppliers.find((supplier) => supplier.id === (rectifiedInvoice?.supplierPartnerId ?? initialSupplierId));
  const startsAsRectification = Boolean(rectifiedInvoice) || initialKind === "RECTIFICATION";
  const [creationMode, setCreationMode] = useState<"manual" | null>(initialSupplier || !readingEnabled || startsAsRectification ? "manual" : null);
  const [documentKind, setDocumentKind] = useState<SupplierDocumentKind>(startsAsRectification ? "RECTIFICATION" : "INVOICE");
  const isRectification = documentKind === "RECTIFICATION";
  const [rectifiedDocumentNumber, setRectifiedDocumentNumber] = useState(rectifiedInvoice?.supplierDocumentNumber ?? rectifiedInvoice?.number ?? "");
  const [rectifiedIssueDate, setRectifiedIssueDate] = useState(rectifiedInvoice?.issueDate ?? "");
  const [rectificationReason, setRectificationReason] = useState("");
  const [operationDate, setOperationDate] = useState("");
  const [isSimplified, setIsSimplified] = useState(false);
  const [importDuaNumber, setImportDuaNumber] = useState("");
  const [importDuaDate, setImportDuaDate] = useState("");
  const [hasSurcharge, setHasSurcharge] = useState(() => Boolean(rectifiedInvoice?.lines.some((line) => line.surchargeRate > 0)));
  const [supplierPartnerId, setSupplierPartnerId] = useState(initialSupplier?.id ?? "");
  const [newSupplier, setNewSupplier] = useState<NewSupplierDraft | null>(null);
  const [newSupplierDialogOpen, setNewSupplierDialogOpen] = useState(false);
  const [newSupplierDraft, setNewSupplierDraft] = useState<NewSupplierDraft>({ ...emptyNewSupplier, countryCode: homeCountryCode });
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [goodsReceiptId, setGoodsReceiptId] = useState("");
  const [supplierDocumentNumber, setSupplierDocumentNumber] = useState("");
  const [seriesId, setSeriesId] = useState(() => (expenseSeries.find((series) => series.isDefault) ?? expenseSeries[0])?.id ?? "");
  const selectedSeries = expenseSeries.find((series) => series.id === seriesId);
  const [issueDate, setIssueDate] = useState(todayInputValue);
  // Vacía = la fecha de la factura. Solo se indica si la factura llega tarde (periodo ya presentado).
  const [accountingDate, setAccountingDate] = useState("");
  const [dueDate, setDueDate] = useState(() => (startsAsRectification ? "" : dueDateInputFor(todayInputValue(), initialSupplier?.defaults?.paymentTermsDays)));
  const [dueDateEdited, setDueDateEdited] = useState(false);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ExpenseLineDraft[]>(() => (rectifiedInvoice?.lines.length ? rectificationDraftLines(rectifiedInvoice) : [newLine(initialSupplier?.defaults, "line-1")]));
  const [attachment, setAttachment] = useState<UploadedAttachment | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [vatTreatmentOverride, setVatTreatmentOverride] = useState<SupplierVatTreatment | null>(rectifiedInvoice?.vatTreatment ?? initialSupplier?.defaults?.defaultVatTreatment ?? null);
  const [duplicate, setDuplicate] = useState<DuplicateAssessment | null>(null);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);

  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierPartnerId) ?? null;
  const supplierDefaults = selectedSupplier?.defaults;
  const supplierCountryForVat = selectedSupplier ? selectedSupplier.countryCode : newSupplier?.countryCode;
  // Por defecto se deduce del país del proveedor (o su valor habitual); si el usuario lo cambia, prevalece su elección.
  // Fuera de la UE: servicios por inversión del sujeto pasivo, bienes como importación.
  const vatTreatment = vatTreatmentOverride ?? resolveSupplierVatTreatment(null, supplierCountryForVat, selectedSupplier?.supplierKind, homeCountryCode);
  const selfAssessedVat = isSelfAssessedTreatment(vatTreatment);
  // El recargo de equivalencia solo existe cuando el proveedor repercute IVA.
  const surchargeAllowed = vatTreatment === "DOMESTIC" || vatTreatment === "IMPORT";
  const surchargeActive = hasSurcharge && surchargeAllowed;
  const missingTaxIdMessage = selectedSupplier
    ? supplierTaxIdProblem({ taxId: selectedSupplier.taxId, supplierCountryCode: selectedSupplier.countryCode, homeCountryCode, vatTreatment, isSimplified })
    : newSupplier
      ? supplierTaxIdProblem({ taxId: newSupplier.taxId, supplierCountryCode: newSupplier.countryCode, homeCountryCode, vatTreatment, isSimplified })
      : null;
  const availablePurchaseOrders = purchaseOrders.filter((order) => !supplierPartnerId || order.supplierPartnerId === supplierPartnerId);
  const availableGoodsReceipts = goodsReceipts.filter((receipt) => (purchaseOrderId ? receipt.purchaseOrderId === purchaseOrderId : !supplierPartnerId || receipt.supplierPartnerId === supplierPartnerId));
  const supplierSuggestionIds = supplierDefaults?.defaultExpenseAccountId ? [supplierDefaults.defaultExpenseAccountId] : [];

  const preview = useMemo(
    () => lines.reduce(
      (totals, line) => {
        const current = lineTotals(line, surchargeActive);
        return { subtotal: totals.subtotal + current.subtotal, tax: totals.tax + current.tax, retention: totals.retention + current.retention, surcharge: totals.surcharge + current.surcharge, total: totals.total + current.total };
      },
      { subtotal: 0, tax: 0, retention: 0, surcharge: 0, total: 0 },
    ),
    [lines, surchargeActive],
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
    if (!dueDateEdited && !isRectification) setDueDate(dueDateInputFor(issueDate, defaults.paymentTermsDays));
  }

  function changeIssueDate(value: string) {
    setIssueDate(value);
    resetDuplicate();
    if (!dueDateEdited && !isRectification) setDueDate(dueDateInputFor(value, supplierDefaults?.paymentTermsDays));
  }

  function changeDocumentKind(kind: SupplierDocumentKind) {
    setDocumentKind(kind);
    resetDuplicate();
    setFieldErrors({});
    // Un abono no vence ni consume pedido: se quita lo propuesto (no lo que el usuario escribió).
    if (kind === "RECTIFICATION") {
      if (!dueDateEdited) setDueDate("");
      setPurchaseOrderId("");
      setGoodsReceiptId("");
    } else if (!dueDateEdited) {
      setDueDate(dueDateInputFor(issueDate, supplierDefaults?.paymentTermsDays));
    }
  }

  /** Marca de bien de inversión: la elegida a mano o, si no se ha tocado, la que corresponde a la cuenta (inmovilizado). */
  function lineIsInvestmentGood(line: ExpenseLineDraft) {
    if (line.investmentEdited) return line.isInvestmentGood;
    return defaultInvestmentGood(expenseAccounts.find((account) => account.id === line.expenseAccountId)?.code);
  }

  /** Al elegir cuenta se propone la marca de bien de inversión (inmovilizado), salvo que ya se haya tocado. */
  function chooseLineAccount(line: ExpenseLineDraft, accountId: string) {
    const code = expenseAccounts.find((account) => account.id === accountId)?.code;
    updateLine(line.id, {
      expenseAccountId: accountId,
      accountSource: accountId ? "user" : "none",
      ...(line.investmentEdited ? {} : { isInvestmentGood: defaultInvestmentGood(code) }),
    });
  }

  function openNewSupplierDialog(query: string) {
    const looksLikeTaxId = /^[A-Z0-9]{8,}$/i.test(query.replace(/[\s.-]/g, "")) && /\d/.test(query);
    setNewSupplierDraft({ ...emptyNewSupplier, countryCode: homeCountryCode, ...(newSupplier ?? {}), ...(query ? (looksLikeTaxId ? { taxId: query } : { name: query }) : {}) });
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
        // Con su signo: un abono tiene total negativo.
        totalAmount: Math.round(total * 100) / 100,
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
    else if (missingTaxIdMessage) nextErrors.supplier = missingTaxIdMessage;
    if (isRectification && !rectifiedInvoice && !rectifiedDocumentNumber.trim() && !rectificationReason.trim()) {
      nextErrors.rectifiedNumber = "Indica el número de la factura que se rectifica o, si afecta a varias, el motivo.";
    }
    if (!issueDate) nextErrors.issueDate = "Indica la fecha de la factura.";
    if (dueDate && issueDate && dueDate < issueDate) nextErrors.dueDate = "El vencimiento no puede ser anterior a la fecha de la factura.";
    if (accountingDate && issueDate && accountingDate < issueDate) nextErrors.accountingDate = "La fecha de registro no puede ser anterior a la fecha de la factura.";
    const parsedLines = lines.map((line) => {
      const quantity = decimal(line.quantity);
      const unitPrice = money(line.unitPrice);
      const taxRate = decimal(line.taxRate);
      const taxDeductiblePct = decimal(line.taxDeductiblePct);
      const retentionRate = decimal(line.retentionRate);
      const surchargeRate = surchargeActive ? decimal(line.surchargeRate) : 0;
      if (!line.description.trim()) nextErrors[`${line.id}-description`] = "Escribe el concepto (p. ej. «Luz de marzo»).";
      if (!line.expenseAccountId) nextErrors[`${line.id}-account`] = "Elige en qué se ha gastado: busca por palabra (luz, alquiler, gestoría…).";
      if (isRectification) {
        // Rectificativa: cantidad o importe en negativo para abonar; ninguno a cero.
        if (!Number.isFinite(quantity) || quantity === 0) nextErrors[`${line.id}-quantity`] = "Indica la cantidad (en negativo si es un abono).";
        if (!Number.isFinite(unitPrice) || unitPrice === 0) nextErrors[`${line.id}-price`] = "Indica el importe sin IVA que se rectifica.";
      } else {
        if (!Number.isFinite(quantity) || quantity <= 0) nextErrors[`${line.id}-quantity`] = "Debe ser mayor que cero. Para un abono, elige «Rectificativa».";
        if (!Number.isFinite(unitPrice) || unitPrice < 0) nextErrors[`${line.id}-price`] = "Indica el importe sin IVA (p. ej. 100,00).";
      }
      for (const [key, value] of [["tax", taxRate], ["deductible", taxDeductiblePct], ["retention", retentionRate], ["surcharge", surchargeRate]] as const) {
        if (!Number.isFinite(value) || value < 0 || value > 100) nextErrors[`${line.id}-${key}`] = "Entre 0 y 100 %.";
      }
      return { expenseAccountId: line.expenseAccountId, description: line.description.trim(), quantity, unitPrice, taxRate, taxDeductiblePct, retentionRate, surchargeRate, isInvestmentGood: lineIsInvestmentGood(line) };
    });
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const firstKey = Object.keys(nextErrors)[0];
      const fieldMap: Record<string, string> = { account: "account", description: "description", quantity: "quantity", price: "price", tax: "tax", deductible: "deductible", retention: "retention", surcharge: "surcharge" };
      const separator = firstKey.lastIndexOf("-");
      const targetId = firstKey === "supplier" ? "expense-supplier" : firstKey === "rectifiedNumber" ? "expense-rectified-number" : firstKey === "issueDate" ? "expense-issue-date" : firstKey === "dueDate" ? "expense-due-date" : firstKey === "accountingDate" ? "expense-accounting-date" : `expense-line-${fieldMap[firstKey.slice(separator + 1)]}-${firstKey.slice(0, separator)}`;
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
          seriesId: expenseSeries.length > 1 && seriesId ? seriesId : undefined,
          purchaseOrderId: isRectification ? undefined : purchaseOrderId || undefined,
          goodsReceiptId: isRectification ? undefined : goodsReceiptId || undefined,
          issueDate: toIsoDate(issueDate),
          accountingDate: accountingDate ? toIsoDate(accountingDate) : undefined,
          dueDate: dueDate ? toIsoDate(dueDate) : undefined,
          documentKind,
          rectifiedInvoiceId: isRectification ? rectifiedInvoice?.id : undefined,
          rectifiedDocumentNumber: isRectification ? rectifiedDocumentNumber.trim() || undefined : undefined,
          rectifiedIssueDate: isRectification && rectifiedIssueDate ? toIsoDate(rectifiedIssueDate) : undefined,
          rectificationReason: isRectification ? rectificationReason.trim() || undefined : undefined,
          operationDate: operationDate ? toIsoDate(operationDate) : undefined,
          isSimplified,
          importDuaNumber: vatTreatment === "IMPORT" ? importDuaNumber.trim() || undefined : undefined,
          importDuaDate: vatTreatment === "IMPORT" && importDuaDate ? toIsoDate(importDuaDate) : undefined,
          notes,
          ocrJobId: attachment?.jobId,
          vatTreatment,
          lines: parsedLines,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo registrar la factura de proveedor."));
      const created = (await response.json()) as { id?: string };
      toast.success(isRectification ? "Rectificativa registrada y contabilizada." : "Factura de proveedor registrada y contabilizada.");
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
    const modeCard = "block rounded-surface border border-window-dark-shadow bg-window-panel p-3 text-left shadow-raised hover:bg-window-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
    return (
      <div className="space-y-3">
        <div aria-label="Cómo quieres registrar la factura" className="grid gap-3 md:grid-cols-2" role="group">
          <Link autoFocus className={modeCard} href="/expenses/inbox">
            <Upload className="mb-2 size-5 text-link" aria-hidden="true" />
            <span className="block font-mono text-sm font-bold">Subir o fotografiar (recomendado)</span>
            <span className="mt-1 block text-xs text-muted-foreground">Sube PDF o fotos de una o varias facturas: se leen solas y solo tienes que revisarlas junto a la imagen.</span>
            <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-link sm:hidden"><Camera aria-hidden="true" /> Puedes hacer la foto con el móvil</span>
          </Link>
          <button className={modeCard} onClick={() => setCreationMode("manual")} type="button">
            <FileText className="mb-2 size-5 text-link" aria-hidden="true" />
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
  const sectionClass = "space-y-3 rounded-surface border border-window-dark-shadow bg-card p-3";
  const currencySymbol = baseCurrencyCode === "EUR" ? "€" : baseCurrencyCode;

  return (
    <>
      <form className="space-y-3" noValidate onSubmit={onSubmit}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-window-dark-shadow bg-window-panel p-2">
          <div>
            <p className="font-mono text-xs font-bold">Registro a mano</p>
            <RequiredFieldsNote />
          </div>
          {readingEnabled && !rectifiedInvoice ? <Button onClick={() => setCreationMode(null)} size="sm" type="button" variant="outline">Cambiar modo</Button> : null}
        </div>

        <section className={sectionClass} aria-labelledby="expense-kind-title">
          <h2 className="font-mono text-sm font-bold" id="expense-kind-title">Clase de documento</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <AccessibleField
              helperText={isRectification ? "Abono, devolución o corrección de una factura ya recibida. Los importes van en negativo si el proveedor te devuelve dinero." : "Factura o ticket normal. Para un abono o una devolución elige «Rectificativa»."}
              id="expense-document-kind"
              label="Tipo"
            >
              <Select data-testid="expense-document-kind" disabled={Boolean(rectifiedInvoice)} onChange={(event) => changeDocumentKind(event.target.value === "RECTIFICATION" ? "RECTIFICATION" : "INVOICE")} value={documentKind}>
                <option value="INVOICE">Factura</option>
                <option value="RECTIFICATION">Rectificativa (abono)</option>
              </Select>
            </AccessibleField>
            {isRectification ? (
              <>
                <AccessibleField
                  error={fieldErrors.rectifiedNumber}
                  helperText={rectifiedInvoice ? "Factura registrada que se rectifica." : "El número que figura en la rectificativa del proveedor."}
                  id="expense-rectified-number"
                  label="N.º de la factura rectificada"
                >
                  <Input onChange={(event) => setRectifiedDocumentNumber(event.target.value)} placeholder="Ej. F-2026-0123" value={rectifiedDocumentNumber} />
                </AccessibleField>
                <AccessibleField id="expense-rectified-date" label="Fecha de la factura rectificada">
                  <Input max={issueDate || undefined} onChange={(event) => setRectifiedIssueDate(event.target.value)} type="date" value={rectifiedIssueDate} />
                </AccessibleField>
                <AccessibleField helperText="Devolución, descuento posterior, error en el precio…" id="expense-rectification-reason" label="Motivo">
                  <Input maxLength={500} onChange={(event) => setRectificationReason(event.target.value)} placeholder="Ej. Devolución de mercancía" value={rectificationReason} />
                </AccessibleField>
              </>
            ) : null}
          </div>
          {rectifiedInvoice ? (
            <p className="text-xs text-muted-foreground">
              Se han copiado las líneas de{" "}
              <Link className="font-bold text-link underline" href={`/expenses/${rectifiedInvoice.id}`}>{rectifiedInvoice.supplierDocumentNumber || rectifiedInvoice.number}</Link>{" "}
              en negativo (abono total). Para un abono parcial, cambia cantidades o importes o elimina las líneas que no se abonan.
            </p>
          ) : null}
        </section>
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
              <label className="mt-1 flex items-center gap-2 text-xs" htmlFor="expense-simplified">
                <input checked={isSimplified} data-testid="expense-simplified" id="expense-simplified" onChange={(event) => { setIsSimplified(event.target.checked); setFieldErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== "supplier"))); }} type="checkbox" />
                Ticket o factura simplificada sin NIF
              </label>
              {missingTaxIdMessage && !fieldErrors.supplier ? (
                <p className="mt-1 text-xs text-warning-text" role="status">Este proveedor no tiene NIF: complétalo en su ficha o marca la casilla si es un ticket o una factura simplificada.</p>
              ) : null}
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
          {expenseSeries.length > 1 ? (
            <AccessibleField
              helperText={selectedSeries ? `Se registrará como ${selectedSeries.preview}.` : "Numeración interna del registro de facturas recibidas."}
              id="expense-series"
              label="Serie"
            >
              <Select data-testid="expense-series-select" id="expense-series" onChange={(event) => setSeriesId(event.target.value)} value={seriesId}>
                {expenseSeries.map((series) => (
                  <option key={series.id} value={series.id}>
                    {series.name} ({series.code}){series.isDefault ? " · por defecto" : ""}
                  </option>
                ))}
              </Select>
            </AccessibleField>
          ) : null}
          <AccessibleField helperText="El número que aparece en la factura recibida. Sirve para detectar duplicados." id="expense-supplier-number" label="N.º de factura del proveedor">
            <Input onChange={(event) => { setSupplierDocumentNumber(event.target.value); resetDuplicate(); }} placeholder="Ej. F-2026-0123" value={supplierDocumentNumber} />
          </AccessibleField>
          <AccessibleField error={fieldErrors.issueDate} id="expense-issue-date" label="Fecha de la factura" required>
            <Input onChange={(event) => changeIssueDate(event.target.value)} required type="date" value={issueDate} />
          </AccessibleField>
          <AccessibleField
            helperText="Opcional. Solo si la entrega o el servicio se hizo en una fecha distinta de la de la factura."
            id="expense-operation-date"
            label="Fecha de operación"
          >
            <Input onChange={(event) => setOperationDate(event.target.value)} type="date" value={operationDate} />
          </AccessibleField>
          {vatTreatment === "IMPORT" ? (
            <>
              <AccessibleField helperText="Número del documento aduanero (DUA) de la importación." id="expense-dua-number" label="N.º de DUA">
                <Input maxLength={40} onChange={(event) => setImportDuaNumber(event.target.value)} placeholder="Ej. 26ES00280112345678" value={importDuaNumber} />
              </AccessibleField>
              <AccessibleField helperText="Fecha de admisión del DUA por la aduana." id="expense-dua-date" label="Fecha del DUA">
                <Input onChange={(event) => setImportDuaDate(event.target.value)} type="date" value={importDuaDate} />
              </AccessibleField>
            </>
          ) : null}
          <AccessibleField
            error={fieldErrors.accountingDate}
            helperText="Opcional. Si la factura te llega tarde y su trimestre ya está presentado, indica hoy: el IVA se deduce en el periodo de registro."
            id="expense-accounting-date"
            label="Fecha de registro"
          >
            <Input min={issueDate || undefined} onChange={(event) => setAccountingDate(event.target.value)} placeholder="Igual que la factura" type="date" value={accountingDate} />
          </AccessibleField>
          <AccessibleField
            error={fieldErrors.dueDate}
            helperText={isRectification ? "Un abono no vence: déjalo vacío salvo que la rectificativa sea a pagar." : !dueDateEdited && supplierDefaults?.paymentTermsDays !== null && supplierDefaults?.paymentTermsDays !== undefined ? `Calculado con los ${supplierDefaults.paymentTermsDays} días de pago del proveedor.` : "Opcional: fecha límite para pagarla."}
            id="expense-due-date"
            label="Vencimiento"
          >
            <Input min={issueDate || undefined} onChange={(event) => { setDueDate(event.target.value); setDueDateEdited(true); }} type="date" value={dueDate} />
          </AccessibleField>
          <div className="space-y-1">
            <p className="font-mono text-xs font-bold">Justificante</p>
            {attachment ? (
              <div className="flex min-h-8 items-center justify-between gap-2 rounded-surface border border-window-dark-shadow bg-primary/5 px-2 py-1 text-xs">
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

        <details className={sectionClass} hidden={isRectification} open={Boolean(purchaseOrderId || goodsReceiptId)}>
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
              <h2 className="font-mono text-sm font-bold" id="expense-lines-title">{isRectification ? "Qué se rectifica" : "Qué has comprado"}</h2>
              <p className="text-xs text-muted-foreground">
                <strong>Base</strong>: importe sin IVA. <strong>Deducible</strong>: parte del IVA que recuperas (100 % si es solo del negocio).{" "}
                <strong>Retención</strong>: IRPF que te descuenta un profesional (15 %) o un alquiler (19 %); si la factura no la muestra, 0.
                {isRectification ? <> <strong>Abono</strong>: pon la cantidad (o la base) en negativo.</> : null}
              </p>
              {surchargeAllowed ? (
                <label className="mt-1 flex items-center gap-2 text-xs" htmlFor="expense-has-surcharge">
                  <input checked={hasSurcharge} id="expense-has-surcharge" onChange={(event) => setHasSurcharge(event.target.checked)} type="checkbox" />
                  La factura lleva recargo de equivalencia
                </label>
              ) : null}
            </div>
            <Button onClick={() => setLines((current) => [...current, newLine(supplierDefaults)])} size="sm" type="button" variant="outline">
              <Plus aria-hidden="true" />
              Añadir línea
            </Button>
          </div>
          {lines.map((line, index) => (
            <fieldset className="rounded-surface border border-window-dark-shadow bg-card p-2" key={line.id}>
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
                    onChange={(accountId) => chooseLineAccount(line, accountId)}
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
                  <p className={`pb-2 font-mono text-xs font-bold tabular-nums${payable(lineTotals(line, surchargeActive)) < 0 ? " text-danger-text" : ""}`}>{formatMoney(payable(lineTotals(line, surchargeActive)), baseCurrencyCode)}</p>
                  <Button aria-label={`Eliminar línea ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => (current.length > 1 ? current.filter((candidate) => candidate.id !== line.id) : current))} size="icon" title="Eliminar línea" type="button" variant="ghost">
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1">
                <label className="flex items-center gap-2 text-xs" htmlFor={`expense-line-investment-${line.id}`} title="Inmovilizado: maquinaria, equipos, vehículos… Va a su casilla del modelo 303 y al libro de bienes de inversión.">
                  <input checked={lineIsInvestmentGood(line)} id={`expense-line-investment-${line.id}`} onChange={(event) => updateLine(line.id, { isInvestmentGood: event.target.checked, investmentEdited: true })} type="checkbox" />
                  Bien de inversión
                </label>
                {surchargeActive ? (
                  <AccessibleField className="w-32" error={lineError(line, "surcharge")} id={`expense-line-surcharge-${line.id}`} label="Recargo eq.">
                    <PercentInput onChange={(event) => updateLine(line.id, { surchargeRate: event.target.value })} value={line.surchargeRate} />
                  </AccessibleField>
                ) : null}
              </div>
            </fieldset>
          ))}
        </section>

        <div className="grid gap-3 lg:grid-cols-4">
          <AccessibleField className="lg:col-span-3" helperText="Opcional; solo de uso interno." id="expense-notes" label="Notas">
            <Textarea onChange={(event) => setNotes(event.target.value)} value={notes} />
          </AccessibleField>
          <aside aria-label="Total previsto" className="border-l-4 border-l-primary bg-window-panel p-3 font-mono text-xs tabular-nums">
            <p className="font-bold uppercase tracking-[0.05em]">{payable(preview) < 0 ? "Total del abono (a tu favor)" : "Total a pagar"}</p>
            <dl className="mt-1 space-y-0.5">
              <div className="flex justify-between gap-3"><dt>Base</dt><dd>{formatMoney(preview.subtotal, baseCurrencyCode)}</dd></div>
              <div className="flex justify-between gap-3 text-muted-foreground"><dt>{selfAssessedVat ? "IVA autorrepercutido" : "+ IVA"}</dt><dd>{formatMoney(preview.tax, baseCurrencyCode)}</dd></div>
              {surchargeActive && preview.surcharge !== 0 ? <div className="flex justify-between gap-3 text-muted-foreground"><dt>+ Recargo eq.</dt><dd>{formatMoney(preview.surcharge, baseCurrencyCode)}</dd></div> : null}
              <div className="flex justify-between gap-3 text-muted-foreground"><dt>− Retención</dt><dd>{formatMoney(preview.retention, baseCurrencyCode)}</dd></div>
            </dl>
            <p className={`mt-1 border-t border-window-shadow pt-1 text-lg font-bold${payable(preview) < 0 ? " text-danger-text" : ""}`}>{formatMoney(payable(preview), baseCurrencyCode)}</p>
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
        <FormActions sticky summary={<FormTotalSummary label={selfAssessedVat ? "A pagar" : "Total"} lines={lines.length} total={payable(preview)} currencyCode={baseCurrencyCode} />}>
          <SubmitButton disabled={expenseAccounts.length === 0 || isUploading || duplicate?.level === "exact" || (duplicate?.level === "possible" && !duplicateAcknowledged)} pending={isLoading} pendingLabel="Registrando…">
            {isRectification ? "Registrar rectificativa" : "Registrar factura"}
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

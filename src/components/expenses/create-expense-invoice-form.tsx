"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";

type ExpenseAccount = { id: string; code: string; name: string };
type Supplier = { id: string; name: string; taxId: string | null };

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

type OcrDraft = {
  supplierName?: string;
  supplierDocumentNumber?: string;
  issueDate?: string;
  dueDate?: string;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    taxDeductiblePct: number;
    retentionRate: number;
  }>;
  confidence: "high" | "medium" | "low";
  warnings: string[];
};

type CreateExpenseInvoiceFormProps = {
  expenseAccounts: ExpenseAccount[];
  suppliers: Supplier[];
};

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

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
  const quantity = Number(line.quantity);
  const unitPrice = Number(line.unitPrice);
  const taxRate = Number(line.taxRate);
  const retentionRate = Number(line.retentionRate);
  const subtotal = Number.isFinite(quantity * unitPrice) ? quantity * unitPrice : 0;
  const tax = subtotal * (Number.isFinite(taxRate) ? taxRate : 0) / 100;
  const retention = subtotal * (Number.isFinite(retentionRate) ? retentionRate : 0) / 100;
  return { subtotal, tax, retention, total: subtotal + tax - retention };
}

export function CreateExpenseInvoiceForm({ expenseAccounts, suppliers }: CreateExpenseInvoiceFormProps) {
  const router = useRouter();
  const [supplierMode, setSupplierMode] = useState<"existing" | "new">(suppliers.length > 0 ? "existing" : "new");
  const [supplierPartnerId, setSupplierPartnerId] = useState(suppliers[0]?.id ?? "");
  const [supplierName, setSupplierName] = useState("");
  const [supplierDocumentNumber, setSupplierDocumentNumber] = useState("");
  const [issueDate, setIssueDate] = useState(todayInputValue());
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ExpenseLineDraft[]>([newLine(expenseAccounts[0]?.id ?? "")]);
  const [attachment, setAttachment] = useState<AttachmentDraft>({ fileName: "", fileUrl: "" });
  const [ocrJobId, setOcrJobId] = useState<string | null>(null);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [ocrDraft, setOcrDraft] = useState<OcrDraft | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = error ? "expense-invoice-error" : undefined;

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

  function updateLine(id: string, patch: Partial<ExpenseLineDraft>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [...current, newLine(expenseAccounts[0]?.id ?? "")]);
  }

  function removeLine(id: string) {
    setLines((current) => current.length > 1 ? current.filter((line) => line.id !== id) : current);
  }

  async function pollOcrJob(jobId: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt < 3 ? 800 : 1500));
      const response = await fetch(`/api/expenses/ocr/${jobId}`);
      if (!response.ok) throw new Error("No se pudo consultar el job OCR.");
      const payload = (await response.json()) as { status: string; extracted?: OcrDraft | null; errorMessage?: string | null; fileName: string; fileUrl?: string | null };
      setOcrStatus(payload.status);
      if (payload.status === "DONE" && payload.extracted) {
        setOcrDraft(payload.extracted);
        setAttachment({ fileName: payload.fileName, fileUrl: payload.fileUrl ?? `/api/expenses/ocr/${jobId}/file` });
        return;
      }
      if (payload.status === "FAILED") throw new Error(payload.errorMessage ?? "OCR fallido.");
    }
    throw new Error("El OCR sigue procesando. Revisa el resultado en unos segundos.");
  }

  async function uploadOcrFile(file: File) {
    setOcrError(null);
    setOcrDraft(null);
    setOcrStatus("UPLOADING");
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/expenses/ocr", {
        method: "POST",
        headers: getCsrfHeader(),
        body: formData,
      });
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "No se pudo iniciar OCR.");
      }
      const job = (await response.json()) as { id: string; status: string };
      setOcrJobId(job.id);
      setOcrStatus(job.status);
      await pollOcrJob(job.id);
      toast.success("OCR completado. Revisa el borrador antes de guardar.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error OCR inesperado.";
      setOcrError(message);
      setOcrStatus("FAILED");
      toast.error(message);
    }
  }

  function applyOcrDraft() {
    if (!ocrDraft) return;
    if (ocrDraft.supplierName) {
      setSupplierMode("new");
      setSupplierName(ocrDraft.supplierName);
    }
    if (ocrDraft.supplierDocumentNumber) setSupplierDocumentNumber(ocrDraft.supplierDocumentNumber);
    if (ocrDraft.issueDate) setIssueDate(ocrDraft.issueDate.slice(0, 10));
    if (ocrDraft.dueDate) setDueDate(ocrDraft.dueDate.slice(0, 10));
    setLines(
      ocrDraft.lines.map((line) => ({
        id: crypto.randomUUID(),
        description: line.description,
        expenseAccountId: expenseAccounts[0]?.id ?? "",
        quantity: String(line.quantity),
        unitPrice: String(line.unitPrice),
        taxRate: String(line.taxRate),
        taxDeductiblePct: String(line.taxDeductiblePct),
        retentionRate: String(line.retentionRate),
      })),
    );
    toast.success("Borrador OCR aplicado al formulario.");
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      if (supplierMode === "existing" && !supplierPartnerId) throw new Error("Selecciona un proveedor.");
      if (supplierMode === "new" && !supplierName.trim()) throw new Error("Indica el proveedor.");
      if (lines.length === 0) throw new Error("Añade al menos una línea.");

      const parsedLines = lines.map((line) => {
        const quantity = Number(line.quantity);
        const unitPrice = Number(line.unitPrice);
        const taxRate = Number(line.taxRate);
        const taxDeductiblePct = Number(line.taxDeductiblePct);
        const retentionRate = Number(line.retentionRate);
        if (!line.expenseAccountId) throw new Error("Selecciona una cuenta de gasto en todas las líneas.");
        if (!line.description.trim()) throw new Error("Todas las líneas necesitan concepto.");
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("La cantidad debe ser mayor que cero.");
        if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("El importe no puede ser negativo.");
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

      const attachments = attachment.fileName.trim() && attachment.fileUrl.trim()
        ? [{ fileName: attachment.fileName, fileUrl: attachment.fileUrl }]
        : undefined;

      const response = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          supplierPartnerId: supplierMode === "existing" ? supplierPartnerId : undefined,
          supplierName: supplierMode === "new" ? supplierName : undefined,
          supplierDocumentNumber,
          issueDate: toIsoDate(issueDate),
          dueDate: dueDate ? toIsoDate(dueDate) : undefined,
          notes,
          attachments,
          lines: parsedLines,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "No se pudo crear el gasto.");
      }
      setSupplierName("");
      setSupplierDocumentNumber("");
      setIssueDate(todayInputValue());
      setDueDate("");
      setNotes("");
      setLines([newLine(expenseAccounts[0]?.id ?? "")]);
      setAttachment({ fileName: "", fileUrl: "" });
      toast.success("Gasto contabilizado correctamente.");
      router.refresh();
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : "Error inesperado.";
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <div className="rounded-md border bg-muted/20 p-3">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-2">
            <Label htmlFor="expense-ocr-file">OCR local</Label>
            <Input
              accept="application/pdf,image/png,image/jpeg,image/webp"
              id="expense-ocr-file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadOcrFile(file);
              }}
              type="file"
            />
            <p className="text-xs text-muted-foreground">
              Se procesa en este servidor. Estado: {ocrStatus ?? "sin archivo"}{ocrJobId ? ` · ${ocrJobId.slice(0, 8)}` : ""}
            </p>
          </div>
          <Button disabled={!ocrDraft} onClick={applyOcrDraft} type="button" variant="outline">
            Aplicar OCR
          </Button>
        </div>
        {ocrDraft ? (
          <div className="mt-3 rounded-md border bg-background p-3 text-sm">
            <p className="font-medium">Borrador OCR · confianza {ocrDraft.confidence}</p>
            <p className="text-muted-foreground">{ocrDraft.supplierName ?? "Proveedor no detectado"} · {ocrDraft.supplierDocumentNumber ?? "Sin número"}</p>
            {ocrDraft.warnings.length > 0 ? <p className="mt-1 text-amber-700">{ocrDraft.warnings.join(" ")}</p> : null}
          </div>
        ) : null}
        {ocrError ? <p className="mt-2 text-sm text-red-600" role="alert">{ocrError}</p> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="expense-supplier-mode">Proveedor</Label>
          <Select id="expense-supplier-mode" onChange={(event) => setSupplierMode(event.target.value as "existing" | "new")} value={supplierMode}>
            <option value="existing" disabled={suppliers.length === 0}>Existente</option>
            <option value="new">Nuevo</option>
          </Select>
        </div>
        {supplierMode === "existing" ? (
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="expense-supplier-id">Proveedor existente</Label>
            <Select aria-describedby={errorId} id="expense-supplier-id" onChange={(event) => setSupplierPartnerId(event.target.value)} required value={supplierPartnerId}>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}{supplier.taxId ? ` - ${supplier.taxId}` : ""}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="expense-supplier">Nuevo proveedor</Label>
            <Input aria-describedby={errorId} id="expense-supplier" onChange={(event) => setSupplierName(event.target.value)} required value={supplierName} />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="expense-supplier-number">Factura proveedor</Label>
          <Input aria-describedby={errorId} id="expense-supplier-number" onChange={(event) => setSupplierDocumentNumber(event.target.value)} placeholder="FRA-123" value={supplierDocumentNumber} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="expense-issue-date">Fecha</Label>
          <Input aria-describedby={errorId} id="expense-issue-date" onChange={(event) => setIssueDate(event.target.value)} required type="date" value={issueDate} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="expense-due-date">Vence</Label>
          <Input aria-describedby={errorId} id="expense-due-date" onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} />
        </div>
        <div className="space-y-2 lg:col-span-2">
          <Label htmlFor="expense-attachment-url">Adjunto</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input id="expense-attachment-name" onChange={(event) => setAttachment((current) => ({ ...current, fileName: event.target.value }))} placeholder="factura.pdf" value={attachment.fileName} />
            <Input id="expense-attachment-url" onChange={(event) => setAttachment((current) => ({ ...current, fileUrl: event.target.value }))} placeholder="https://..." type="url" value={attachment.fileUrl} />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">Líneas</p>
          <Button onClick={addLine} size="sm" type="button" variant="outline">
            <Plus aria-hidden="true" />
            Añadir línea
          </Button>
        </div>
        {lines.map((line, index) => (
          <div className="rounded-md border p-3" key={line.id}>
            <div className="grid gap-3 lg:grid-cols-12">
              <div className="space-y-2 lg:col-span-3">
                <Label htmlFor={`expense-line-description-${line.id}`}>Concepto</Label>
                <Input id={`expense-line-description-${line.id}`} onChange={(event) => updateLine(line.id, { description: event.target.value })} required value={line.description} />
              </div>
              <div className="space-y-2 lg:col-span-3">
                <Label htmlFor={`expense-line-account-${line.id}`}>Cuenta</Label>
                <Select id={`expense-line-account-${line.id}`} onChange={(event) => updateLine(line.id, { expenseAccountId: event.target.value })} required value={line.expenseAccountId}>
                  {expenseAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.code} - {account.name}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`expense-line-quantity-${line.id}`}>Cant.</Label>
                <Input id={`expense-line-quantity-${line.id}`} min="0.001" onChange={(event) => updateLine(line.id, { quantity: event.target.value })} required step="0.001" type="number" value={line.quantity} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`expense-line-price-${line.id}`}>Base</Label>
                <Input id={`expense-line-price-${line.id}`} min="0" onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })} required step="0.01" type="number" value={line.unitPrice} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`expense-line-tax-${line.id}`}>IVA</Label>
                <Input id={`expense-line-tax-${line.id}`} min="0" max="100" onChange={(event) => updateLine(line.id, { taxRate: event.target.value })} required step="0.001" type="number" value={line.taxRate} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`expense-line-deductible-${line.id}`}>Ded.</Label>
                <Input id={`expense-line-deductible-${line.id}`} min="0" max="100" onChange={(event) => updateLine(line.id, { taxDeductiblePct: event.target.value })} required step="0.001" type="number" value={line.taxDeductiblePct} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`expense-line-retention-${line.id}`}>Ret.</Label>
                <Input id={`expense-line-retention-${line.id}`} min="0" max="100" onChange={(event) => updateLine(line.id, { retentionRate: event.target.value })} required step="0.001" type="number" value={line.retentionRate} />
              </div>
              <div className="flex items-end justify-between gap-2">
                <p className="pb-2 text-sm font-medium">{formatMoney(lineTotals(line).total)}</p>
                <Button aria-label={`Eliminar línea ${index + 1}`} disabled={lines.length === 1} onClick={() => removeLine(line.id)} size="icon" type="button" variant="ghost">
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="space-y-2 lg:col-span-3">
          <Label htmlFor="expense-notes">Notas</Label>
          <Textarea id="expense-notes" onChange={(event) => setNotes(event.target.value)} value={notes} />
        </div>
        <div className="rounded-md border bg-muted/20 p-3 text-sm">
          <p className="font-medium">Total previsto</p>
          <p className="text-muted-foreground">Base {formatMoney(preview.subtotal)}</p>
          <p className="text-muted-foreground">IVA {formatMoney(preview.tax)}</p>
          <p className="text-muted-foreground">Retención {formatMoney(preview.retention)}</p>
          <p className="mt-1 text-lg font-semibold">{formatMoney(preview.total)}</p>
        </div>
      </div>

      <Button disabled={isLoading || expenseAccounts.length === 0} type="submit">
        {isLoading ? "Guardando..." : "Registrar gasto"}
      </Button>
      {error ? (
        <p className="text-sm text-red-600" id="expense-invoice-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

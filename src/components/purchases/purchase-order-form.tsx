"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  DocumentLinesEditor,
  createDocumentLine,
  documentLinesPayload,
  documentLinesTotals,
  validateDocumentLines,
  type DocumentLineDraft,
  type DocumentLineErrors,
} from "@/components/invoices/document-lines-editor";
import { InvoiceTotalsSummary } from "@/components/invoices/invoice-form-controls";
import { CreateSupplierForm } from "@/components/suppliers/create-supplier-form";
import { SupplierPicker } from "@/components/suppliers/supplier-picker";
import { Dialog } from "@/components/ui/dialog";
import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { getManualPurchaseOrderStatuses } from "@/lib/document-pipelines";
import { purchaseOrderStatusLabels, statusLabel } from "@/lib/status-labels";

export type PurchaseItemOption = { id: string; sku: string; name: string; costPrice: string };
export type PurchaseSupplierOption = { id: string; number: string; name: string; taxId?: string | null; isActive?: boolean };
export type PurchaseOrderInitialLine = { id?: string; itemId: string | null; description: string; quantity: string; unitPrice: string };

type HeaderErrors = Partial<Record<"supplier" | "number", string>>;

/** Purchase order editor shared by the create and edit pages. */
export function PurchaseOrderForm({
  currencyCode = "EUR",
  defaultNumber = "",
  defaultStatus,
  defaultSupplierId = "",
  initialLines,
  items = [],
  orderId,
  redirectHref,
  suppliers = [],
}: {
  currencyCode?: string;
  defaultNumber?: string;
  defaultStatus?: string;
  defaultSupplierId?: string;
  initialLines?: PurchaseOrderInitialLine[];
  items?: PurchaseItemOption[];
  orderId?: string;
  redirectHref?: string;
  suppliers?: PurchaseSupplierOption[];
}) {
  const router = useRouter();
  const isEdit = Boolean(orderId);
  const [supplierOptions, setSupplierOptions] = useState<PurchaseSupplierOption[]>(suppliers);
  const [supplierPartnerId, setSupplierPartnerId] = useState(suppliers.some((supplier) => supplier.id === defaultSupplierId) ? defaultSupplierId : "");
  const [createSupplierOpen, setCreateSupplierOpen] = useState(false);
  const [number, setNumber] = useState(defaultNumber);
  const [status, setStatus] = useState(defaultStatus ?? "");
  const [lines, setLines] = useState<DocumentLineDraft[]>(() =>
    initialLines?.length
      ? initialLines.map((line) => createDocumentLine({ itemId: line.itemId ?? "", description: line.description, quantity: line.quantity, unitPrice: line.unitPrice }))
      : [createDocumentLine({ itemId: "" })],
  );
  const [headerErrors, setHeaderErrors] = useState<HeaderErrors>({});
  const [lineErrors, setLineErrors] = useState<DocumentLineErrors[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const totals = documentLinesTotals(lines, { withTax: false });
  const statuses = defaultStatus ? getManualPurchaseOrderStatuses(defaultStatus) : [];
  const catalog = items.map((item) => ({ id: item.id, label: `${item.sku} · ${item.name}`, description: item.name, unitPrice: item.costPrice }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextHeaderErrors: HeaderErrors = {};
    if (!supplierPartnerId) nextHeaderErrors.supplier = "Elige el proveedor: búscalo por nombre o NIF, o créalo desde el propio buscador.";
    if (isEdit && !number.trim()) nextHeaderErrors.number = "El número del pedido no puede quedar vacío.";
    const validation = validateDocumentLines(lines, { withTax: false });
    setHeaderErrors(nextHeaderErrors);
    setLineErrors(validation.errors);
    if (Object.keys(nextHeaderErrors).length > 0 || !validation.isValid) {
      setFormError("Revisa los campos marcados antes de guardar.");
      const firstLine = validation.errors.findIndex((errors) => Object.keys(errors).length > 0);
      const targetId = nextHeaderErrors.supplier
        ? "po-supplier"
        : nextHeaderErrors.number
          ? "po-number"
          : firstLine >= 0
            ? `po-line-${firstLine + 1}-${validation.errors[firstLine].description ? "description" : validation.errors[firstLine].quantity ? "quantity" : "unit-price"}`
            : null;
      if (targetId) requestAnimationFrame(() => document.getElementById(targetId)?.focus());
      return;
    }

    setFormError(null);
    setPending(true);
    const fallback = isEdit ? "No se pudo guardar el pedido de compra." : "No se pudo crear el pedido de compra.";
    try {
      const response = await fetch(orderId ? `/api/purchases/${orderId}` : "/api/purchases", {
        method: orderId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          supplierPartnerId,
          number,
          ...(isEdit ? { status } : {}),
          lines: documentLinesPayload(lines, { withItem: true, withTax: false }),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, fallback));
      const payload = (await response.json().catch(() => null)) as { id?: string } | null;
      const targetId = orderId ?? payload?.id;
      toast.success(isEdit ? "Pedido de compra actualizado." : "Pedido de compra creado.");
      router.push(redirectHref ?? (targetId ? `/purchases/orders/${targetId}` : "/purchases/orders"));
      router.refresh();
    } catch (error) {
      const message = errorMessage(error, fallback);
      setFormError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
    <form className="space-y-3" data-testid="purchase-order-form" noValidate onSubmit={submit}>
      <RequiredFieldsNote />
      <div className={isEdit ? "grid gap-3 md:grid-cols-3" : "grid gap-3 md:grid-cols-2"}>
        <AccessibleField
          error={headerErrors.supplier}
          helperText="Busca por nombre o NIF. Si es nuevo, elige «Crear proveedor» en la lista."
          id="po-supplier"
          label="Proveedor"
          required
        >
          <SupplierPicker
            id="po-supplier"
            onChange={(supplierId) => {
              setSupplierPartnerId(supplierId);
              if (headerErrors.supplier) setHeaderErrors((current) => ({ ...current, supplier: undefined }));
            }}
            onCreateRequested={() => setCreateSupplierOpen(true)}
            suppliers={supplierOptions}
            value={supplierPartnerId}
          />
        </AccessibleField>
        <AccessibleField
          error={headerErrors.number}
          helperText={isEdit ? undefined : "Déjalo vacío para usar la serie configurada."}
          id="po-number"
          label={isEdit ? "Número" : "Número interno"}
          required={isEdit}
        >
          <Input autoComplete="off" onChange={(event) => setNumber(event.target.value)} placeholder={isEdit ? undefined : "Asignación automática"} value={number} />
        </AccessibleField>
        {isEdit ? (
          <AccessibleField helperText="Recepción, facturación y pago actualizan el estado automáticamente." id="po-status" label="Estado operativo" required>
            <Select onChange={(event) => setStatus(event.target.value)} value={status}>
              {statuses.map((option) => (
                <option key={option} value={option}>{statusLabel(purchaseOrderStatusLabels, option)}</option>
              ))}
            </Select>
          </AccessibleField>
        ) : null}
      </div>

      <DocumentLinesEditor
        catalog={catalog}
        currencyCode={currencyCode}
        description="Elige un artículo del catálogo para rellenar concepto y coste, o escribe un concepto libre. Enter avanza; Alt+L añade una línea."
        errors={lineErrors}
        idPrefix="po-line"
        lines={lines}
        onChange={(next) => {
          setLines(next);
          if (lineErrors.length) setLineErrors([]);
        }}
        title="Líneas del pedido"
        withTax={false}
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)]">
        <p className="self-end text-xs text-muted-foreground">Importes sin impuestos: el IVA se aplica al registrar la factura del proveedor.</p>
        <InvoiceTotalsSummary currencyCode={currencyCode} testIdPrefix="purchase-order" title="Total estimado" totals={totals} />
      </div>

      <FormErrorMessage id="purchase-order-error">{formError}</FormErrorMessage>
      <FormActions sticky>
        <SubmitButton aria-keyshortcuts="Control+Enter Meta+Enter" className="min-w-36" data-testid="purchase-order-submit" pending={pending}>
          {isEdit ? "Guardar cambios" : "Crear pedido de compra"}
        </SubmitButton>
      </FormActions>
    </form>
    {/* Fuera del <form>: los eventos del portal no deben llegar al envío del pedido. */}
    <Dialog
      description="Da de alta el proveedor con sus datos fiscales; quedará elegido en el pedido."
      onClose={() => setCreateSupplierOpen(false)}
      open={createSupplierOpen}
      size="xl"
      title="Crear proveedor"
    >
      <CreateSupplierForm
        onCreated={(created) => {
          setSupplierOptions((current) => (current.some((supplier) => supplier.id === created.id) ? current : [...current, created]));
          setSupplierPartnerId(created.id);
          setCreateSupplierOpen(false);
        }}
      />
    </Dialog>
    </>
  );
}

"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import type { InvoiceTaxOption } from "@/components/create-invoice-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { invoiceStatusLabels, statusLabel } from "@/lib/status-labels";
import { updateInvoiceSchema } from "@/server/schemas/forms";

const statusOptions = ["DRAFT", "SENT", "PAID", "OVERDUE", "VOID"] as const;

type UpdateInvoicePayload = z.infer<typeof updateInvoiceSchema>;

type EditableInvoiceLine = UpdateInvoicePayload["lines"][number];

export function EditInvoiceForm({
  defaultLines,
  defaultNotes,
  defaultStatus,
  defaultTotalAmount,
  id,
  taxes,
}: {
  id: string;
  defaultLines: EditableInvoiceLine[];
  defaultNotes: string | null;
  defaultStatus: "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "VOID";
  defaultTotalAmount: number;
  taxes: Array<InvoiceTaxOption & { isActive: boolean }>;
}) {
  const router = useRouter();
  const defaultTaxIds = useMemo(() => taxes.filter((configuredTax) => configuredTax.isActive && configuredTax.isDefault).map((configuredTax) => configuredTax.id), [taxes]);
  const emptyLine: EditableInvoiceLine = {
    description: "",
    quantity: 1,
    unitPrice: 0,
    taxRate: 0,
    retentionRate: 0,
    taxIds: defaultTaxIds,
  };
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<UpdateInvoicePayload>({
    resolver: zodResolver(updateInvoiceSchema),
    defaultValues: {
      status: defaultStatus,
      notes: defaultNotes ?? "",
      totalAmount: defaultTotalAmount,
      lines: defaultLines.length > 0 ? defaultLines : [emptyLine],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const watchedLines = useWatch({ control, name: "lines" });
  const calculatedLines = (watchedLines ?? []).map((line) => ({
    ...line,
    taxes: taxes.filter((configuredTax) => line?.taxIds?.includes(configuredTax.id)),
  }));
  const totals = calculateInvoiceTotals(calculatedLines);
  const statusErrorId = errors.status ? "invoice-status-error" : undefined;

  useEffect(() => {
    setValue("totalAmount", totals.totalAmount, { shouldValidate: true });
  }, [setValue, totals.totalAmount]);

  return (
    <form
      className="grid gap-4"
      onSubmit={handleSubmit(async (values) => {
        const invoiceTotals = calculateInvoiceTotals(values.lines.map((line) => ({
          ...line,
          taxes: taxes.filter((configuredTax) => line.taxIds?.includes(configuredTax.id)),
        })));
        const response = await fetch(`/api/invoices/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify({ ...values, totalAmount: invoiceTotals.totalAmount }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as { message?: string };
          toast.error(payload.message ?? "No se pudo actualizar la factura.");
          return;
        }

        toast.success("Factura actualizada correctamente.");
        router.push("/invoices");
        router.refresh();
      })}
    >
      <input type="hidden" {...register("totalAmount", { valueAsNumber: true })} />
      <div className="space-y-2">
        <Label htmlFor="invoice-status">Estado</Label>
        <Select
          id="invoice-status"
          aria-invalid={Boolean(errors.status)}
          aria-describedby={statusErrorId}
          {...register("status")}
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {statusLabel(invoiceStatusLabels, status)}
            </option>
          ))}
        </Select>
        {errors.status ? (
          <p id="invoice-status-error" className="text-sm text-red-600" role="alert">
            {errors.status.message}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="invoice-notes">Notas</Label>
        <Input id="invoice-notes" {...register("notes")} />
      </div>

      <section className="space-y-3" aria-labelledby="invoice-lines-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 id="invoice-lines-title" className="text-sm font-medium">
              Líneas de factura
            </h3>
            <p className="text-sm text-muted-foreground">Selecciona uno o varios impuestos por línea. Las retenciones reducen el total.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => append(emptyLine)}>
            Añadir línea
          </Button>
        </div>

        {fields.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No hay líneas en esta factura.</p>
        ) : (
          <div className="space-y-3">
            {fields.map((field, index) => {
              const lineNumber = index + 1;
              const lineErrors = errors.lines?.[index];
              const lineTotals = totals.lines[index] ?? { subtotal: 0, taxAmount: 0, retentionAmount: 0, lineTotal: 0, taxes: [] };
              return (
                <fieldset key={field.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-12">
                  <legend className="px-1 text-sm font-medium">Línea {lineNumber}</legend>
                  <div className="space-y-2 md:col-span-4">
                    <Label htmlFor={`invoice-line-${field.id}-description`}>Descripción línea {lineNumber}</Label>
                    <Input
                      id={`invoice-line-${field.id}-description`}
                      aria-label={`Descripción línea ${lineNumber}`}
                      aria-invalid={Boolean(lineErrors?.description)}
                      {...register(`lines.${index}.description`)}
                    />
                    {lineErrors?.description ? <p className="text-sm text-red-600">{lineErrors.description.message}</p> : null}
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor={`invoice-line-${field.id}-quantity`}>Cantidad línea {lineNumber}</Label>
                    <Input
                      id={`invoice-line-${field.id}-quantity`}
                      aria-label={`Cantidad línea ${lineNumber}`}
                      min={0.001}
                      step="0.001"
                      type="number"
                      aria-invalid={Boolean(lineErrors?.quantity)}
                      {...register(`lines.${index}.quantity`, { valueAsNumber: true })}
                    />
                    {lineErrors?.quantity ? <p className="text-sm text-red-600">{lineErrors.quantity.message}</p> : null}
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor={`invoice-line-${field.id}-unit-price`}>Precio unitario línea {lineNumber}</Label>
                    <Input
                      id={`invoice-line-${field.id}-unit-price`}
                      aria-label={`Precio unitario línea ${lineNumber}`}
                      min={0}
                      step="0.01"
                      type="number"
                      aria-invalid={Boolean(lineErrors?.unitPrice)}
                      {...register(`lines.${index}.unitPrice`, { valueAsNumber: true })}
                    />
                    {lineErrors?.unitPrice ? <p className="text-sm text-red-600">{lineErrors.unitPrice.message}</p> : null}
                  </div>
                  <div className="space-y-2 md:col-span-4">
                    <Label>Impuestos línea {lineNumber}</Label>
                    <div className="flex min-h-10 flex-wrap gap-2 rounded-md border p-2" role="group" aria-label={`Impuestos línea ${lineNumber}`}>
                      {taxes.map((configuredTax) => (
                        <label className={`flex cursor-pointer items-center gap-2 rounded-md border bg-background px-2 py-1 text-sm ${configuredTax.isActive ? "" : "opacity-60"}`} key={configuredTax.id}>
                          <input type="checkbox" value={configuredTax.id} {...register(`lines.${index}.taxIds`)} />
                          <span>
                            {configuredTax.name} <span className="font-mono text-muted-foreground">{configuredTax.operation === "SUBTRACT" ? "−" : "+"}{configuredTax.rate.toLocaleString("es-ES")}%</span>
                            {!configuredTax.isActive ? " (archivado)" : ""}
                          </span>
                        </label>
                      ))}
                      {taxes.length === 0 ? <p className="text-sm text-muted-foreground">No hay impuestos configurados.</p> : null}
                    </div>
                    {lineErrors?.taxIds ? <p className="text-sm text-red-600">{lineErrors.taxIds.message}</p> : null}
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t pt-3 md:col-span-12">
                    <div className="text-sm text-muted-foreground" aria-live="polite">
                      <p>Base: {formatMoney(lineTotals.subtotal)} · Total línea: {formatMoney(lineTotals.lineTotal)}</p>
                      {lineTotals.taxes.length > 0 ? <p>{lineTotals.taxes.map((selectedTax) => `${selectedTax.operation === "SUBTRACT" ? "−" : "+"}${selectedTax.name} ${formatMoney(selectedTax.amount)}`).join(" · ")}</p> : null}
                    </div>
                    <Button type="button" variant="ghost" onClick={() => remove(index)} disabled={fields.length === 1}>
                      Quitar
                    </Button>
                  </div>
                </fieldset>
              );
            })}
          </div>
        )}
        {errors.lines?.root ? <p className="text-sm text-red-600">{errors.lines.root.message}</p> : null}
      </section>

      <div className="rounded-md bg-muted p-3 text-sm" aria-live="polite">
        <p>Subtotal: {formatMoney(totals.subtotal)}</p>
        <p>Impuestos añadidos: {formatMoney(totals.taxAmount)}</p>
        {totals.retentionAmount > 0 ? <p>Retenciones: −{formatMoney(totals.retentionAmount)}</p> : null}
        <p className="font-medium">Total: {formatMoney(totals.totalAmount)}</p>
        {errors.totalAmount ? <p className="text-red-600">{errors.totalAmount.message}</p> : null}
      </div>

      <Button disabled={isSubmitting} type="submit">
        {isSubmitting ? "Guardando..." : "Guardar cambios"}
      </Button>
    </form>
  );
}

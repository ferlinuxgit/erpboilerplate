"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { updateInvoiceSchema } from "@/server/schemas/forms";

const statusOptions = ["DRAFT", "SENT", "PAID", "OVERDUE", "VOID"] as const;

const emptyLine = {
  description: "",
  quantity: 1,
  unitPrice: 0,
  taxRate: 21,
};

type UpdateInvoicePayload = z.infer<typeof updateInvoiceSchema>;

type EditableInvoiceLine = UpdateInvoicePayload["lines"][number];

export function EditInvoiceForm({
  defaultLines,
  defaultNotes,
  defaultStatus,
  defaultTotalAmount,
  id,
}: {
  id: string;
  defaultLines: EditableInvoiceLine[];
  defaultNotes: string | null;
  defaultStatus: "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "VOID";
  defaultTotalAmount: number;
}) {
  const router = useRouter();
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
  const totals = calculateInvoiceTotals(watchedLines ?? []);
  const statusErrorId = errors.status ? "invoice-status-error" : undefined;

  useEffect(() => {
    setValue("totalAmount", totals.totalAmount, { shouldValidate: true });
  }, [setValue, totals.totalAmount]);

  return (
    <form
      className="grid gap-4"
      onSubmit={handleSubmit(async (values) => {
        const invoiceTotals = calculateInvoiceTotals(values.lines);
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
        <select
          id="invoice-status"
          className="h-8 rounded-md border px-2 text-sm"
          aria-invalid={Boolean(errors.status)}
          aria-describedby={statusErrorId}
          {...register("status")}
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
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
            <p className="text-sm text-muted-foreground">Edita las líneas para recalcular el total antes de guardar.</p>
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
              const lineTotals = totals.lines[index] ?? { subtotal: 0, taxAmount: 0, lineTotal: 0 };
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
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor={`invoice-line-${field.id}-tax-rate`}>IVA % línea {lineNumber}</Label>
                    <Input
                      id={`invoice-line-${field.id}-tax-rate`}
                      aria-label={`IVA % línea ${lineNumber}`}
                      min={0}
                      max={100}
                      step="0.001"
                      type="number"
                      aria-invalid={Boolean(lineErrors?.taxRate)}
                      {...register(`lines.${index}.taxRate`, { valueAsNumber: true })}
                    />
                    {lineErrors?.taxRate ? <p className="text-sm text-red-600">{lineErrors.taxRate.message}</p> : null}
                  </div>
                  <div className="flex items-end justify-between gap-3 md:col-span-2">
                    <p className="text-sm text-muted-foreground" aria-live="polite">
                      Línea: {formatMoney(lineTotals.lineTotal)}
                    </p>
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
        <p>IVA: {formatMoney(totals.taxAmount)}</p>
        <p className="font-medium">Total: {formatMoney(totals.totalAmount)}</p>
        {errors.totalAmount ? <p className="text-red-600">{errors.totalAmount.message}</p> : null}
      </div>

      <Button disabled={isSubmitting} type="submit">
        {isSubmitting ? "Guardando..." : "Guardar cambios"}
      </Button>
    </form>
  );
}

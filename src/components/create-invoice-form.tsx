"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { createInvoiceSchema } from "@/server/schemas/forms";

type CustomerOption = {
  id: string;
  name: string;
};

type CreateInvoicePayload = z.infer<typeof createInvoiceSchema>;

const emptyLine = {
  description: "",
  quantity: 1,
  unitPrice: 0,
  taxRate: 21,
};

export function CreateInvoiceForm({ customers }: { customers: CustomerOption[] }) {
  const router = useRouter();
  const {
    control,
    register,
    reset,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateInvoicePayload>({
    resolver: zodResolver(createInvoiceSchema),
    defaultValues: {
      customerId: customers[0]?.id ?? "",
      number: "",
      issueDate: "",
      dueDate: "",
      totalAmount: 0,
      notes: "",
      lines: [emptyLine],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const watchedLines = useWatch({ control, name: "lines" });
  const totals = calculateInvoiceTotals(watchedLines ?? []);

  useEffect(() => {
    setValue("totalAmount", totals.totalAmount, { shouldValidate: true });
  }, [setValue, totals.totalAmount]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const invoiceTotals = calculateInvoiceTotals(values.lines);
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCsrfHeader(),
        },
        body: JSON.stringify({ ...values, totalAmount: invoiceTotals.totalAmount }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "No se pudo crear la factura.");
      }

      reset({
        customerId: customers[0]?.id ?? "",
        number: "",
        issueDate: "",
        dueDate: "",
        totalAmount: 0,
        notes: "",
        lines: [emptyLine],
      });
      toast.success("Factura creada correctamente.");
      router.refresh();
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : "Ha ocurrido un error inesperado.";
      toast.error(message);
    }
  });

  return (
    <form className="grid gap-4 md:grid-cols-3" data-testid="invoice-create-form" onSubmit={onSubmit}>
      <input type="hidden" {...register("totalAmount", { valueAsNumber: true })} />
      <AccessibleField id="invoice-customer" label="Cliente" required error={errors.customerId?.message}>
        <select
          className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
          data-testid="invoice-customer-select"
          id="invoice-customer"
          required
          aria-label="Cliente"
          aria-invalid={Boolean(errors.customerId)}
          aria-describedby={errors.customerId ? "invoice-customer-error" : undefined}
          {...register("customerId")}
        >
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </AccessibleField>
      <AccessibleField id="invoice-number" label="Número" required error={errors.number?.message} helperText="Usa una numeración única y reconocible.">
        <Input
          data-testid="invoice-number-input"
          id="invoice-number"
          placeholder="FAC-2026-0001"
          required
          aria-label="Número de factura"
          aria-invalid={Boolean(errors.number)}
          aria-describedby={errors.number ? "invoice-number-error" : "invoice-number-helper"}
          {...register("number")}
        />
      </AccessibleField>
      <AccessibleField id="invoice-issue-date" label="Fecha emisión" required error={errors.issueDate?.message}>
        <Input
          data-testid="invoice-issue-date-input"
          id="invoice-issue-date"
          required
          type="date"
          aria-label="Fecha de emisión"
          aria-invalid={Boolean(errors.issueDate)}
          aria-describedby={errors.issueDate ? "invoice-issue-date-error" : undefined}
          {...register("issueDate")}
        />
      </AccessibleField>
      <AccessibleField id="invoice-due-date" label="Fecha vencimiento" error={errors.dueDate?.message}>
        <Input
          data-testid="invoice-due-date-input"
          id="invoice-due-date"
          type="date"
          aria-label="Fecha de vencimiento"
          aria-invalid={Boolean(errors.dueDate)}
          aria-describedby={errors.dueDate ? "invoice-due-date-error" : undefined}
          {...register("dueDate")}
        />
      </AccessibleField>
      <AccessibleField id="invoice-notes" label="Notas" className="md:col-span-2" error={errors.notes?.message} helperText="Opcional; se mostrarán como observaciones internas.">
        <Input
          data-testid="invoice-notes-input"
          id="invoice-notes"
          placeholder="Observaciones"
          aria-label="Notas de factura"
          aria-invalid={Boolean(errors.notes)}
          aria-describedby={errors.notes ? "invoice-notes-error" : "invoice-notes-helper"}
          {...register("notes")}
        />
      </AccessibleField>

      <section className="space-y-3 md:col-span-3" aria-labelledby="invoice-lines-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 id="invoice-lines-title" className="text-sm font-medium">
              Líneas de factura
            </h3>
            <p className="text-sm text-muted-foreground">Añade al menos una línea para calcular el total automáticamente.</p>
          </div>
          <Button data-testid="invoice-add-line" type="button" variant="outline" onClick={() => append(emptyLine)}>
            Añadir línea
          </Button>
        </div>

        {fields.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No hay líneas en esta factura.</p>
        ) : (
          <div className="space-y-3">
            {fields.map((field, index) => {
              const lineNumber = index + 1;
              const descriptionId = `invoice-line-${lineNumber}-description`;
              const quantityId = `invoice-line-${lineNumber}-quantity`;
              const unitPriceId = `invoice-line-${lineNumber}-unit-price`;
              const taxRateId = `invoice-line-${lineNumber}-tax-rate`;
              const lineErrors = errors.lines?.[index];
              const lineTotals = totals.lines[index] ?? { subtotal: 0, taxAmount: 0, lineTotal: 0 };
              return (
                <fieldset key={field.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-12" data-testid={`invoice-line-${lineNumber}`}>
                  <legend className="px-1 text-sm font-medium">Línea {lineNumber}</legend>
                  <div className="space-y-2 md:col-span-4">
                    <Label htmlFor={descriptionId}>Descripción línea {lineNumber}</Label>
                    <Input
                      data-testid={descriptionId}
                      id={descriptionId}
                      aria-label={`Descripción línea ${lineNumber}`}
                      aria-invalid={Boolean(lineErrors?.description)}
                      {...register(`lines.${index}.description`)}
                    />
                    {lineErrors?.description ? <p className="text-sm text-red-600" role="alert">{lineErrors.description.message}</p> : null}
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor={quantityId}>Cantidad línea {lineNumber}</Label>
                    <Input
                      data-testid={quantityId}
                      id={quantityId}
                      aria-label={`Cantidad línea ${lineNumber}`}
                      min={0.001}
                      step="0.001"
                      type="number"
                      aria-invalid={Boolean(lineErrors?.quantity)}
                      {...register(`lines.${index}.quantity`, { valueAsNumber: true })}
                    />
                    {lineErrors?.quantity ? <p className="text-sm text-red-600" role="alert">{lineErrors.quantity.message}</p> : null}
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor={unitPriceId}>Precio unitario línea {lineNumber}</Label>
                    <Input
                      data-testid={unitPriceId}
                      id={unitPriceId}
                      aria-label={`Precio unitario línea ${lineNumber}`}
                      min={0}
                      step="0.01"
                      type="number"
                      aria-invalid={Boolean(lineErrors?.unitPrice)}
                      {...register(`lines.${index}.unitPrice`, { valueAsNumber: true })}
                    />
                    {lineErrors?.unitPrice ? <p className="text-sm text-red-600" role="alert">{lineErrors.unitPrice.message}</p> : null}
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor={taxRateId}>IVA % línea {lineNumber}</Label>
                    <Input
                      data-testid={taxRateId}
                      id={taxRateId}
                      aria-label={`IVA % línea ${lineNumber}`}
                      min={0}
                      max={100}
                      step="0.001"
                      type="number"
                      aria-invalid={Boolean(lineErrors?.taxRate)}
                      {...register(`lines.${index}.taxRate`, { valueAsNumber: true })}
                    />
                    {lineErrors?.taxRate ? <p className="text-sm text-red-600" role="alert">{lineErrors.taxRate.message}</p> : null}
                  </div>
                  <div className="flex items-end justify-between gap-3 md:col-span-2">
                    <p className="text-sm text-muted-foreground" aria-live="polite" data-testid={`invoice-line-${lineNumber}-total`}>
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
        {errors.lines?.root ? <p className="text-sm text-red-600" role="alert">{errors.lines.root.message}</p> : null}
      </section>

      <div className="rounded-md bg-muted p-3 text-sm md:col-span-3" aria-live="polite" data-testid="invoice-totals">
        <p data-testid="invoice-subtotal">Subtotal: {formatMoney(totals.subtotal)}</p>
        <p data-testid="invoice-tax-total">IVA: {formatMoney(totals.taxAmount)}</p>
        <p className="font-medium" data-testid="invoice-grand-total">Total: {formatMoney(totals.totalAmount)}</p>
        {errors.totalAmount ? <p className="text-red-600" role="alert">{errors.totalAmount.message}</p> : null}
      </div>

      <div className="md:col-span-3">
        <Button data-testid="invoice-create-submit" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Guardando..." : "Crear factura"}
        </Button>
      </div>
    </form>
  );
}

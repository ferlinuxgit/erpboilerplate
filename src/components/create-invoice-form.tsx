"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { createInvoiceSchema } from "@/server/schemas/forms";

type CustomerOption = {
  id: string;
  name: string;
};

type CreateInvoicePayload = z.infer<typeof createInvoiceSchema>;
type CreatedInvoicePayload = {
  id: string;
  number: string;
  status: string;
  customer?: CustomerOption | null;
};

const emptyLine = {
  description: "",
  quantity: 1,
  unitPrice: 0,
  taxRate: 21,
};

export function CreateInvoiceForm({ canCreateCustomer, customers }: { canCreateCustomer: boolean; customers: CustomerOption[] }) {
  const router = useRouter();
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [customerMode, setCustomerMode] = useState<"existing" | "new">(customers.length > 0 ? "existing" : "new");
  const {
    control,
    register,
    reset,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateInvoicePayload>({
    resolver: zodResolver(createInvoiceSchema),
    shouldUnregister: true,
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
      const payload = customerMode === "new"
        ? { ...values, customerId: "", totalAmount: invoiceTotals.totalAmount }
        : { ...values, newCustomer: undefined, totalAmount: invoiceTotals.totalAmount };
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCsrfHeader(),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "No se pudo crear la factura.");
      }

      const created = (await response.json()) as CreatedInvoicePayload;
      const nextCustomerOptions = created.customer && !customerOptions.some((customer) => customer.id === created.customer?.id)
        ? [...customerOptions, created.customer]
        : customerOptions;
      const nextCustomerId = created.customer?.id ?? nextCustomerOptions[0]?.id ?? "";

      if (nextCustomerOptions !== customerOptions) {
        setCustomerOptions(nextCustomerOptions);
      }
      setCustomerMode(nextCustomerOptions.length > 0 ? "existing" : "new");
      reset({
        customerId: nextCustomerId,
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
      <section className="space-y-3 rounded-md border p-3 md:col-span-3" aria-labelledby="invoice-customer-title">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 id="invoice-customer-title" className="text-sm font-medium">
              Cliente
            </h3>
            <p className="text-sm text-muted-foreground">Selecciona un cliente existente o crea uno con los mínimos fiscales para facturar.</p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={customerMode === "existing" ? "default" : "outline"}
              disabled={customerOptions.length === 0}
              onClick={() => {
                setCustomerMode("existing");
                setValue("customerId", customerOptions[0]?.id ?? "", { shouldValidate: true });
              }}
            >
              Existente
            </Button>
            {canCreateCustomer ? (
              <Button
                data-testid="invoice-new-customer-toggle"
                type="button"
                variant={customerMode === "new" ? "default" : "outline"}
                onClick={() => {
                  setCustomerMode("new");
                  setValue("customerId", "", { shouldValidate: true });
                }}
              >
                Nuevo cliente
              </Button>
            ) : null}
          </div>
        </div>

        {customerMode === "new" && !canCreateCustomer ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No hay clientes activos y tu rol no permite crear clientes desde la factura.
          </p>
        ) : customerMode === "existing" ? (
          <AccessibleField id="invoice-customer" label="Cliente existente" required error={errors.customerId?.message}>
            <Select
              data-testid="invoice-customer-select"
              id="invoice-customer"
              required
              aria-label="Cliente"
              aria-invalid={Boolean(errors.customerId)}
              aria-describedby={errors.customerId ? "invoice-customer-error" : undefined}
              {...register("customerId")}
            >
              {customerOptions.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </Select>
          </AccessibleField>
        ) : (
          <div className="grid gap-3 md:grid-cols-6">
            <AccessibleField id="invoice-new-customer-name" label="Nombre / razón social" required className="md:col-span-2" error={errors.newCustomer?.name?.message}>
              <Input
                data-testid="invoice-new-customer-name-input"
                id="invoice-new-customer-name"
                required
                aria-label="Nombre o razón social del cliente nuevo"
                aria-invalid={Boolean(errors.newCustomer?.name)}
                aria-describedby={errors.newCustomer?.name ? "invoice-new-customer-name-error" : undefined}
                {...register("newCustomer.name")}
              />
            </AccessibleField>
            <AccessibleField id="invoice-new-customer-tax-id" label="CIF/NIF/VAT" required error={errors.newCustomer?.taxId?.message}>
              <Input
                data-testid="invoice-new-customer-tax-id-input"
                id="invoice-new-customer-tax-id"
                placeholder="B12345674"
                required
                aria-label="CIF NIF VAT del cliente nuevo"
                aria-invalid={Boolean(errors.newCustomer?.taxId)}
                aria-describedby={errors.newCustomer?.taxId ? "invoice-new-customer-tax-id-error" : undefined}
                {...register("newCustomer.taxId")}
              />
            </AccessibleField>
            <AccessibleField id="invoice-new-customer-country" label="País" required error={errors.newCustomer?.countryCode?.message}>
              <Input
                data-testid="invoice-new-customer-country-input"
                id="invoice-new-customer-country"
                defaultValue="ES"
                maxLength={2}
                required
                aria-label="País del cliente nuevo"
                aria-invalid={Boolean(errors.newCustomer?.countryCode)}
                aria-describedby={errors.newCustomer?.countryCode ? "invoice-new-customer-country-error" : undefined}
                {...register("newCustomer.countryCode")}
              />
            </AccessibleField>
            <AccessibleField id="invoice-new-customer-address" label="Dirección fiscal" required className="md:col-span-2" error={errors.newCustomer?.address?.message}>
              <Input
                data-testid="invoice-new-customer-address-input"
                id="invoice-new-customer-address"
                required
                aria-label="Dirección fiscal del cliente nuevo"
                aria-invalid={Boolean(errors.newCustomer?.address)}
                aria-describedby={errors.newCustomer?.address ? "invoice-new-customer-address-error" : undefined}
                {...register("newCustomer.address")}
              />
            </AccessibleField>
            <AccessibleField id="invoice-new-customer-address-line-2" label="Dirección 2" className="md:col-span-2" error={errors.newCustomer?.addressLine2?.message}>
              <Input
                data-testid="invoice-new-customer-address-line-2-input"
                id="invoice-new-customer-address-line-2"
                aria-label="Dirección 2 del cliente nuevo"
                aria-invalid={Boolean(errors.newCustomer?.addressLine2)}
                aria-describedby={errors.newCustomer?.addressLine2 ? "invoice-new-customer-address-line-2-error" : undefined}
                {...register("newCustomer.addressLine2")}
              />
            </AccessibleField>
            <AccessibleField id="invoice-new-customer-postal-code" label="Código postal" required error={errors.newCustomer?.postalCode?.message}>
              <Input
                data-testid="invoice-new-customer-postal-code-input"
                id="invoice-new-customer-postal-code"
                required
                aria-label="Código postal del cliente nuevo"
                aria-invalid={Boolean(errors.newCustomer?.postalCode)}
                aria-describedby={errors.newCustomer?.postalCode ? "invoice-new-customer-postal-code-error" : undefined}
                {...register("newCustomer.postalCode")}
              />
            </AccessibleField>
            <AccessibleField id="invoice-new-customer-city" label="Ciudad" required error={errors.newCustomer?.city?.message}>
              <Input
                data-testid="invoice-new-customer-city-input"
                id="invoice-new-customer-city"
                required
                aria-label="Ciudad del cliente nuevo"
                aria-invalid={Boolean(errors.newCustomer?.city)}
                aria-describedby={errors.newCustomer?.city ? "invoice-new-customer-city-error" : undefined}
                {...register("newCustomer.city")}
              />
            </AccessibleField>
            <AccessibleField id="invoice-new-customer-province" label="Provincia" required error={errors.newCustomer?.province?.message}>
              <Input
                data-testid="invoice-new-customer-province-input"
                id="invoice-new-customer-province"
                required
                aria-label="Provincia del cliente nuevo"
                aria-invalid={Boolean(errors.newCustomer?.province)}
                aria-describedby={errors.newCustomer?.province ? "invoice-new-customer-province-error" : undefined}
                {...register("newCustomer.province")}
              />
            </AccessibleField>
            <AccessibleField id="invoice-new-customer-email" label="Email" error={errors.newCustomer?.email?.message}>
              <Input
                data-testid="invoice-new-customer-email-input"
                id="invoice-new-customer-email"
                type="email"
                aria-label="Email del cliente nuevo"
                aria-invalid={Boolean(errors.newCustomer?.email)}
                aria-describedby={errors.newCustomer?.email ? "invoice-new-customer-email-error" : undefined}
                {...register("newCustomer.email")}
              />
            </AccessibleField>
            <AccessibleField id="invoice-new-customer-phone" label="Teléfono" error={errors.newCustomer?.phone?.message}>
              <Input
                data-testid="invoice-new-customer-phone-input"
                id="invoice-new-customer-phone"
                aria-label="Teléfono del cliente nuevo"
                aria-invalid={Boolean(errors.newCustomer?.phone)}
                aria-describedby={errors.newCustomer?.phone ? "invoice-new-customer-phone-error" : undefined}
                {...register("newCustomer.phone")}
              />
            </AccessibleField>
          </div>
        )}
      </section>
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

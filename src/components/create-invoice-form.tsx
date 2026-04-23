"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCsrfHeader } from "@/lib/csrf-client";
import { createInvoiceSchema } from "@/server/schemas/forms";

type CustomerOption = {
  id: string;
  name: string;
};

export function CreateInvoiceForm({ customers }: { customers: CustomerOption[] }) {
  type CreateInvoicePayload = z.infer<typeof createInvoiceSchema>;
  const router = useRouter();
  const {
    register,
    reset,
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
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCsrfHeader(),
        },
        body: JSON.stringify(values),
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
      });
      toast.success("Factura creada correctamente.");
      router.refresh();
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : "Ha ocurrido un error inesperado.";
      toast.error(message);
    }
  });

  return (
    <form className="grid gap-4 md:grid-cols-3" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="invoice-customer">Cliente</Label>
        <select
          className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
          id="invoice-customer"
          required
          {...register("customerId")}
        >
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
        {errors.customerId ? <p className="text-sm text-red-600">{errors.customerId.message}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="invoice-number">Número</Label>
        <Input
          id="invoice-number"
          placeholder="FAC-2026-0001"
          required
          {...register("number")}
        />
        {errors.number ? <p className="text-sm text-red-600">{errors.number.message}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="invoice-amount">Importe total</Label>
        <Input
          id="invoice-amount"
          min={0.01}
          placeholder="1500.00"
          required
          step="0.01"
          type="number"
          {...register("totalAmount", { valueAsNumber: true })}
        />
        {errors.totalAmount ? <p className="text-sm text-red-600">{errors.totalAmount.message}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="invoice-issue-date">Fecha emisión</Label>
        <Input
          id="invoice-issue-date"
          required
          type="date"
          {...register("issueDate")}
        />
        {errors.issueDate ? <p className="text-sm text-red-600">{errors.issueDate.message}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="invoice-due-date">Fecha vencimiento</Label>
        <Input id="invoice-due-date" type="date" {...register("dueDate")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invoice-notes">Notas</Label>
        <Input id="invoice-notes" placeholder="Observaciones" {...register("notes")} />
      </div>
      <div className="md:col-span-3">
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Guardando..." : "Crear factura"}
        </Button>
      </div>
    </form>
  );
}

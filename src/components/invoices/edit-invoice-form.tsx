"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";
import { updateInvoiceSchema } from "@/server/schemas/forms";

const statusOptions = ["DRAFT", "SENT", "PAID", "OVERDUE", "VOID"] as const;

export function EditInvoiceForm({
  defaultNumber,
  defaultNotes,
  defaultStatus,
  id,
}: {
  id: string;
  defaultNotes: string | null;
  defaultNumber: string;
  defaultStatus: "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "VOID";
}) {
  type UpdateInvoicePayload = z.infer<typeof updateInvoiceSchema>;
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateInvoicePayload>({
    resolver: zodResolver(updateInvoiceSchema),
    defaultValues: {
      number: defaultNumber,
      status: defaultStatus,
      notes: defaultNotes ?? "",
    },
  });

  return (
    <form
      className="grid gap-3"
      onSubmit={handleSubmit(async (values) => {
        const response = await fetch(`/api/invoices/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify(values),
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
      <Input required {...register("number")} />
      {errors.number ? <p className="text-sm text-red-600">{errors.number.message}</p> : null}
      <select className="h-8 rounded-md border px-2 text-sm" {...register("status")}>
        {statusOptions.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      {errors.status ? <p className="text-sm text-red-600">{errors.status.message}</p> : null}
      <Input {...register("notes")} />
      <Button disabled={isSubmitting} type="submit">
        {isSubmitting ? "Guardando..." : "Guardar cambios"}
      </Button>
    </form>
  );
}

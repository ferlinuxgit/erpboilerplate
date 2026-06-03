"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { purchaseOrderStatusLabels, statusLabel } from "@/lib/status-labels";

const purchaseOrderStatuses = ["DRAFT", "SENT", "APPROVED", "RECEIVED", "INVOICED", "PAID", "VOID", "CANCELLED"] as const;

type Props = {
  orderId: string;
  defaultNumber: string;
  defaultStatus: string;
};

export function EditPurchaseOrderForm({ orderId, defaultNumber, defaultStatus }: Props) {
  const router = useRouter();
  const [number, setNumber] = useState(defaultNumber);
  const [status, setStatus] = useState(defaultStatus);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = error ? "edit-purchase-order-error" : undefined;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch(`/api/purchases/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ number, status }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "No se pudo actualizar el pedido.");
      }
      toast.success("Pedido actualizado correctamente.");
      router.push("/purchases");
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
    <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="edit-po-number">Numero</Label>
        <Input
          id="edit-po-number"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          required
          aria-describedby={errorId}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-po-status">Estado</Label>
        <Select
          id="edit-po-status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          required
          aria-describedby={errorId}
        >
          {purchaseOrderStatuses.map((option) => (
            <option key={option} value={option}>
              {statusLabel(purchaseOrderStatusLabels, option)}
            </option>
          ))}
        </Select>
      </div>
      <div className="md:col-span-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
      {error ? <p id="edit-purchase-order-error" className="text-sm text-red-600 md:col-span-2" role="alert">{error}</p> : null}
    </form>
  );
}

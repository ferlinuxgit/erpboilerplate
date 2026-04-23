"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch(`/api/purchases/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number, status }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "No se pudo actualizar el pedido.");
      }
      router.push("/purchases");
      router.refresh();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Error inesperado.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="edit-po-number">Numero</Label>
        <Input id="edit-po-number" value={number} onChange={(event) => setNumber(event.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-po-status">Estado</Label>
        <Input id="edit-po-status" value={status} onChange={(event) => setStatus(event.target.value)} required />
      </div>
      <div className="md:col-span-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
      {error ? <p className="text-sm text-red-600 md:col-span-2">{error}</p> : null}
    </form>
  );
}

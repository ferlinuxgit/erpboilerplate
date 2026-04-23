"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCsrfHeader } from "@/lib/csrf-client";

export function CreatePurchaseOrderForm() {
  const router = useRouter();
  const [supplierName, setSupplierName] = useState("");
  const [number, setNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ supplierName, number }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "No se pudo crear el pedido.");
      }
      setSupplierName("");
      setNumber("");
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
        <Label htmlFor="po-supplier-name">Proveedor</Label>
        <Input id="po-supplier-name" value={supplierName} onChange={(event) => setSupplierName(event.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="po-number">Numero</Label>
        <Input id="po-number" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="PO-2026-0001" required />
      </div>
      <div className="md:col-span-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Guardando..." : "Crear pedido"}
        </Button>
      </div>
      {error ? <p className="text-sm text-red-600 md:col-span-2">{error}</p> : null}
    </form>
  );
}

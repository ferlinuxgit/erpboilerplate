"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCsrfHeader } from "@/lib/csrf-client";

export function CreatePurchaseOrderForm() {
  const router = useRouter();
  const [supplierName, setSupplierName] = useState("");
  const [number, setNumber] = useState("");
  const [lineDescription, setLineDescription] = useState("Producto de compra");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("100");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = error ? "purchase-order-error" : undefined;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const parsedQuantity = Number(quantity);
      const parsedUnitPrice = Number(unitPrice);
      if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) throw new Error("La cantidad debe ser mayor que cero.");
      if (!Number.isFinite(parsedUnitPrice) || parsedUnitPrice < 0) throw new Error("El precio unitario no puede ser negativo.");

      const response = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          supplierName,
          number,
          lines: [{ description: lineDescription, quantity: parsedQuantity, unitPrice: parsedUnitPrice }],
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "No se pudo crear el pedido.");
      }
      setSupplierName("");
      setNumber("");
      setLineDescription("Producto de compra");
      setQuantity("1");
      setUnitPrice("100");
      toast.success("Pedido creado correctamente.");
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
        <Label htmlFor="po-supplier-name">Proveedor</Label>
        <Input
          aria-describedby={errorId}
          id="po-supplier-name"
          onChange={(event) => setSupplierName(event.target.value)}
          required
          value={supplierName}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="po-number">Número</Label>
        <Input
          aria-describedby={errorId}
          id="po-number"
          onChange={(event) => setNumber(event.target.value)}
          placeholder="PO-2026-0001"
          required
          value={number}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="po-line-description">Línea</Label>
        <Input
          aria-describedby={errorId}
          id="po-line-description"
          onChange={(event) => setLineDescription(event.target.value)}
          required
          value={lineDescription}
        />
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="po-line-quantity">Cantidad</Label>
          <Input
            aria-describedby={errorId}
            id="po-line-quantity"
            min="0.001"
            onChange={(event) => setQuantity(event.target.value)}
            required
            step="0.001"
            type="number"
            value={quantity}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="po-line-unit-price">Precio unitario</Label>
          <Input
            aria-describedby={errorId}
            id="po-line-unit-price"
            min="0"
            onChange={(event) => setUnitPrice(event.target.value)}
            required
            step="0.01"
            type="number"
            value={unitPrice}
          />
        </div>
      </div>
      <div className="md:col-span-2">
        <Button disabled={isLoading} type="submit">
          {isLoading ? "Guardando..." : "Crear pedido"}
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-red-600 md:col-span-2" id="purchase-order-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

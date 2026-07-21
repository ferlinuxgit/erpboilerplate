"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";

type PurchaseItem = {
  id: string;
  sku: string;
  name: string;
  costPrice: string;
};

type PurchaseLineDraft = {
  id: string;
  itemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

type CreatePurchaseOrderFormProps = {
  currencyCode?: string;
  items?: PurchaseItem[];
  redirectHref?: string;
  suppliers?: Array<{ id: string; name: string }>;
};

function newLine(): PurchaseLineDraft {
  return {
    id: crypto.randomUUID(),
    itemId: "",
    description: "",
    quantity: "1",
    unitPrice: "0",
  };
}

export function CreatePurchaseOrderForm({
  currencyCode = "EUR",
  items = [],
  redirectHref,
  suppliers = [],
}: CreatePurchaseOrderFormProps = {}) {
  const router = useRouter();
  const [supplierName, setSupplierName] = useState("");
  const [number, setNumber] = useState("");
  const [lines, setLines] = useState<PurchaseLineDraft[]>([newLine()]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = error ? "purchase-order-error" : undefined;
  const total = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const lineTotal = Number(line.quantity) * Number(line.unitPrice);
        return sum + (Number.isFinite(lineTotal) ? lineTotal : 0);
      }, 0),
    [lines],
  );

  function updateLine(id: string, patch: Partial<PurchaseLineDraft>) {
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  }

  function selectItem(lineId: string, itemId: string) {
    const selected = items.find((item) => item.id === itemId);
    updateLine(lineId, {
      itemId,
      ...(selected
        ? { description: selected.name, unitPrice: selected.costPrice }
        : {}),
    });
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const parsedLines = lines.map((line) => ({
        description: line.description.trim(),
        itemId: line.itemId || undefined,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
      }));
      if (parsedLines.some((line) => !line.description))
        throw new Error("Todas las líneas necesitan una descripción.");
      if (
        parsedLines.some(
          (line) => !Number.isFinite(line.quantity) || line.quantity <= 0,
        )
      )
        throw new Error("Todas las cantidades deben ser mayores que cero.");
      if (
        parsedLines.some(
          (line) => !Number.isFinite(line.unitPrice) || line.unitPrice < 0,
        )
      )
        throw new Error("Los precios unitarios no pueden ser negativos.");

      const response = await fetch("/api/purchases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCsrfHeader(),
        },
        body: JSON.stringify({
          supplierName,
          number,
          lines: parsedLines,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        id?: string;
        message?: string;
      } | null;
      if (!response.ok || !payload?.id)
        throw new Error(payload?.message ?? "No se pudo crear el pedido.");

      toast.success("Pedido de compra creado.");
      router.push(redirectHref ?? `/purchases/${payload.id}`);
      router.refresh();
    } catch (submissionError) {
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : "Error inesperado.";
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="po-supplier-name">Proveedor</Label>
          <Input
            aria-describedby={errorId}
            autoComplete="organization"
            id="po-supplier-name"
            list="purchase-order-suppliers"
            onChange={(event) => setSupplierName(event.target.value)}
            placeholder="Busca o escribe un nuevo proveedor"
            required
            value={supplierName}
          />
          <datalist id="purchase-order-suppliers">
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.name} />
            ))}
          </datalist>
        </div>
        <div className="space-y-2">
          <Label htmlFor="po-number">Número interno</Label>
          <Input
            aria-describedby="po-number-help"
            id="po-number"
            onChange={(event) => setNumber(event.target.value)}
            placeholder="Asignación automática"
            value={number}
          />
          <p className="text-xs text-muted-foreground" id="po-number-help">
            Déjalo vacío para usar la serie configurada.
          </p>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="purchase-lines-title">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
          <div>
            <h2 className="font-semibold" id="purchase-lines-title">
              Líneas del pedido
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Añade artículos del catálogo o conceptos libres.
            </p>
          </div>
          <Button
            onClick={() => setLines((current) => [...current, newLine()])}
            type="button"
            variant="outline"
          >
            <Plus aria-hidden="true" />
            Añadir línea
          </Button>
        </div>

        <div className="space-y-3">
          {lines.map((line, index) => (
            <fieldset
              className="grid gap-3 rounded-[2px] border bg-muted/15 p-3 lg:grid-cols-[1fr_1.4fr_0.55fr_0.7fr_auto] lg:items-end"
              key={line.id}
            >
              <legend className="sr-only">Línea {index + 1}</legend>
              <div className="space-y-2">
                <Label htmlFor={`po-line-item-${line.id}`}>Artículo</Label>
                <Select
                  id={`po-line-item-${line.id}`}
                  onChange={(event) => selectItem(line.id, event.target.value)}
                  value={line.itemId}
                >
                  <option value="">Concepto libre</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sku} · {item.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`po-line-description-${line.id}`}>
                  Descripción
                </Label>
                <Input
                  aria-describedby={errorId}
                  id={`po-line-description-${line.id}`}
                  onChange={(event) =>
                    updateLine(line.id, { description: event.target.value })
                  }
                  placeholder="Producto o servicio"
                  required
                  value={line.description}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`po-line-quantity-${line.id}`}>Cantidad</Label>
                <Input
                  aria-describedby={errorId}
                  id={`po-line-quantity-${line.id}`}
                  min="0.001"
                  onChange={(event) =>
                    updateLine(line.id, { quantity: event.target.value })
                  }
                  required
                  step="0.001"
                  type="number"
                  value={line.quantity}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`po-line-price-${line.id}`}>Precio</Label>
                <Input
                  aria-describedby={errorId}
                  id={`po-line-price-${line.id}`}
                  min="0"
                  onChange={(event) =>
                    updateLine(line.id, { unitPrice: event.target.value })
                  }
                  required
                  step="0.01"
                  type="number"
                  value={line.unitPrice}
                />
              </div>
              <Button
                aria-label={`Eliminar línea ${index + 1}`}
                disabled={lines.length === 1}
                onClick={() =>
                  setLines((current) =>
                    current.length > 1
                      ? current.filter((candidate) => candidate.id !== line.id)
                      : current,
                  )
                }
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash aria-hidden="true" />
              </Button>
            </fieldset>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Total estimado</p>
          <p className="font-mono text-xl font-semibold">
            {formatMoney(total, currencyCode)}
          </p>
        </div>
        <Button disabled={isLoading} type="submit">
          {isLoading ? "Guardando…" : "Crear pedido de compra"}
        </Button>
      </div>
      {error ? (
        <p
          className="text-sm text-red-600"
          id="purchase-order-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";

type Line = {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
};
const emptyLine = (defaultTaxRate = 0): Line => ({
  description: "",
  quantity: "1",
  unitPrice: "0",
  taxRate: String(defaultTaxRate),
});

export function CreateSalesOrderForm({
  customers,
  defaultTaxRate = 0,
}: {
  customers: Array<{ id: string; name: string }>;
  defaultTaxRate?: number;
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [number, setNumber] = useState("");
  const [issueDate, setIssueDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [lines, setLines] = useState<Line[]>([emptyLine(defaultTaxRate)]);
  const [loading, setLoading] = useState(false);
  const setLine = (index: number, key: keyof Line, value: string) =>
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [key]: value } : line,
      ),
    );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/sales-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          customerId,
          number,
          issueDate,
          lines: lines.map((line) => ({
            description: line.description,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
            taxRate: Number(line.taxRate),
          })),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        id?: string;
        message?: string;
      } | null;
      if (!response.ok || !payload?.id)
        throw new Error(payload?.message ?? "No se pudo crear el pedido.");
      toast.success("Pedido de venta creado.");
      router.push(`/sales/orders/${payload.id}`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo crear el pedido.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1.5 text-sm font-medium">
          Cliente
          <Select
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
          >
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Número
          <Input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="Automático"
          />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Fecha
          <Input
            required
            type="date"
            value={issueDate}
            onChange={(event) => setIssueDate(event.target.value)}
          />
        </label>
      </div>
      <div className="space-y-3 border-t pt-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold">Líneas del pedido</h3>
            <p className="text-sm text-muted-foreground">
              Productos o servicios confirmados por el cliente.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setLines((current) => [...current, emptyLine(defaultTaxRate)])}
          >
            Añadir línea
          </Button>
        </div>
        {lines.map((line, index) => (
          <div
            className="grid gap-3 border-y py-4 md:grid-cols-[minmax(0,1fr)_7rem_9rem_7rem_auto] md:items-end"
            key={index}
          >
            <label className="space-y-1.5 text-sm font-medium">
              Concepto
              <Textarea
                className="min-h-10"
                required
                value={line.description}
                onChange={(event) =>
                  setLine(index, "description", event.target.value)
                }
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Cantidad
              <Input
                min="0.001"
                required
                step="0.001"
                type="number"
                value={line.quantity}
                onChange={(event) =>
                  setLine(index, "quantity", event.target.value)
                }
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Precio
              <Input
                min="0"
                required
                step="0.01"
                type="number"
                value={line.unitPrice}
                onChange={(event) =>
                  setLine(index, "unitPrice", event.target.value)
                }
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              IVA %
              <Input
                min="0"
                required
                step="0.01"
                type="number"
                value={line.taxRate}
                onChange={(event) =>
                  setLine(index, "taxRate", event.target.value)
                }
              />
            </label>
            <Button
              aria-label={`Eliminar línea ${index + 1}`}
              disabled={lines.length === 1}
              type="button"
              variant="ghost"
              onClick={() =>
                setLines((current) =>
                  current.filter((_, lineIndex) => lineIndex !== index),
                )
              }
            >
              Eliminar
            </Button>
          </div>
        ))}
      </div>
      <div className="flex justify-end border-t pt-5">
        <Button disabled={loading || !customerId} type="submit">
          {loading ? "Creando…" : "Crear pedido"}
        </Button>
      </div>
    </form>
  );
}

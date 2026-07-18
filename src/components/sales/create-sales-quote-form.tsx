"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";

type CustomerOption = { id: string; name: string };
type QuoteLine = { description: string; quantity: string; unitPrice: string; taxRate: string };

const emptyLine = (): QuoteLine => ({ description: "", quantity: "1", unitPrice: "0", taxRate: "21" });

function dateInputValue(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function CreateSalesQuoteForm({ customers, initialCustomerId }: { customers: CustomerOption[]; initialCustomerId?: string }) {
  const router = useRouter();
  const initialCustomer = customers.some((customer) => customer.id === initialCustomerId) ? initialCustomerId : customers[0]?.id;
  const [customerId, setCustomerId] = useState(initialCustomer ?? "");
  const [number, setNumber] = useState("");
  const [issueDate, setIssueDate] = useState(dateInputValue());
  const [validUntil, setValidUntil] = useState(dateInputValue(30));
  const [lines, setLines] = useState<QuoteLine[]>([emptyLine()]);
  const [loading, setLoading] = useState(false);

  const updateLine = (index: number, key: keyof QuoteLine, value: string) => {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/sales-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          customerId,
          number,
          issueDate,
          validUntil,
          lines: lines.map((line) => ({
            description: line.description,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
            taxRate: Number(line.taxRate),
          })),
        }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "No se pudo crear el presupuesto.");
      toast.success("Presupuesto creado.");
      router.push("/sales");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="space-y-6" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1.5 text-sm font-medium md:col-span-2">
          Cliente
          <Select disabled={customers.length === 0} onChange={(event) => setCustomerId(event.target.value)} required value={customerId}>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </Select>
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Número
          <Input onChange={(event) => setNumber(event.target.value)} placeholder="Automático" value={number} />
        </label>
        <span className="hidden xl:block" />
        <label className="space-y-1.5 text-sm font-medium">
          Fecha de emisión
          <Input onChange={(event) => setIssueDate(event.target.value)} required type="date" value={issueDate} />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Válido hasta
          <Input onChange={(event) => setValidUntil(event.target.value)} type="date" value={validUntil} />
        </label>
      </div>

      <div className="space-y-3 border-t pt-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold">Líneas del presupuesto</h3>
            <p className="text-sm text-muted-foreground">Describe el servicio o producto y su importe.</p>
          </div>
          <Button onClick={() => setLines((current) => [...current, emptyLine()])} type="button" variant="outline">Añadir línea</Button>
        </div>
        {lines.map((line, index) => (
          <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 md:grid-cols-[minmax(0,1fr)_7rem_9rem_7rem_auto] md:items-end" key={index}>
            <label className="space-y-1.5 text-sm font-medium">
              Concepto
              <Textarea className="min-h-10" onChange={(event) => updateLine(index, "description", event.target.value)} placeholder="Descripción de la línea" required value={line.description} />
            </label>
            <label className="space-y-1.5 text-sm font-medium">Cantidad<Input min="0.001" onChange={(event) => updateLine(index, "quantity", event.target.value)} required step="0.001" type="number" value={line.quantity} /></label>
            <label className="space-y-1.5 text-sm font-medium">Precio unitario<Input min="0" onChange={(event) => updateLine(index, "unitPrice", event.target.value)} required step="0.01" type="number" value={line.unitPrice} /></label>
            <label className="space-y-1.5 text-sm font-medium">IVA %<Input min="0" onChange={(event) => updateLine(index, "taxRate", event.target.value)} required step="0.01" type="number" value={line.taxRate} /></label>
            <Button aria-label={`Eliminar línea ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} type="button" variant="ghost">Eliminar</Button>
          </div>
        ))}
      </div>

      <div className="flex justify-end border-t pt-5">
        <Button disabled={loading || !customerId} type="submit">{loading ? "Creando…" : "Crear presupuesto"}</Button>
      </div>
    </form>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";

import { getCsrfHeader } from "@/lib/csrf-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function MastersPanel() {
  const [loading, setLoading] = useState(false);
  const [categoryCode, setCategoryCode] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [unitName, setUnitName] = useState("");
  const [paymentCode, setPaymentCode] = useState("");
  const [paymentName, setPaymentName] = useState("");
  const [paymentType, setPaymentType] = useState("BANK_TRANSFER");
  const [retentionName, setRetentionName] = useState("");
  const [retentionRate, setRetentionRate] = useState("");

  const baseHeaders = { "Content-Type": "application/json", ...getCsrfHeader() };

  const submit = async (url: string, payload: unknown, reset: () => void) => {
    setLoading(true);
    try {
      const response = await fetch(url, { method: "POST", headers: baseHeaders, body: JSON.stringify(payload) });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "No se pudo guardar.");
      }
      reset();
      toast.success("Guardado correctamente.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2 rounded-md border p-3">
        <p className="font-medium">Categorias de item</p>
        <div className="grid gap-2 md:grid-cols-3">
          <Input placeholder="Codigo" value={categoryCode} onChange={(event) => setCategoryCode(event.target.value)} />
          <Input placeholder="Nombre" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} />
          <Button disabled={loading} onClick={() => submit("/api/item-categories", { code: categoryCode, name: categoryName }, () => { setCategoryCode(""); setCategoryName(""); })} type="button">Crear</Button>
        </div>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <p className="font-medium">Unidades de medida</p>
        <div className="grid gap-2 md:grid-cols-3">
          <Input placeholder="Codigo" value={unitCode} onChange={(event) => setUnitCode(event.target.value)} />
          <Input placeholder="Nombre" value={unitName} onChange={(event) => setUnitName(event.target.value)} />
          <Button disabled={loading} onClick={() => submit("/api/unit-of-measure", { code: unitCode, name: unitName }, () => { setUnitCode(""); setUnitName(""); })} type="button">Crear</Button>
        </div>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <p className="font-medium">Metodos de pago</p>
        <div className="grid gap-2 md:grid-cols-4">
          <Input placeholder="Codigo" value={paymentCode} onChange={(event) => setPaymentCode(event.target.value)} />
          <Input placeholder="Nombre" value={paymentName} onChange={(event) => setPaymentName(event.target.value)} />
          <select className="h-8 rounded-md border px-2 text-sm" value={paymentType} onChange={(event) => setPaymentType(event.target.value)}>
            <option value="BANK_TRANSFER">Transferencia</option>
            <option value="CARD">Tarjeta</option>
            <option value="CASH">Efectivo</option>
            <option value="DIRECT_DEBIT">Domiciliacion</option>
          </select>
          <Button disabled={loading} onClick={() => submit("/api/payment-methods", { code: paymentCode, name: paymentName, type: paymentType }, () => { setPaymentCode(""); setPaymentName(""); setPaymentType("BANK_TRANSFER"); })} type="button">Crear</Button>
        </div>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <p className="font-medium">Retenciones</p>
        <div className="grid gap-2 md:grid-cols-3">
          <Input placeholder="Nombre" value={retentionName} onChange={(event) => setRetentionName(event.target.value)} />
          <Input placeholder="Rate" type="number" step="0.001" value={retentionRate} onChange={(event) => setRetentionRate(event.target.value)} />
          <Button disabled={loading} onClick={() => submit("/api/tax-retentions", { name: retentionName, rate: Number(retentionRate) }, () => { setRetentionName(""); setRetentionRate(""); })} type="button">Crear</Button>
        </div>
      </div>
    </div>
  );
}

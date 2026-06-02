"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getCsrfHeader } from "@/lib/csrf-client";
import { defaultSeriesFormat, previewSeriesFormat } from "@/lib/document-series-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DocumentSeriesRow = {
  id: string;
  type: string;
  prefix: string;
  format: string;
  nextNumber: number;
};

export function MastersPanel() {
  const [loading, setLoading] = useState(false);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [categoryCode, setCategoryCode] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [unitName, setUnitName] = useState("");
  const [paymentCode, setPaymentCode] = useState("");
  const [paymentName, setPaymentName] = useState("");
  const [paymentType, setPaymentType] = useState("BANK_TRANSFER");
  const [retentionName, setRetentionName] = useState("");
  const [retentionRate, setRetentionRate] = useState("");
  const [invoiceSeriesPrefix, setInvoiceSeriesPrefix] = useState("FAC-");
  const [invoiceSeriesFormat, setInvoiceSeriesFormat] = useState(defaultSeriesFormat);
  const [invoiceSeriesNextNumber, setInvoiceSeriesNextNumber] = useState("1");

  const baseHeaders = { "Content-Type": "application/json", ...getCsrfHeader() };
  const invoiceSeriesPreview = previewSeriesFormat(
    invoiceSeriesFormat,
    invoiceSeriesPrefix,
    Number(invoiceSeriesNextNumber) || 1,
  );

  useEffect(() => {
    let ignore = false;

    async function loadSeries() {
      try {
        const response = await fetch("/api/document-series");
        if (!response.ok) return;
        const rows = (await response.json()) as DocumentSeriesRow[];
        const invoiceSeries = rows.find((row) => row.type === "SALES_INVOICE");
        if (!invoiceSeries || ignore) return;
        setInvoiceSeriesPrefix(invoiceSeries.prefix);
        setInvoiceSeriesFormat(invoiceSeries.format ?? defaultSeriesFormat);
        setInvoiceSeriesNextNumber(String(invoiceSeries.nextNumber));
      } catch {
        if (!ignore) toast.error("No se pudo cargar la serie de facturas.");
      } finally {
        if (!ignore) setSeriesLoading(false);
      }
    }

    void loadSeries();
    return () => {
      ignore = true;
    };
  }, []);

  const submit = async (url: string, payload: unknown, reset: () => void, method = "POST") => {
    setLoading(true);
    try {
      const response = await fetch(url, { method, headers: baseHeaders, body: JSON.stringify(payload) });
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
      <div className="space-y-3 rounded-md border p-3">
        <div>
          <p className="font-medium">Numeración de facturas</p>
          <p className="text-sm text-muted-foreground">Define el formato correlativo para las nuevas facturas de venta.</p>
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          <Input
            aria-label="Prefijo factura"
            placeholder="Prefijo"
            value={invoiceSeriesPrefix}
            onChange={(event) => setInvoiceSeriesPrefix(event.target.value)}
          />
          <Input
            aria-label="Formato factura"
            className="md:col-span-2"
            placeholder="{PREFIX}{YYYY}-{NUMBER:6}"
            value={invoiceSeriesFormat}
            onChange={(event) => setInvoiceSeriesFormat(event.target.value)}
          />
          <Input
            aria-label="Siguiente número factura"
            min={1}
            type="number"
            value={invoiceSeriesNextNumber}
            onChange={(event) => setInvoiceSeriesNextNumber(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {["{PREFIX}", "{YYYY}", "{YY}", "{NUMBER:6}", "{NUMBER:4}"].map((token) => (
            <Button
              key={token}
              type="button"
              variant="outline"
              onClick={() => setInvoiceSeriesFormat((current) => `${current}${token}`)}
            >
              {token}
            </Button>
          ))}
        </div>
        <p className="rounded-md bg-muted p-3 text-sm" data-testid="invoice-series-preview">
          Vista previa: <span className="font-medium">{invoiceSeriesPreview}</span>
        </p>
        <Button
          disabled={loading || seriesLoading}
          onClick={() =>
            submit(
              "/api/document-series",
              {
                type: "SALES_INVOICE",
                prefix: invoiceSeriesPrefix,
                format: invoiceSeriesFormat,
                nextNumber: Number(invoiceSeriesNextNumber) || 1,
              },
              () => undefined,
              "PATCH",
            )
          }
          type="button"
        >
          Guardar numeración
        </Button>
      </div>

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

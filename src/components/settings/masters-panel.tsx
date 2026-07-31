"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getCsrfHeader } from "@/lib/csrf-client";
import { defaultSeriesFormat, previewSeriesFormat } from "@/lib/document-series-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type DocumentSeriesRow = {
  id: string;
  type: string;
  prefix: string;
  format: string;
  nextNumber: number;
};

type CodeNameRow = { id: string; code: string; name: string };
type PaymentMethodRow = CodeNameRow & { type: string; bankAccountNumber: string | null };
type TaxKind = "VAT" | "SURCHARGE" | "WITHHOLDING" | "OTHER";
type TaxRow = {
  id: string;
  name: string;
  rate: string;
  kind: TaxKind;
  operation: "ADD" | "SUBTRACT";
  isDefault: boolean;
  isActive: boolean;
};

const taxKindOptions: Array<{ value: TaxKind; label: string }> = [
  { value: "VAT", label: "IVA" },
  { value: "SURCHARGE", label: "Recargo de equivalencia" },
  { value: "WITHHOLDING", label: "Retención / IRPF" },
  { value: "OTHER", label: "Otro impuesto" },
];

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
  const [paymentBankAccountNumber, setPaymentBankAccountNumber] = useState("");
  const [taxName, setTaxName] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [taxKind, setTaxKind] = useState<TaxKind>("VAT");
  const [taxIsDefault, setTaxIsDefault] = useState(false);
  const [categories, setCategories] = useState<CodeNameRow[]>([]);
  const [units, setUnits] = useState<CodeNameRow[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRow[]>([]);
  const [taxes, setTaxes] = useState<TaxRow[]>([]);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [invoiceSeriesPrefix, setInvoiceSeriesPrefix] = useState("FA");
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

  useEffect(() => {
    let ignore = false;
    async function loadCatalogs() {
      const endpoints = ["/api/item-categories", "/api/unit-of-measure", "/api/payment-methods", "/api/taxes?includeInactive=true"];
      const responses = await Promise.all(endpoints.map((endpoint) => fetch(endpoint)));
      if (ignore) return;
      const payloads = await Promise.all(responses.map((response) => response.ok ? response.json() : []));
      if (ignore) return;
      setCategories(payloads[0] as CodeNameRow[]);
      setUnits(payloads[1] as CodeNameRow[]);
      setPaymentMethods(payloads[2] as PaymentMethodRow[]);
      setTaxes(payloads[3] as TaxRow[]);
    }
    void loadCatalogs().catch(() => { if (!ignore) toast.error("No se pudieron cargar todos los catálogos."); });
    return () => { ignore = true; };
  }, [catalogVersion]);

  const submit = async (url: string, payload: unknown, reset: () => void, method = "POST") => {
    setLoading(true);
    try {
      const response = await fetch(url, { method, headers: baseHeaders, body: JSON.stringify(payload) });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "No se pudo guardar.");
      }
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      reset();
      setCatalogVersion((current) => current + 1);
      toast.success(body?.message ?? "Guardado correctamente.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
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
        <p className="font-medium">Categorías de artículos</p>
        <div className="grid gap-2 md:grid-cols-3">
          <Input aria-label="Código de categoría" placeholder="Código" value={categoryCode} onChange={(event) => setCategoryCode(event.target.value)} />
          <Input aria-label="Nombre de categoría" placeholder="Nombre" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} />
          <Button disabled={loading} onClick={() => submit("/api/item-categories", { code: categoryCode, name: categoryName }, () => { setCategoryCode(""); setCategoryName(""); })} type="button">Crear</Button>
        </div>
        <div className="divide-y rounded-md bg-muted/25 px-3">
          {categories.map((row) => <p className="flex justify-between gap-3 py-2 text-sm" key={row.id}><span>{row.name}</span><span className="font-mono text-muted-foreground">{row.code}</span></p>)}
          {categories.length === 0 ? <p className="py-2 text-sm text-muted-foreground">Sin categorías configuradas.</p> : null}
        </div>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <p className="font-medium">Unidades de medida</p>
        <div className="grid gap-2 md:grid-cols-3">
          <Input aria-label="Código de unidad" placeholder="Código" value={unitCode} onChange={(event) => setUnitCode(event.target.value)} />
          <Input aria-label="Nombre de unidad" placeholder="Nombre" value={unitName} onChange={(event) => setUnitName(event.target.value)} />
          <Button disabled={loading} onClick={() => submit("/api/unit-of-measure", { code: unitCode, name: unitName }, () => { setUnitCode(""); setUnitName(""); })} type="button">Crear</Button>
        </div>
        <div className="divide-y rounded-md bg-muted/25 px-3">
          {units.map((row) => <p className="flex justify-between gap-3 py-2 text-sm" key={row.id}><span>{row.name}</span><span className="font-mono text-muted-foreground">{row.code}</span></p>)}
          {units.length === 0 ? <p className="py-2 text-sm text-muted-foreground">Sin unidades configuradas.</p> : null}
        </div>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <p className="font-medium">Métodos de pago</p>
        <div className="grid gap-2 md:grid-cols-5">
          <Input aria-label="Código del método de pago" placeholder="Código" value={paymentCode} onChange={(event) => setPaymentCode(event.target.value)} />
          <Input aria-label="Nombre del método de pago" placeholder="Nombre" value={paymentName} onChange={(event) => setPaymentName(event.target.value)} />
          <Select aria-label="Tipo de método de pago" value={paymentType} onChange={(event) => setPaymentType(event.target.value)}>
            <option value="BANK_TRANSFER">Transferencia</option>
            <option value="CARD">Tarjeta</option>
            <option value="CASH">Efectivo</option>
            <option value="DIRECT_DEBIT">Domiciliación</option>
          </Select>
          {paymentType === "BANK_TRANSFER" ? (
            <Input
              aria-label="Número de cuenta"
              placeholder="Número de cuenta"
              value={paymentBankAccountNumber}
              onChange={(event) => setPaymentBankAccountNumber(event.target.value)}
            />
          ) : null}
          <Button
            className={paymentType === "BANK_TRANSFER" ? undefined : "md:col-start-4"}
            disabled={loading}
            onClick={() =>
              submit(
                "/api/payment-methods",
                {
                  code: paymentCode,
                  name: paymentName,
                  type: paymentType,
                  bankAccountNumber: paymentType === "BANK_TRANSFER" ? paymentBankAccountNumber : null,
                },
                () => {
                  setPaymentCode("");
                  setPaymentName("");
                  setPaymentType("BANK_TRANSFER");
                  setPaymentBankAccountNumber("");
                },
              )
            }
            type="button"
          >
            Crear
          </Button>
        </div>
        <div className="divide-y rounded-md bg-muted/25 px-3">
          {paymentMethods.map((row) => <p className="flex flex-wrap justify-between gap-3 py-2 text-sm" key={row.id}><span>{row.name} <span className="text-muted-foreground">· {row.type}</span></span><span className="font-mono text-muted-foreground">{row.code}</span></p>)}
          {paymentMethods.length === 0 ? <p className="py-2 text-sm text-muted-foreground">Sin métodos de pago configurados.</p> : null}
        </div>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <div>
          <p className="font-medium">Impuestos y retenciones</p>
          <p className="text-sm text-muted-foreground">
            Puedes marcar varios valores por defecto. El IVA y los recargos suman; las retenciones e IRPF restan del total a cobrar.
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-12">
          <Input className="md:col-span-2" aria-label="Nombre del impuesto" placeholder="Nombre" value={taxName} onChange={(event) => setTaxName(event.target.value)} />
          <Input className="md:col-span-2" aria-label="Porcentaje del impuesto" placeholder="Porcentaje" type="number" min="0" max="100" step="0.001" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} />
          <Select className="md:col-span-3" aria-label="Tipo de impuesto" value={taxKind} onChange={(event) => setTaxKind(event.target.value as TaxKind)}>
            {taxKindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          <label className="flex items-center gap-2 rounded-md border px-3 text-sm md:col-span-3">
            <input checked={taxIsDefault} type="checkbox" onChange={(event) => setTaxIsDefault(event.target.checked)} />
            Seleccionar por defecto
          </label>
          <Button
            className="md:col-span-2"
            disabled={loading}
            onClick={() => submit(
              "/api/taxes",
              { name: taxName, rate: Number(taxRate), kind: taxKind, isDefault: taxIsDefault },
              () => { setTaxName(""); setTaxRate(""); setTaxKind("VAT"); setTaxIsDefault(false); },
            )}
            type="button"
          >
            Crear
          </Button>
        </div>
        <div className="divide-y rounded-md bg-muted/25 px-3">
          {taxes.map((row) => (
            <div className={`grid gap-2 py-3 md:grid-cols-12 ${row.isActive ? "" : "opacity-60"}`} key={row.id}>
              <Input
                className="md:col-span-3"
                aria-label={`Nombre ${row.name}`}
                value={row.name}
                onChange={(event) => setTaxes((current) => current.map((item) => item.id === row.id ? { ...item, name: event.target.value } : item))}
              />
              <Input
                className="md:col-span-2"
                aria-label={`Porcentaje ${row.name}`}
                min="0"
                max="100"
                step="0.001"
                type="number"
                value={row.rate}
                onChange={(event) => setTaxes((current) => current.map((item) => item.id === row.id ? { ...item, rate: event.target.value } : item))}
              />
              <Select
                className="md:col-span-3"
                aria-label={`Tipo ${row.name}`}
                value={row.kind}
                onChange={(event) => setTaxes((current) => current.map((item) => item.id === row.id ? { ...item, kind: event.target.value as TaxKind } : item))}
              >
                {taxKindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input
                  checked={row.isDefault}
                  disabled={!row.isActive}
                  type="checkbox"
                  onChange={(event) => setTaxes((current) => current.map((item) => item.id === row.id ? { ...item, isDefault: event.target.checked } : item))}
                />
                Por defecto
              </label>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <Button
                  disabled={loading}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => submit(
                    `/api/taxes/${row.id}`,
                    { name: row.name, rate: Number(row.rate), kind: row.kind, isDefault: row.isDefault, isActive: row.isActive },
                    () => undefined,
                    "PATCH",
                  )}
                >
                  Guardar
                </Button>
                {row.isActive ? (
                  <Button
                    disabled={loading}
                    size="sm"
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      if (!window.confirm(`¿Eliminar ${row.name}? Si ya se usó en facturas se archivará para conservar el histórico.`)) return;
                      void submit(`/api/taxes/${row.id}`, {}, () => undefined, "DELETE");
                    }}
                  >
                    Eliminar
                  </Button>
                ) : (
                  <Button
                    disabled={loading}
                    size="sm"
                    type="button"
                    variant="ghost"
                    onClick={() => submit(`/api/taxes/${row.id}`, { isActive: true }, () => undefined, "PATCH")}
                  >
                    Restaurar
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground md:col-span-12">
                {row.isActive ? "Activo" : "Archivado"} · {row.operation === "SUBTRACT" || row.kind === "WITHHOLDING" ? "Resta del total" : "Suma al total"}
              </p>
            </div>
          ))}
          {taxes.length === 0 ? <p className="py-2 text-sm text-muted-foreground">Sin impuestos configurados.</p> : null}
        </div>
      </div>
    </div>
  );
}

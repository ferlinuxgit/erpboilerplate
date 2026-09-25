"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getCsrfHeader } from "@/lib/csrf-client";
import { parseDecimalInput } from "@/lib/format";
import { DocumentSeriesPanel } from "@/components/settings/document-series-panel";
import { PaymentMethodsPanel } from "@/components/settings/payment-methods-panel";
import { Button } from "@/components/ui/button";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PercentInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type CodeNameRow = { id: string; code: string; name: string };
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
type FieldErrors = Record<string, string | undefined>;

const taxKindOptions: Array<{ value: TaxKind; label: string }> = [
  { value: "VAT", label: "IVA" },
  { value: "SURCHARGE", label: "Recargo de equivalencia" },
  { value: "WITHHOLDING", label: "Retención / IRPF" },
  { value: "OTHER", label: "Otro impuesto" },
];

const panelClass = "space-y-2 border border-window-dark-shadow bg-window-panel p-2.5 shadow-[inset_1px_1px_0_var(--window-highlight)]";
const listClass = "divide-y divide-window-shadow border border-window-shadow bg-card px-2.5";

/** Percent fields keep the Spanish decimal comma so "21.000" from the API is never read as 21 000. */
function toPercentDraft(value: string | number) {
  return String(value).trim().replace(".", ",");
}

function parsePercent(raw: string) {
  return parseDecimalInput(raw, { maximumFractionDigits: 2 });
}

function percentError(raw: string) {
  const rate = parsePercent(raw);
  if (!raw.trim()) return "Indica el porcentaje (por ejemplo, 21).";
  if (rate === null) return "Introduce un número válido, por ejemplo 21 o 5,2.";
  if (rate < 0 || rate > 100) return "El porcentaje debe estar entre 0 y 100.";
  return undefined;
}

function hasErrors(errors: FieldErrors) {
  return Object.values(errors).some(Boolean);
}

export function MastersPanel() {
  const [pending, setPending] = useState<string | null>(null);
  const [categoryCode, setCategoryCode] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [unitName, setUnitName] = useState("");
  const [taxName, setTaxName] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [taxKind, setTaxKind] = useState<TaxKind>("VAT");
  const [taxIsDefault, setTaxIsDefault] = useState(false);
  const [categories, setCategories] = useState<CodeNameRow[]>([]);
  const [units, setUnits] = useState<CodeNameRow[]>([]);
  const [taxes, setTaxes] = useState<TaxRow[]>([]);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, FieldErrors>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string | null>>({});
  const [taxToDelete, setTaxToDelete] = useState<TaxRow | null>(null);
  const loading = pending !== null;

  useEffect(() => {
    let ignore = false;
    async function loadCatalogs() {
      const endpoints = ["/api/item-categories", "/api/unit-of-measure", "/api/taxes?includeInactive=true"];
      const responses = await Promise.all(endpoints.map((endpoint) => fetch(endpoint)));
      if (ignore) return;
      const payloads = await Promise.all(responses.map((response) => response.ok ? response.json() : []));
      if (ignore) return;
      setCategories(payloads[0] as CodeNameRow[]);
      setUnits(payloads[1] as CodeNameRow[]);
      setTaxes((payloads[2] as TaxRow[]).map((row) => ({ ...row, rate: toPercentDraft(row.rate) })));
    }
    void loadCatalogs().catch(() => { if (!ignore) toast.error("No se pudieron cargar todos los catálogos. Recarga la página para intentarlo de nuevo."); });
    return () => { ignore = true; };
  }, [catalogVersion]);

  const setErrorsFor = (key: string, errors: FieldErrors) => setFieldErrors((current) => ({ ...current, [key]: errors }));
  const setFormError = (key: string, message: string | null) => setFormErrors((current) => ({ ...current, [key]: message }));

  const submit = async ({
    fallback,
    formKey,
    method = "POST",
    payload,
    reset,
    success,
    url,
  }: {
    fallback: string;
    formKey: string;
    method?: string;
    payload: unknown;
    reset: () => void;
    success: string;
    url: string;
  }) => {
    setPending(formKey);
    setFormError(formKey, null);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(await readApiError(response, fallback));
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      reset();
      setCatalogVersion((current) => current + 1);
      toast.success(body?.message ?? success);
      return true;
    } catch (error) {
      const message = errorMessage(error, fallback);
      setFormError(formKey, message);
      toast.error(message);
      return false;
    } finally {
      setPending(null);
    }
  };

  const rejectInvalid = (key: string, errors: FieldErrors) => {
    setErrorsFor(key, errors);
    if (!hasErrors(errors)) return false;
    toast.error("Revisa los campos marcados antes de guardar.");
    return true;
  };

  const createCodeName = (event: React.FormEvent<HTMLFormElement>, kind: "category" | "unit") => {
    event.preventDefault();
    const code = kind === "category" ? categoryCode : unitCode;
    const name = kind === "category" ? categoryName : unitName;
    const errors: FieldErrors = {
      code: code.trim() ? undefined : "Indica un código corto.",
      name: name.trim() ? undefined : "Indica el nombre.",
    };
    if (rejectInvalid(kind, errors)) return;
    void submit({
      fallback: kind === "category" ? "No se pudo crear la categoría." : "No se pudo crear la unidad de medida.",
      formKey: kind,
      payload: { code, name },
      reset: () => {
        if (kind === "category") { setCategoryCode(""); setCategoryName(""); }
        else { setUnitCode(""); setUnitName(""); }
      },
      success: kind === "category" ? `Categoría «${name.trim()}» creada.` : `Unidad «${name.trim()}» creada.`,
      url: kind === "category" ? "/api/item-categories" : "/api/unit-of-measure",
    });
  };

  const createTax = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: FieldErrors = {
      name: taxName.trim() ? undefined : "Indica el nombre del impuesto (por ejemplo, IVA general).",
      rate: percentError(taxRate),
    };
    if (rejectInvalid("tax-new", errors)) return;
    void submit({
      fallback: "No se pudo crear el impuesto.",
      formKey: "tax-new",
      payload: { name: taxName, rate: parsePercent(taxRate), kind: taxKind, isDefault: taxIsDefault },
      reset: () => { setTaxName(""); setTaxRate(""); setTaxKind("VAT"); setTaxIsDefault(false); },
      success: `Impuesto «${taxName.trim()}» creado.`,
      url: "/api/taxes",
    });
  };

  const saveTax = (event: React.FormEvent<HTMLFormElement>, row: TaxRow) => {
    event.preventDefault();
    const key = `tax-${row.id}`;
    const errors: FieldErrors = {
      name: row.name.trim() ? undefined : "Indica el nombre del impuesto.",
      rate: percentError(row.rate),
    };
    if (rejectInvalid(key, errors)) return;
    void submit({
      fallback: "No se pudo actualizar el impuesto.",
      formKey: key,
      method: "PATCH",
      payload: { name: row.name, rate: parsePercent(row.rate), kind: row.kind, isDefault: row.isDefault, isActive: row.isActive },
      reset: () => undefined,
      success: `Impuesto «${row.name.trim()}» actualizado.`,
      url: `/api/taxes/${row.id}`,
    });
  };

  const updateTax = (id: string, patch: Partial<TaxRow>) => setTaxes((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));

  return (
    <div className="space-y-3">
      <DocumentSeriesPanel />

      {(["category", "unit"] as const).map((kind) => {
        const isCategory = kind === "category";
        const rows = isCategory ? categories : units;
        const errors = fieldErrors[kind] ?? {};
        return (
          <section aria-labelledby={`masters-${kind}-title`} className={panelClass} key={kind}>
            <h3 className="font-mono text-sm font-bold" id={`masters-${kind}-title`}>{isCategory ? "Categorías de artículos" : "Unidades de medida"}</h3>
            <form className="grid gap-2 md:grid-cols-[1fr_2fr_auto] md:items-start" noValidate onSubmit={(event) => createCodeName(event, kind)}>
              <AccessibleField error={errors.code} id={`masters-${kind}-code`} label="Código" required>
                <Input
                  id={`masters-${kind}-code`}
                  aria-label={isCategory ? "Código de categoría" : "Código de unidad"}
                  className="font-mono"
                  placeholder={isCategory ? "SERV" : "UD"}
                  value={isCategory ? categoryCode : unitCode}
                  onChange={(event) => (isCategory ? setCategoryCode : setUnitCode)(event.target.value)}
                />
              </AccessibleField>
              <AccessibleField error={errors.name} id={`masters-${kind}-name`} label="Nombre" required>
                <Input
                  id={`masters-${kind}-name`}
                  aria-label={isCategory ? "Nombre de categoría" : "Nombre de unidad"}
                  placeholder={isCategory ? "Servicios" : "Unidades"}
                  value={isCategory ? categoryName : unitName}
                  onChange={(event) => (isCategory ? setCategoryName : setUnitName)(event.target.value)}
                />
              </AccessibleField>
              <SubmitButton className="md:mt-5" disabled={loading} pending={pending === kind}>Crear</SubmitButton>
              <FormErrorMessage className="md:col-span-3">{formErrors[kind]}</FormErrorMessage>
            </form>
            <div className={listClass}>
              {rows.map((row) => <p className="flex justify-between gap-3 py-1.5 text-xs" key={row.id}><span>{row.name}</span><span className="font-mono text-muted-foreground">{row.code}</span></p>)}
              {rows.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">
                  {isCategory ? "Sin categorías configuradas. Crea la primera con el formulario de arriba." : "Sin unidades configuradas. Crea la primera con el formulario de arriba."}
                </p>
              ) : null}
            </div>
          </section>
        );
      })}

      <div className={panelClass}>
        <PaymentMethodsPanel />
      </div>

      <section aria-labelledby="masters-taxes-title" className={panelClass}>
        <div className="space-y-0.5">
          <h3 className="font-mono text-sm font-bold" id="masters-taxes-title">Impuestos y retenciones</h3>
          <p className="text-xs text-muted-foreground">
            Puedes marcar varios valores por defecto. El IVA y los recargos suman; las retenciones e IRPF restan del total a cobrar.
          </p>
        </div>
        <form className="grid gap-2 md:grid-cols-12 md:items-start" noValidate onSubmit={createTax}>
          <AccessibleField className="md:col-span-3" error={fieldErrors["tax-new"]?.name} id="masters-tax-new-name" label="Nombre" required>
            <Input id="masters-tax-new-name" aria-label="Nombre del impuesto" placeholder="IVA general" value={taxName} onChange={(event) => setTaxName(event.target.value)} />
          </AccessibleField>
          <AccessibleField className="md:col-span-2" error={fieldErrors["tax-new"]?.rate} id="masters-tax-new-rate" label="Porcentaje" required>
            <PercentInput id="masters-tax-new-rate" aria-label="Porcentaje del impuesto" placeholder="21" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} />
          </AccessibleField>
          <AccessibleField className="md:col-span-3" helperText="Las retenciones restan del total." id="masters-tax-new-kind" label="Tipo" required>
            <Select id="masters-tax-new-kind" aria-label="Tipo de impuesto" value={taxKind} onChange={(event) => setTaxKind(event.target.value as TaxKind)}>
              {taxKindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </AccessibleField>
          <label className="flex items-center gap-2 font-mono text-xs font-bold md:col-span-2 md:mt-6" htmlFor="masters-tax-new-default">
            <input checked={taxIsDefault} id="masters-tax-new-default" type="checkbox" onChange={(event) => setTaxIsDefault(event.target.checked)} />
            Seleccionar por defecto
          </label>
          <SubmitButton className="md:col-span-2 md:mt-5" disabled={loading} pending={pending === "tax-new"}>
            Crear
          </SubmitButton>
          <FormErrorMessage className="md:col-span-12">{formErrors["tax-new"]}</FormErrorMessage>
        </form>
        <div className={listClass}>
          {taxes.map((row) => {
            const key = `tax-${row.id}`;
            const errors = fieldErrors[key] ?? {};
            return (
              <form className={cn("grid gap-2 py-2.5 md:grid-cols-12 md:items-start", !row.isActive && "opacity-60")} key={row.id} noValidate onSubmit={(event) => saveTax(event, row)}>
                <AccessibleField className="md:col-span-3" error={errors.name} hideLabel id={`masters-${key}-name`} label="Nombre">
                  <Input id={`masters-${key}-name`} aria-label={`Nombre ${row.name}`} value={row.name} onChange={(event) => updateTax(row.id, { name: event.target.value })} />
                </AccessibleField>
                <AccessibleField className="md:col-span-2" error={errors.rate} hideLabel id={`masters-${key}-rate`} label="Porcentaje">
                  <PercentInput id={`masters-${key}-rate`} aria-label={`Porcentaje ${row.name}`} value={row.rate} onChange={(event) => updateTax(row.id, { rate: event.target.value })} />
                </AccessibleField>
                <AccessibleField className="md:col-span-3" hideLabel id={`masters-${key}-kind`} label="Tipo">
                  <Select id={`masters-${key}-kind`} aria-label={`Tipo ${row.name}`} value={row.kind} onChange={(event) => updateTax(row.id, { kind: event.target.value as TaxKind })}>
                    {taxKindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                </AccessibleField>
                <label className="flex h-8 items-center gap-2 font-mono text-xs font-bold md:col-span-2" htmlFor={`masters-${key}-default`}>
                  <input checked={row.isDefault} disabled={!row.isActive} id={`masters-${key}-default`} type="checkbox" onChange={(event) => updateTax(row.id, { isDefault: event.target.checked })} />
                  Por defecto<span className="sr-only"> {row.name}</span>
                </label>
                <div className="flex flex-wrap gap-2 md:col-span-2">
                  <SubmitButton disabled={loading} pending={pending === key} size="sm" variant="outline">
                    Guardar
                  </SubmitButton>
                  {row.isActive ? (
                    <Button disabled={loading} size="sm" type="button" variant="ghost" onClick={() => { setFormError("tax-delete", null); setTaxToDelete(row); }}>
                      Eliminar
                    </Button>
                  ) : (
                    <Button
                      disabled={loading}
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => void submit({
                        fallback: "No se pudo restaurar el impuesto.",
                        formKey: key,
                        method: "PATCH",
                        payload: { isActive: true },
                        reset: () => undefined,
                        success: `Impuesto «${row.name}» restaurado.`,
                        url: `/api/taxes/${row.id}`,
                      })}
                    >
                      Restaurar
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground md:col-span-12">
                  {row.isActive ? "Activo" : "Archivado"} · {row.operation === "SUBTRACT" || row.kind === "WITHHOLDING" ? "Resta del total" : "Suma al total"}
                </p>
                <FormErrorMessage className="md:col-span-12">{formErrors[key]}</FormErrorMessage>
              </form>
            );
          })}
          {taxes.length === 0 ? <p className="py-2 text-xs text-muted-foreground">Sin impuestos configurados. Crea el primero (por ejemplo, IVA general 21 %) con el formulario de arriba.</p> : null}
        </div>
      </section>

      <DestructiveActionDialog
        confirmLabel="Eliminar impuesto"
        description={taxToDelete ? `¿Eliminar ${taxToDelete.name}? Si ya se usó en facturas se archivará para conservar el histórico.` : ""}
        errorMessage={formErrors["tax-delete"]}
        isSubmitting={pending === "tax-delete"}
        onCancel={() => setTaxToDelete(null)}
        onConfirm={async () => {
          if (!taxToDelete) return;
          const ok = await submit({
            fallback: "No se pudo eliminar el impuesto.",
            formKey: "tax-delete",
            method: "DELETE",
            payload: {},
            reset: () => undefined,
            success: `Impuesto «${taxToDelete.name}» eliminado.`,
            url: `/api/taxes/${taxToDelete.id}`,
          });
          if (ok) setTaxToDelete(null);
        }}
        open={taxToDelete !== null}
        title="Eliminar impuesto"
      />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getCsrfHeader } from "@/lib/csrf-client";
import { DocumentSeriesPanel } from "@/components/settings/document-series-panel";
import { PaymentMethodsPanel } from "@/components/settings/payment-methods-panel";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

type CodeNameRow = { id: string; code: string; name: string };
type FieldErrors = Record<string, string | undefined>;

const panelClass = "space-y-2 border border-window-dark-shadow bg-window-panel p-2.5 shadow-bevel-top";
const listClass = "divide-y divide-window-shadow border border-window-shadow bg-card px-2.5";

function hasErrors(errors: FieldErrors) {
  return Object.values(errors).some(Boolean);
}

export type MastersBlock = "series" | "category" | "unit" | "paymentMethods";

/** Catálogos base; cada sección de Configuración muestra solo los bloques que le corresponden. */
export function MastersPanel({ blocks }: { blocks: MastersBlock[] }) {
  const shows = (block: MastersBlock) => blocks.includes(block);
  const loadsCategories = shows("category");
  const loadsUnits = shows("unit");
  const [pending, setPending] = useState<string | null>(null);
  const [categoryCode, setCategoryCode] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [unitName, setUnitName] = useState("");
  const [categories, setCategories] = useState<CodeNameRow[]>([]);
  const [units, setUnits] = useState<CodeNameRow[]>([]);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, FieldErrors>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string | null>>({});
  const loading = pending !== null;

  useEffect(() => {
    let ignore = false;
    async function loadCatalogs() {
      const load = async <T,>(enabled: boolean, endpoint: string): Promise<T[]> => {
        if (!enabled) return [];
        const response = await fetch(endpoint);
        return response.ok ? ((await response.json()) as T[]) : [];
      };
      const [categoryRows, unitRows] = await Promise.all([
        load<CodeNameRow>(loadsCategories, "/api/item-categories"),
        load<CodeNameRow>(loadsUnits, "/api/unit-of-measure"),
      ]);
      if (ignore) return;
      setCategories(categoryRows);
      setUnits(unitRows);
    }
    void loadCatalogs().catch(() => { if (!ignore) toast.error("No se pudieron cargar todos los catálogos. Recarga la página para intentarlo de nuevo."); });
    return () => { ignore = true; };
  }, [catalogVersion, loadsCategories, loadsUnits]);

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

  return (
    <div className="space-y-3">
      {shows("series") ? <DocumentSeriesPanel /> : null}

      {(["category", "unit"] as const).filter(shows).map((kind) => {
        const isCategory = kind === "category";
        const rows = isCategory ? categories : units;
        const errors = fieldErrors[kind] ?? {};
        return (
          <section aria-label={isCategory ? "Categorías de artículos" : "Unidades de medida"} className={panelClass} key={kind}>
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

      {shows("paymentMethods") ? (
        <div className={panelClass}>
          <PaymentMethodsPanel />
        </div>
      ) : null}
    </div>
  );
}

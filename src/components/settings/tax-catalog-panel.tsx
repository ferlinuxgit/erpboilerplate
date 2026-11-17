"use client";

import { Plus } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PercentInput } from "@/components/ui/number-input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatPercent, parseDecimalInput } from "@/lib/format";
import { cn } from "@/lib/utils";

type CatalogEntry = {
  code: string;
  name: string;
  rate: number;
  kind: "VAT" | "SURCHARGE" | "WITHHOLDING" | "OTHER";
  operation: "ADD" | "SUBTRACT";
  description: string | null;
  inUse: boolean;
  companyName: string | null;
  isDefault: boolean;
  taxId: string | null;
};
type CustomTax = { id: string; name: string; rate: number; kind: string; operation: string; isActive: boolean; isDefault: boolean };
type Catalog = { territory: string; entries: CatalogEntry[]; custom: CustomTax[] };

async function sendJson(url: string, method: "PATCH" | "POST", body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "No se pudo guardar el cambio.");
  return payload;
}

/**
 * Impuestos y retenciones como catálogo: los oficiales del territorio de la empresa, cada uno con
 * «Lo uso». Solo los marcados aparecen en facturas, presupuestos y gastos. Un impuesto que no está
 * en el catálogo se añade aparte («Impuestos propios»).
 */
export function TaxCatalogPanel({ taxLabel }: { taxLabel: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/taxes/catalog");
      if (!response.ok) throw new Error();
      setCatalog((await response.json()) as Catalog);
      setLoadError(null);
    } catch {
      setLoadError("No se pudo cargar el catálogo de impuestos.");
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    void fetch("/api/taxes/catalog")
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = (await response.json()) as Catalog;
        if (!ignore) setCatalog(data);
      })
      .catch(() => {
        if (!ignore) setLoadError("No se pudo cargar el catálogo de impuestos.");
      });
    return () => {
      ignore = true;
    };
  }, []);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(success);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el cambio.");
      await load();
    } finally {
      setBusy(null);
    }
  };

  // La casilla cambia al momento; si el servidor no lo guarda, se recarga el estado real.
  const toggle = (entry: CatalogEntry, inUse: boolean) => {
    setCatalog((current) => current && { ...current, entries: current.entries.map((item) => (item.code === entry.code ? { ...item, inUse } : item)) });
    return run(entry.code, () => sendJson("/api/taxes/catalog", "PATCH", { code: entry.code, inUse }), inUse ? `«${entry.name}» activado: ya aparece al facturar.` : `«${entry.name}» desactivado: deja de aparecer al facturar.`);
  };

  // Un único tipo propuesto en las líneas nuevas: se marca el elegido y se desmarcan los demás.
  const makeDefault = (entry: CatalogEntry) =>
    run(`${entry.code}-default`, async () => {
      for (const other of catalog?.entries ?? []) {
        if (other.kind === "VAT" && other.isDefault && other.taxId && other.code !== entry.code) await sendJson(`/api/taxes/${other.taxId}`, "PATCH", { isDefault: false });
      }
      if (entry.taxId) await sendJson(`/api/taxes/${entry.taxId}`, "PATCH", { isDefault: true });
    }, `«${entry.name}» se propondrá en las líneas nuevas.`);

  if (loadError) return <InlineAlert role="alert" tone="danger">{loadError}</InlineAlert>;
  if (!catalog) return <p className="text-sm text-muted-foreground">Cargando catálogo…</p>;

  const groups = [
    { key: "VAT", title: taxLabel, hint: "Se suma a la factura. Marca los tipos que aplicas; el «propuesto» sale en cada línea nueva." },
    { key: "SURCHARGE", title: "Recargo de equivalencia", hint: "Solo si vendes a comercios minoristas acogidos al recargo." },
    { key: "WITHHOLDING", title: "Retenciones (IRPF)", hint: "Se restan del total a cobrar." },
    { key: "OTHER", title: "Otros impuestos", hint: "" },
  ] as const;

  return (
    <div className="space-y-4" data-testid="tax-catalog">
      <p className="text-xs text-muted-foreground">
        Catálogo oficial de tu territorio. Marca «Lo uso» en los que aplicas: solo esos aparecen al hacer facturas, presupuestos y gastos.
        Desmarcar uno no cambia las facturas que ya lo llevan.
      </p>
      {groups.map((group) => {
        const entries = catalog.entries.filter((entry) => entry.kind === group.key);
        if (entries.length === 0) return null;
        return (
          <section aria-labelledby={`tax-catalog-${group.key}`} className="space-y-1.5" key={group.key}>
            <div>
              <h3 className="font-mono text-xs font-bold uppercase tracking-[0.04em]" id={`tax-catalog-${group.key}`}>{group.title}</h3>
              {group.hint ? <p className="text-xs text-muted-foreground">{group.hint}</p> : null}
            </div>
            <ul className="divide-y divide-window-shadow rounded-surface border border-window-dark-shadow">
              {entries.map((entry) => (
                <li className={cn("flex flex-wrap items-start gap-x-3 gap-y-1 p-2.5", !entry.inUse && "bg-window-panel/40")} key={entry.code}>
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                    <input
                      checked={entry.inUse}
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                      disabled={busy !== null}
                      onChange={(event) => void toggle(entry, event.target.checked)}
                      type="checkbox"
                    />
                    <span className="min-w-0">
                      <span className="block font-mono text-sm font-bold">
                        {entry.name}
                        <span className="ml-1 font-normal text-muted-foreground">{entry.operation === "SUBTRACT" ? "−" : "+"}{formatPercent(entry.rate)}</span>
                        <span className="sr-only">{entry.inUse ? " (lo uso)" : " (no lo uso)"}</span>
                      </span>
                      {entry.description ? <span className="block text-xs text-muted-foreground">{entry.description}</span> : null}
                      {entry.companyName ? <span className="block text-xs text-muted-foreground">En tu empresa se llama «{entry.companyName}».</span> : null}
                    </span>
                  </label>
                  {entry.kind === "VAT" && entry.inUse ? (
                    entry.isDefault ? (
                      <span className="rounded-control border border-primary px-1.5 py-0.5 font-mono text-xs font-bold">Propuesto</span>
                    ) : (
                      <Button disabled={busy !== null} onClick={() => void makeDefault(entry)} size="sm" type="button" variant="ghost">
                        Proponer en líneas nuevas<span className="sr-only"> {entry.name}</span>
                      </Button>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section aria-labelledby="tax-catalog-custom" className="space-y-1.5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-mono text-xs font-bold uppercase tracking-[0.04em]" id="tax-catalog-custom">Impuestos propios</h3>
            <p className="text-xs text-muted-foreground">Para un impuesto que no está en el catálogo (poco habitual).</p>
          </div>
          <Button onClick={() => setCustomOpen(true)} size="sm" type="button" variant="outline">
            <Plus aria-hidden="true" />
            Añadir impuesto propio
          </Button>
        </div>
        {catalog.custom.length > 0 ? (
          <ul className="divide-y divide-window-shadow rounded-surface border border-window-dark-shadow">
            {catalog.custom.map((row) => (
              <li className="flex flex-wrap items-center gap-2 p-2.5" key={row.id}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input
                    checked={row.isActive}
                    className="size-4 shrink-0 accent-primary"
                    disabled={busy !== null}
                    onChange={(event) => {
                      const isActive = event.target.checked;
                      setCatalog((current) => current && { ...current, custom: current.custom.map((item) => (item.id === row.id ? { ...item, isActive } : item)) });
                      void run(row.id, () => sendJson(`/api/taxes/${row.id}`, "PATCH", { isActive }), isActive ? `«${row.name}» activado.` : `«${row.name}» desactivado.`);
                    }}
                    type="checkbox"
                  />
                  <span className="font-mono text-sm font-bold">{row.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{row.operation === "SUBTRACT" ? "−" : "+"}{formatPercent(row.rate)}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <CustomTaxDialog
        onClose={() => setCustomOpen(false)}
        onCreated={async () => {
          setCustomOpen(false);
          await load();
        }}
        open={customOpen}
      />
    </div>
  );
}

function CustomTaxDialog({ onClose, onCreated, open }: { onClose: () => void; onCreated: () => Promise<void>; open: boolean }) {
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [kind, setKind] = useState<"VAT" | "WITHHOLDING" | "OTHER">("OTHER");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedRate = parseDecimalInput(rate);
    if (!name.trim()) return setError("Indica el nombre del impuesto.");
    if (parsedRate === null || parsedRate < 0 || parsedRate > 100) return setError("Indica un porcentaje entre 0 y 100.");
    setPending(true);
    try {
      await sendJson("/api/taxes", "POST", { name: name.trim(), rate: parsedRate, kind, isDefault: false });
      toast.success(`Impuesto «${name.trim()}» creado.`);
      setName("");
      setRate("");
      setKind("OTHER");
      setError(null);
      await onCreated();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo crear el impuesto.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog description="Solo si no está en el catálogo: si existe uno con el mismo tipo y porcentaje, usa ese." onClose={onClose} open={open} size="sm" title="Añadir impuesto propio">
      <form className="grid gap-3" noValidate onSubmit={submit}>
        <AccessibleField id="custom-tax-name" label="Nombre" required>
          <Input onChange={(event) => setName(event.target.value)} placeholder="Tasa turística" value={name} />
        </AccessibleField>
        <AccessibleField id="custom-tax-rate" label="Porcentaje" required>
          <PercentInput onChange={(event) => setRate(event.target.value)} placeholder="2" value={rate} />
        </AccessibleField>
        <AccessibleField helperText="Las retenciones restan del total; el resto suma." id="custom-tax-kind" label="Tipo">
          <Select onChange={(event) => setKind(event.target.value as typeof kind)} value={kind}>
            <option value="OTHER">Otro impuesto (suma)</option>
            <option value="VAT">IVA (suma)</option>
            <option value="WITHHOLDING">Retención (resta)</option>
          </Select>
        </AccessibleField>
        <FormErrorMessage>{error}</FormErrorMessage>
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">Cancelar</Button>
          <SubmitButton pending={pending}>Crear</SubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

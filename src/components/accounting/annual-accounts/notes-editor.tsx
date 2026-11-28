"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const FAILURE = "No se pudo guardar la memoria.";

export type NoteTableView = { title: string; columns: string[]; rows: Array<{ label: string; values: Array<number | string | null>; strong?: boolean }>; note?: string };
export type NoteView = { id: string; title: string; guidance: string; extraLegalBasis?: string; text: string; isDefaultText: boolean; tables: NoteTableView[] };

type Props = {
  canEdit: boolean;
  fiscalYearId: string;
  notes: NoteView[];
  averageEmployees: number | null;
  taxData: Record<string, string>;
  /** La conciliación fiscal sale de la liquidación del Impuesto sobre Sociedades del ejercicio. */
  taxFromLiquidation?: boolean;
};

const money = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
const cell = (value: number | string | null) => (value === null ? "—" : typeof value === "number" ? money.format(value) : value);

const TAX_FIELDS: Array<[string, string]> = [
  ["permanentDifferences", "Diferencias permanentes (€)"],
  ["temporaryDifferences", "Diferencias temporarias (€)"],
  ["lossCarryforward", "Bases negativas que se compensan (€)"],
];

/**
 * Memoria del ejercicio: cada apartado con su texto editable y sus cuadros (calculados de la
 * contabilidad). Un apartado sin texto guardado muestra el texto de partida.
 */
export function AnnualAccountsNotesEditor({ averageEmployees, canEdit, fiscalYearId, notes, taxData, taxFromLiquidation = false }: Props) {
  const router = useRouter();
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(notes.map((note) => [note.id, note.text])));
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [employees, setEmployees] = useState(averageEmployees === null ? "" : String(averageEmployees));
  const [tax, setTax] = useState<Record<string, string>>(() => Object.fromEntries(TAX_FIELDS.map(([key]) => [key, taxData[key] ?? ""])));
  const [dataDirty, setDataDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const hasChanges = dirty.size > 0 || dataDirty;

  function editText(id: string, value: string) {
    setTexts((current) => ({ ...current, [id]: value }));
    setDirty((current) => new Set(current).add(id));
  }

  async function save() {
    const employeesValue = employees.trim() === "" ? null : Number(employees.replace(",", "."));
    if (employeesValue !== null && !(Number.isFinite(employeesValue) && employeesValue >= 0)) {
      toast.error("La plantilla media debe ser un número (por ejemplo, 3,5).");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/accounting/annual-accounts/notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fiscalYearId,
          sections: Object.fromEntries([...dirty].map((id) => [id, texts[id] ?? ""])),
          ...(dataDirty ? { averageEmployees: employeesValue, taxData: tax } : {}),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, FAILURE));
      toast.success("Memoria guardada.");
      setDirty(new Set());
      setDataDirty(false);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, FAILURE));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-control border border-window-dark-shadow bg-window-panel p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="notes-employees">Plantilla media del ejercicio</Label>
          <Input disabled={!canEdit} id="notes-employees" inputMode="decimal" onChange={(event) => { setEmployees(event.target.value); setDataDirty(true); }} placeholder="p. ej. 3,5" value={employees} />
        </div>
        {taxFromLiquidation ? null : TAX_FIELDS.map(([key, label]) => (
          <div className="space-y-1" key={key}>
            <Label htmlFor={`notes-tax-${key}`}>{label}</Label>
            <Input disabled={!canEdit} id={`notes-tax-${key}`} inputMode="decimal" onChange={(event) => { setTax((current) => ({ ...current, [key]: event.target.value })); setDataDirty(true); }} placeholder="Sin indicar" value={tax[key] ?? ""} />
          </div>
        ))}
        <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
          {taxFromLiquidation
            ? "Dato que no está en la contabilidad: la plantilla media va en la nota 10 y decide qué modelo te corresponde. La conciliación fiscal de la nota 8 se toma de la liquidación del Impuesto sobre Sociedades de este ejercicio (Fiscalidad)."
            : "Datos que no están en la contabilidad. La plantilla media va en la nota 10 y decide qué modelo te corresponde; los otros tres completan la conciliación fiscal de la nota 8 (si liquidas el Impuesto sobre Sociedades en Fiscalidad, se toman de ahí)."}
        </p>
      </div>

      {notes.map((note) => (
        <section aria-labelledby={`note-${note.id}`} className="space-y-2 border-t border-window-dark-shadow pt-3" key={note.id}>
          <h3 className="font-bold" id={`note-${note.id}`}>{note.title}</h3>
          <p className="text-xs text-muted-foreground">
            {note.guidance}{note.extraLegalBasis ? ` (No figura en el modelo del plan: lo exige ${note.extraLegalBasis}.)` : ""}
          </p>
          <Label className="sr-only" htmlFor={`note-text-${note.id}`}>Texto del apartado {note.title}</Label>
          <Textarea className="min-h-32" disabled={!canEdit} id={`note-text-${note.id}`} onChange={(event) => editText(note.id, event.target.value)} rows={Math.min(14, Math.max(4, Math.ceil((texts[note.id] ?? "").length / 110)))} value={texts[note.id] ?? ""} />
          {note.isDefaultText && !dirty.has(note.id) ? <p className="text-xs text-warning-text">Texto de partida sin revisar: complétalo (lo que va entre corchetes) y guárdalo.</p> : null}
          {note.tables.map((table) => (
            <div className="overflow-x-auto" key={table.title}>
              <table className="w-full min-w-96 border-collapse text-sm">
                <caption className="pb-1 text-left font-bold">{table.title}</caption>
                <thead>
                  <tr className="border-b border-window-dark-shadow">
                    <th className="py-1 pr-2 text-left font-bold" scope="col">Concepto</th>
                    {table.columns.map((column) => <th className="whitespace-nowrap px-2 py-1 text-right font-bold" key={column} scope="col">{column}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => (
                    <tr className={row.strong ? "border-b border-window-shadow bg-window-panel font-bold" : "border-b border-window-shadow"} key={row.label}>
                      <th className="py-1 pr-2 text-left font-normal" scope="row">{row.strong ? <strong>{row.label}</strong> : row.label}</th>
                      {row.values.map((value, index) => <td className="whitespace-nowrap px-2 py-1 text-right" key={index}>{cell(value)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {table.note ? <p className="pt-1 text-xs text-muted-foreground">{table.note}</p> : null}
            </div>
          ))}
        </section>
      ))}

      {canEdit ? (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-window-dark-shadow bg-card py-2">
          <Button aria-busy={pending} disabled={pending || !hasChanges} onClick={() => void save()} type="button">{pending ? "Guardando…" : "Guardar memoria"}</Button>
          <p className="text-sm text-muted-foreground" role="status">{hasChanges ? "Hay cambios sin guardar." : "Sin cambios pendientes."}</p>
        </div>
      ) : null}
    </div>
  );
}

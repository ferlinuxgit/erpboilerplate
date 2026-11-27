"use client";

import { Printer } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { DecimalInput } from "@/components/ui/number-input";
import { InlineAlert } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";
import type { CorporateReminderSettings } from "@/server/corporate-tax/deadlines";
import type { LossRegisterRow } from "@/server/corporate-tax/service";

const jsonHeaders = () => ({ "Content-Type": "application/json", ...getCsrfHeader() });

/** Botón «Imprimir» del resumen para Sociedades WEB. */
export function CorporateTaxPrintButton() {
  return <Button className="print:hidden" onClick={() => window.print()} type="button" variant="outline"><Printer aria-hidden="true" /> Imprimir</Button>;
}

/**
 * Registro de bases imponibles negativas por ejercicio de origen. Las de liquidaciones presentadas
 * en el programa salen solas; aquí se anotan las anteriores (lo pendiente al empezar a usarlo).
 */
export function CorporateTaxLossesForm({ canWrite, currencyCode, rows }: { canWrite: boolean; currencyCode: string; rows: LossRegisterRow[] }) {
  const router = useRouter();
  const [year, setYear] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (cents: number) => formatMoney(cents / 100, currencyCode);

  async function run(request: () => Promise<Response>, success: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await request();
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la base negativa."));
      toast.success(success);
      setYear("");
      setAmount(null);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "No se pudo guardar la base negativa."));
    } finally {
      setBusy(false);
    }
  }

  const add = () => run(
    () => fetch("/api/corporate-tax/losses", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ originYear: Number(year), amountCents: Math.round((amount ?? 0) * 100) }) }),
    "Base negativa anotada.",
  );

  return (
    <div className="space-y-2">
      {error ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay bases imponibles negativas registradas.</p>
      ) : (
        <TableContainer label="Bases imponibles negativas">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ejercicio de origen</TableHead>
                <TableHead>Procedencia</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead className="text-right">Compensado</TableHead>
                <TableHead className="text-right">Pendiente</TableHead>
                <TableHead><span className="sr-only">Acciones</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.originYear}>
                  <TableCell className="font-mono font-semibold">{row.originYear}</TableCell>
                  <TableCell>{row.source === "manual" ? "Anotada a mano" : "Liquidación presentada en el programa"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono">{money(row.originalCents)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono">{money(row.appliedCents)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono font-bold">{money(row.pendingCents)}</TableCell>
                  <TableCell className="text-right">
                    {canWrite && row.source === "manual" && row.manualId ? (
                      <Button
                        aria-label={`Borrar la base negativa de ${row.originYear}`}
                        disabled={busy}
                        onClick={() => void run(() => fetch(`/api/corporate-tax/losses/${encodeURIComponent(row.manualId!)}`, { method: "DELETE", headers: jsonHeaders() }), "Base negativa borrada.")}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Borrar
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {canWrite ? (
        <div className="flex flex-wrap items-end gap-2">
          <AccessibleField className="w-36" id="ct-loss-year" label="Ejercicio de origen">
            <Input inputMode="numeric" maxLength={4} onChange={(event) => setYear(event.target.value.replace(/\D/g, ""))} placeholder="2023" value={year} />
          </AccessibleField>
          <AccessibleField className="w-44" id="ct-loss-amount" label="Pendiente de compensar">
            <DecimalInput adornment="€" minimumFractionDigits={2} onValueChange={(value) => setAmount(value)} value={amount ?? ""} />
          </AccessibleField>
          <Button disabled={busy || year.length !== 4 || !amount || amount <= 0} onClick={() => void add()} type="button" variant="secondary">Anotar base negativa</Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Anota lo que quedaba pendiente de cada ejercicio al empezar a usar el programa (está en la última declaración presentada). No caducan, pero cada año solo se puede compensar hasta el 70 % de la base previa, con un mínimo de 1 millón.
      </p>
    </div>
  );
}

const REMINDERS: Array<{ key: keyof CorporateReminderSettings; label: string; help: string }> = [
  { key: "books", label: "Legalización de libros", help: "Cuatro meses desde el cierre del ejercicio (30 de abril si coincide con el año natural), en el Registro Mercantil." },
  { key: "annualAccounts", label: "Depósito de cuentas anuales", help: "Un mes desde que la junta las aprueba; como tarde el 30 de julio si el ejercicio coincide con el año natural." },
  { key: "relatedParties", label: "Modelo 232 (operaciones vinculadas)", help: "En noviembre, solo si la sociedad hace operaciones con socios, administradores o empresas del grupo por encima de los importes que obligan a declararlas." },
];

/** Recordatorios informativos de la sociedad en el calendario fiscal (el programa no los calcula). */
export function CorporateTaxRemindersForm({ canWrite, initial }: { canWrite: boolean; initial: CorporateReminderSettings }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: keyof CorporateReminderSettings, value: boolean) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/corporate-tax/settings", { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(next) });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudieron guardar los recordatorios."));
      toast.success("Recordatorios guardados.");
      router.refresh();
    } catch (caught) {
      setSettings(settings);
      setError(errorMessage(caught, "No se pudieron guardar los recordatorios."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {error ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}
      <ul className="space-y-2">
        {REMINDERS.map((reminder) => (
          <li key={reminder.key}>
            <label className="flex items-start gap-2 text-sm">
              <input checked={settings[reminder.key]} className="mt-0.5 size-4" disabled={!canWrite || busy} onChange={(event) => void toggle(reminder.key, event.target.checked)} type="checkbox" />
              <span>
                <span className="font-semibold">{reminder.label}</span>
                <span className="block text-xs text-muted-foreground">{reminder.help}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Son avisos en el calendario fiscal: el programa no prepara estos trámites.</p>
    </div>
  );
}

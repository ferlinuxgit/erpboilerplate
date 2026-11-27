"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";
import { PAYROLL_IMPORT_COLUMNS } from "@/server/payroll/model";
import type { PayrollImportResult } from "@/server/payroll/service";

/** Importa las nóminas de un mes pegando las filas de la hoja de cálculo de la gestoría. */
export function PayrollImportForm({ initialPeriod, currencyCode }: { initialPeriod: string; currencyCode: string }) {
  const router = useRouter();
  const [period, setPeriod] = useState(initialPeriod);
  const [text, setText] = useState("");
  const [post, setPost] = useState(false);
  const [busy, setBusy] = useState<"check" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PayrollImportResult | null>(null);

  async function run(commit: boolean) {
    setBusy(commit ? "commit" : "check");
    setError(null);
    try {
      const response = await fetch("/api/payroll/slips/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ period, text, commit, post }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudieron importar las nóminas."));
      const data: PayrollImportResult = await response.json();
      setResult(data);
      if (commit) {
        toast.success(`${data.created} nómina(s) importadas.`);
        router.push(`/payroll?period=${period}`);
        router.refresh();
      }
    } catch (caught) {
      setError(errorMessage(caught, "No se pudieron importar las nóminas."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Copia las filas de la hoja de cálculo (o de un CSV separado por punto y coma) con estas columnas, en este orden. Los importes pueden ir con coma decimal. El trabajador se busca por su NIF, así que tiene que estar dado de alta.
      </p>
      <p className="rounded-control border bg-window-panel p-2 font-mono text-xs">{PAYROLL_IMPORT_COLUMNS.join(" · ")}</p>
      <div className="grid gap-3 md:grid-cols-6">
        <AccessibleField className="md:col-span-1" id="import-period" label="Mes" required>
          <Input onChange={(event) => setPeriod(event.target.value)} required type="month" value={period} />
        </AccessibleField>
        <AccessibleField className="md:col-span-6" id="import-text" label="Filas de las nóminas" required>
          <Textarea
            className="min-h-40 font-mono"
            onChange={(event) => {
              setText(event.target.value);
              setResult(null);
            }}
            placeholder={"12345678Z\t2.000,00\t0\t300,00\t0\t127,00\t620,00\t0\t1.573,00"}
            value={text}
          />
        </AccessibleField>
      </div>
      <label className="flex w-fit items-center gap-2 text-sm">
        <input checked={post} onChange={(event) => setPost(event.target.checked)} type="checkbox" />
        Contabilizarlas al importar (si no, quedan en borrador)
      </label>
      {error ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy !== null || !text.trim() || !period} onClick={() => void run(false)} type="button" variant="outline">
          {busy === "check" ? "Comprobando…" : "Comprobar"}
        </Button>
        <Button disabled={busy !== null || !result || result.invalid > 0 || result.valid === 0} onClick={() => void run(true)} type="button">
          {busy === "commit" ? "Importando…" : result && result.invalid === 0 && result.valid > 0 ? `Importar ${result.valid} nómina(s)` : "Importar"}
        </Button>
      </div>

      {result ? (
        <>
          {result.rows.length === 0 ? (
            <InlineAlert tone="warning">No se ha encontrado ninguna fila.</InlineAlert>
          ) : result.invalid > 0 ? (
            <InlineAlert title={`${result.invalid} fila(s) con errores`} tone="warning">Corrígelas en el texto y vuelve a comprobar: se importan todas o ninguna.</InlineAlert>
          ) : (
            <InlineAlert title="Todo correcto" tone="success">{result.valid} nómina(s) listas para importar.</InlineAlert>
          )}
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Línea</TableHead>
                  <TableHead>NIF</TableHead>
                  <TableHead>Trabajador</TableHead>
                  <TableHead className="text-right">Bruto</TableHead>
                  <TableHead className="text-right">IRPF</TableHead>
                  <TableHead className="text-right">Líquido</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row) => (
                  <TableRow key={row.line}>
                    <TableCell>{row.line}</TableCell>
                    <TableCell className="font-mono">{row.taxId || "—"}</TableCell>
                    <TableCell>{row.employeeName ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{formatMoney(row.amounts.grossAmount, currencyCode)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{formatMoney(row.amounts.withholdingAmount, currencyCode)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{formatMoney(row.amounts.netAmount, currencyCode)}</TableCell>
                    <TableCell>{row.error ? <span className="text-danger-text">{row.error}</span> : <StatusBadge tone="success">Correcta</StatusBadge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      ) : null}
    </div>
  );
}

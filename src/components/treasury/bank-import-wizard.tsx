"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { AccessibleField, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert, MetricCard } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BankImportMapping } from "@/lib/bank-import/tabular";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate, formatMoney } from "@/lib/format";

type Account = { id: string; bankName: string; iban: string };
type Movement = { line: number; postedAt: string; amount: number; description: string; balanceAfter: number | null; reference: string | null };
type Skipped = { line: number; reason: string };
type Preview = {
  format: "CSV" | "XLSX" | "NORMA43";
  fileName: string;
  rows: string[][];
  columnCount: number;
  mapping: BankImportMapping | null;
  mappingSource: "manual" | "saved" | "detected";
  norma43Accounts: Array<{ label: string; movements: number; initialBalance: number; finalBalance: number | null; startDate: string | null; endDate: string | null; matchesAccount: boolean }>;
  norma43AccountIndex: number | null;
  sample: Movement[];
  validCount: number;
  skipped: Skipped[];
  skippedCount: number;
  warnings: string[];
};
type Report = { format: string; imported: number; duplicates: Skipped[]; skipped: Skipped[]; warnings: string[]; autoAssigned: number };

type Role = "ignore" | "date" | "valueDate" | "amount" | "debit" | "credit" | "description" | "balance" | "reference";
const roleLabels: Record<Role, string> = {
  ignore: "No usar",
  date: "Fecha",
  valueDate: "Fecha valor",
  amount: "Importe (+/-)",
  debit: "Cargos",
  credit: "Abonos",
  description: "Concepto",
  balance: "Saldo",
  reference: "Referencia",
};
const formatLabels = { CSV: "CSV / texto", XLSX: "Excel", NORMA43: "Norma 43 (AEB)" } as const;

function rolesFromMapping(mapping: BankImportMapping, columnCount: number): Role[] {
  return Array.from({ length: columnCount }, (_, column) => {
    if (mapping.dateColumn === column) return "date";
    if (mapping.valueDateColumn === column) return "valueDate";
    if (mapping.amountColumn === column) return "amount";
    if (mapping.debitColumn === column) return "debit";
    if (mapping.creditColumn === column) return "credit";
    if (mapping.balanceColumn === column) return "balance";
    if (mapping.referenceColumn === column) return "reference";
    if (mapping.descriptionColumns.includes(column)) return "description";
    return "ignore";
  });
}

function mappingFromRoles(base: BankImportMapping, roles: Role[]): BankImportMapping {
  const find = (role: Role) => {
    const index = roles.indexOf(role);
    return index >= 0 ? index : null;
  };
  return {
    ...base,
    dateColumn: find("date") ?? -1,
    valueDateColumn: find("valueDate"),
    amountColumn: find("amount"),
    debitColumn: find("debit"),
    creditColumn: find("credit"),
    balanceColumn: find("balance"),
    referenceColumn: find("reference"),
    descriptionColumns: roles.flatMap((role, index) => (role === "description" ? [index] : [])),
  };
}

/** Comparación estable de dos mapeos (el orden de las claves puede variar al guardarse en JSONB). */
function mappingKey(mapping: BankImportMapping) {
  return [
    mapping.headerRow, mapping.dateColumn, mapping.valueDateColumn ?? "", mapping.amountColumn ?? "", mapping.debitColumn ?? "",
    mapping.creditColumn ?? "", mapping.balanceColumn ?? "", mapping.referenceColumn ?? "", mapping.descriptionColumns.join("+"),
    mapping.dateFormat, mapping.decimalSeparator, mapping.invertSign ? 1 : 0,
  ].join("|");
}

/**
 * Asistente de importación de extractos: fichero → revisar columnas y formatos (o la cuenta del
 * Norma 43) con vista previa → importar e informe de lo importado y de lo omitido con su motivo.
 */
export function BankImportWizard({ accounts, currencyCode, initialAccountId }: { accounts: Account[]; currencyCode: string; initialAccountId?: string }) {
  const router = useRouter();
  const [bankAccountId, setBankAccountId] = useState(accounts.some((account) => account.id === initialAccountId) ? initialAccountId ?? "" : accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<BankImportMapping | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [norma43Index, setNorma43Index] = useState<number | null>(null);
  const [saveMapping, setSaveMapping] = useState(true);
  const [applyRules, setApplyRules] = useState(true);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = Boolean(preview?.mapping && mapping && mappingKey(mappingFromRoles(mapping, roles)) !== mappingKey(preview.mapping));

  function formFor(currentMapping: BankImportMapping | null, index: number | null) {
    const form = new FormData();
    if (file) form.set("file", file);
    form.set("bankAccountId", bankAccountId);
    if (currentMapping) form.set("mapping", JSON.stringify(currentMapping));
    if (index !== null) form.set("norma43AccountIndex", String(index));
    return form;
  }

  async function loadPreview(currentMapping: BankImportMapping | null, index: number | null) {
    if (!file || !bankAccountId) return;
    setBusy("preview");
    setError(null);
    try {
      const response = await fetch("/api/treasury/import/preview", { method: "POST", headers: getCsrfHeader(), body: formFor(currentMapping, index) });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo leer el extracto."));
      const data = (await response.json()) as Preview;
      setPreview(data);
      setMapping(data.mapping);
      setRoles(data.mapping ? rolesFromMapping(data.mapping, data.columnCount) : []);
      setNorma43Index(data.norma43AccountIndex);
      setReport(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo leer el extracto.");
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    if (!file || !preview) return;
    setBusy("import");
    setError(null);
    try {
      const form = formFor(mapping ? mappingFromRoles(mapping, roles) : null, norma43Index);
      form.set("saveMapping", String(saveMapping));
      form.set("applyRules", String(applyRules));
      const response = await fetch("/api/treasury/import", { method: "POST", headers: getCsrfHeader(), body: form });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo importar el extracto."));
      const data = (await response.json()) as Report;
      setReport(data);
      toast.success(`${data.imported} ${data.imported === 1 ? "movimiento importado" : "movimientos importados"}.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo importar el extracto.");
    } finally {
      setBusy(null);
    }
  }

  if (report) {
    const omitted = [...report.duplicates.map((row) => ({ ...row, kind: "Duplicado" })), ...report.skipped.map((row) => ({ ...row, kind: "Descartado" }))].sort((a, b) => a.line - b.line);
    return (
      <div className="space-y-3" data-testid="bank-import-report">
        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Importados" value={report.imported} helper="Quedan pendientes de conciliar" tone="success" />
          <MetricCard label="Asignados por reglas" value={report.autoAssigned} helper="Reglas «aplicar sola»" />
          <MetricCard label="Ya existían" value={report.duplicates.length} helper="No se duplican" />
          <MetricCard label="Descartados" value={report.skipped.length} helper="Filas sin fecha o importe" tone={report.skipped.length ? "warning" : "neutral"} />
        </section>
        {report.warnings.map((warning) => <InlineAlert key={warning} tone="warning">{warning}</InlineAlert>)}
        {omitted.length ? (
          <details className="border border-window-dark-shadow p-2">
            <summary className="cursor-pointer text-sm font-bold">Ver filas no importadas y el motivo ({omitted.length})</summary>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
              {omitted.map((row) => <li key={`${row.kind}-${row.line}`}><span className="font-mono">Fila {row.line}</span> · {row.kind}: {row.reason}</li>)}
            </ul>
          </details>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Link className={buttonVariants()} href={`/treasury/reconciliation?account=${encodeURIComponent(bankAccountId)}`}>Conciliar ahora</Link>
          <Button onClick={() => { setReport(null); setPreview(null); setFile(null); }} type="button" variant="outline">Importar otro extracto</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="bank-import-wizard">
      <ol className="flex flex-wrap gap-2 text-xs font-bold" aria-label="Pasos">
        <li className={preview ? "text-muted-foreground" : ""}>1. Elegir fichero</li>
        <li aria-hidden="true">›</li>
        <li className={preview ? "" : "text-muted-foreground"}>2. Revisar columnas</li>
        <li aria-hidden="true">›</li>
        <li className="text-muted-foreground">3. Importar</li>
      </ol>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <AccessibleField id="import-account" label="Cuenta bancaria" required>
          <Select onChange={(event) => { setBankAccountId(event.target.value); setPreview(null); }} value={bankAccountId}>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.bankName} · {account.iban}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField helperText="CSV o Excel descargado de tu banca online, o fichero Norma 43 (AEB 43). Máx. 5 MB." id="import-file" label="Extracto" required>
          <Input accept=".csv,.txt,.tsv,.xlsx,.xls,.n43,.aeb,.q43,.dat,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} type="file" />
        </AccessibleField>
        <Button disabled={!file || !bankAccountId || busy !== null} onClick={() => void loadPreview(null, null)} type="button">
          {busy === "preview" ? "Leyendo…" : "Ver vista previa"}
        </Button>
      </div>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      {preview ? (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge tone="info">{formatLabels[preview.format]}</StatusBadge>
            <span>{preview.fileName}</span>
            {preview.mappingSource === "saved" ? <StatusBadge tone="success">Formato recordado de la última vez</StatusBadge> : null}
          </p>
          {preview.warnings.map((warning) => <InlineAlert key={warning} tone="warning">{warning}</InlineAlert>)}

          {preview.format === "NORMA43" ? (
            preview.norma43Accounts.length > 1 ? (
              <AccessibleField id="import-n43-account" label="Cuenta del fichero que quieres importar">
                <Select onChange={(event) => { const index = Number(event.target.value); setNorma43Index(index); void loadPreview(null, index); }} value={String(norma43Index ?? 0)}>
                  {preview.norma43Accounts.map((account, index) => (
                    <option key={account.label} value={index}>{account.label} · {account.movements} movimientos{account.matchesAccount ? " (coincide con el IBAN)" : ""}</option>
                  ))}
                </Select>
              </AccessibleField>
            ) : preview.norma43Accounts[0] ? (
              <p className="text-sm text-muted-foreground">
                Cuenta {preview.norma43Accounts[0].label} · saldo inicial {formatMoney(preview.norma43Accounts[0].initialBalance, currencyCode)}
                {preview.norma43Accounts[0].finalBalance !== null ? ` · saldo final ${formatMoney(preview.norma43Accounts[0].finalBalance, currencyCode)}` : ""}
              </p>
            ) : null
          ) : mapping ? (
            <div className="space-y-2">
              <p className="text-sm">Indica qué es cada columna. Lo hemos deducido de los títulos; corrígelo si hace falta.</p>
              <div className="grid gap-2 sm:grid-cols-4">
                <AccessibleField helperText="0 si el fichero no tiene títulos." id="import-header-row" label="Fila de títulos">
                  <Input min={0} onChange={(event) => setMapping({ ...mapping, headerRow: Math.max(Number(event.target.value || 0), 0) - 1 })} type="number" value={mapping.headerRow + 1} />
                </AccessibleField>
                <AccessibleField id="import-date-format" label="Formato de fecha">
                  <Select onChange={(event) => setMapping({ ...mapping, dateFormat: event.target.value as BankImportMapping["dateFormat"] })} value={mapping.dateFormat}>
                    <option value="DMY">día/mes/año (31/12/2026)</option>
                    <option value="MDY">mes/día/año (12/31/2026)</option>
                    <option value="YMD">año-mes-día (2026-12-31)</option>
                  </Select>
                </AccessibleField>
                <AccessibleField id="import-decimal" label="Decimales">
                  <Select onChange={(event) => setMapping({ ...mapping, decimalSeparator: event.target.value as BankImportMapping["decimalSeparator"] })} value={mapping.decimalSeparator}>
                    <option value=",">Coma (1.234,56)</option>
                    <option value=".">Punto (1,234.56)</option>
                  </Select>
                </AccessibleField>
                <label className="flex items-center gap-2 self-end text-sm">
                  <input checked={Boolean(mapping.invertSign)} onChange={(event) => setMapping({ ...mapping, invertSign: event.target.checked })} type="checkbox" />
                  Los cargos vienen en positivo
                </label>
              </div>
              <div className="overflow-x-auto border border-window-dark-shadow">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Fila</TableHead>
                      {roles.map((role, column) => (
                        <TableHead key={column}>
                          <label className="sr-only" htmlFor={`import-role-${column}`}>Columna {column + 1}</label>
                          <Select
                            id={`import-role-${column}`}
                            onChange={(event) => {
                              const next = [...roles];
                              const value = event.target.value as Role;
                              // Una columna por papel, salvo el concepto (puede unir varias).
                              if (value !== "ignore" && value !== "description") next.forEach((current, index) => { if (current === value) next[index] = "ignore"; });
                              next[column] = value;
                              setRoles(next);
                            }}
                            value={role}
                          >
                            {(Object.keys(roleLabels) as Role[]).map((option) => <option key={option} value={option}>{roleLabels[option]}</option>)}
                          </Select>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.slice(0, 12).map((row, rowIndex) => (
                      <TableRow className={rowIndex === mapping.headerRow ? "font-bold" : rowIndex < mapping.headerRow ? "opacity-50" : undefined} key={rowIndex}>
                        <TableCell className="font-mono text-xs">{rowIndex + 1}</TableCell>
                        {roles.map((_, column) => <TableCell className="max-w-56 truncate text-xs" key={column}>{row[column] ?? ""}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button disabled={busy !== null} onClick={() => void loadPreview(mappingFromRoles(mapping, roles), null)} size="sm" type="button" variant={dirty ? "default" : "outline"}>
                {busy === "preview" ? "Comprobando…" : "Comprobar con estas columnas"}
              </Button>
            </div>
          ) : null}

          <div>
            <p className="text-sm font-bold">Así quedarán los movimientos ({preview.validCount} válidos{preview.skippedCount ? `, ${preview.skippedCount} filas descartadas` : ""})</p>
            {preview.sample.length ? (
              <div className="mt-1 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Fecha</TableHead><TableHead>Concepto</TableHead><TableHead className="text-right">Importe</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sample.map((movement) => (
                      <TableRow key={movement.line}>
                        <TableCell>{formatDate(movement.postedAt)}</TableCell>
                        <TableCell className="max-w-96 truncate">{movement.description}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(movement.amount, currencyCode)}</TableCell>
                        <TableCell className="text-right font-mono">{movement.balanceAfter === null ? "—" : formatMoney(movement.balanceAfter, currencyCode)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : <p className="text-sm text-muted-foreground">Ninguna fila se puede importar con esta configuración.</p>}
            {preview.skipped.length ? (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer">Filas descartadas y motivo</summary>
                <ul className="mt-1 max-h-48 overflow-y-auto">
                  {preview.skipped.map((row) => <li key={row.line}><span className="font-mono">Fila {row.line}</span>: {row.reason}</li>)}
                </ul>
              </details>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-window-shadow pt-2">
            {preview.format !== "NORMA43" ? (
              <label className="flex items-center gap-2 text-sm"><input checked={saveMapping} onChange={(event) => setSaveMapping(event.target.checked)} type="checkbox" /> Recordar estas columnas para esta cuenta</label>
            ) : null}
            <label className="flex items-center gap-2 text-sm"><input checked={applyRules} onChange={(event) => setApplyRules(event.target.checked)} type="checkbox" /> Aplicar las reglas automáticas</label>
            <Button data-testid="bank-import-submit" disabled={busy !== null || preview.validCount === 0 || dirty} onClick={() => void runImport()} type="button">
              {busy === "import" ? "Importando…" : `Importar ${preview.validCount} movimientos`}
            </Button>
            {dirty ? <span className="text-xs text-warning">Has cambiado las columnas: pulsa «Comprobar» antes de importar.</span> : null}
          </div>
          <p className="text-xs text-muted-foreground">Los movimientos repetidos de importaciones anteriores se omiten; dos cargos iguales del mismo día en el extracto se importan los dos.</p>
        </div>
      ) : null}
    </div>
  );
}

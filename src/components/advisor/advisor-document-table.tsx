"use client";

import { DownloadSimple, Eye } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { AdvisorDownloadButton } from "@/components/advisor/advisor-download-button";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableContainer, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type AdvisorTableColumn = { label: string; numeric?: boolean };

export type AdvisorTableRow = {
  id: string;
  cells: Array<string | { text: string; tone?: "muted" | "warning" | "danger" }>;
  /** Ver (en otra pestaña) y descargar el documento; sin `download` se muestra `missingLabel`. */
  view?: string;
  download?: string;
  missingLabel?: string;
};

type Props = {
  columns: AdvisorTableColumn[];
  rows: AdvisorTableRow[];
  /** Fila de totales (alineada con `columns`). */
  footer?: string[];
  /** Descarga de la selección (POST con `ids`). */
  selection: { href: string; body: Record<string, unknown>; zipLabel: string; noun: string };
  emptyTitle: string;
  emptyDescription: string;
  testId: string;
};

/**
 * Listado de documentos del portal: cada fila se ve o se descarga suelta; con las casillas se
 * descarga un grupo (ZIP con los documentos y su listado, o solo el Excel).
 */
export function AdvisorDocumentTable({ columns, rows, footer, selection, emptyTitle, emptyDescription, testId }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const ids = useMemo(() => rows.filter((row) => selected.has(row.id)).map((row) => row.id), [rows, selected]);

  if (rows.length === 0) return <EmptyState description={emptyDescription} title={emptyTitle} />;

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      <div aria-live="polite" className="flex min-h-9 flex-wrap items-center gap-2 rounded-control border border-window-dark-shadow bg-window-panel px-2 py-1 text-xs">
        {ids.length === 0 ? (
          <span className="text-muted-foreground">Marca las casillas para descargar varias {selection.noun} juntas.</span>
        ) : (
          <>
            <strong className="font-mono">{ids.length} seleccionada{ids.length === 1 ? "" : "s"}</strong>
            <AdvisorDownloadButton body={{ ...selection.body, ids, format: "zip" }} href={selection.href} kind="zip" label={selection.zipLabel} pendingLabel="Preparando ZIP…" size="xs" testId={`${testId}-selection-zip`} variant="default" />
            <AdvisorDownloadButton body={{ ...selection.body, ids, format: "xlsx" }} href={selection.href} kind="xlsx" label="Listado Excel" pendingLabel="Preparando Excel…" size="xs" />
            <button className="ml-auto font-mono text-xs underline underline-offset-2" onClick={() => setSelected(new Set())} type="button">Quitar selección</button>
          </>
        )}
      </div>
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <input
                  aria-label={allSelected ? "Quitar todas" : "Seleccionar todas las de esta página"}
                  checked={allSelected}
                  className="size-4 accent-primary"
                  onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((row) => row.id)) : new Set())}
                  type="checkbox"
                />
              </TableHead>
              {columns.map((column) => <TableHead className={column.numeric ? "text-right" : undefined} key={column.label}>{column.label}</TableHead>)}
              <TableHead className="text-right">Documento</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow data-state={selected.has(row.id) ? "selected" : undefined} key={row.id}>
                <TableCell>
                  <input aria-label={`Seleccionar ${typeof row.cells[0] === "string" ? row.cells[0] : row.cells[0]?.text}`} checked={selected.has(row.id)} className="size-4 accent-primary" onChange={(event) => toggle(row.id, event.target.checked)} type="checkbox" />
                </TableCell>
                {row.cells.map((cell, index) => {
                  const value = typeof cell === "string" ? { text: cell } : cell;
                  return (
                    <TableCell
                      className={cn(columns[index]?.numeric && "text-right whitespace-nowrap", value.tone === "muted" && "text-muted-foreground", value.tone === "warning" && "text-warning-text", value.tone === "danger" && "text-danger-text")}
                      key={index}
                    >
                      {value.text}
                    </TableCell>
                  );
                })}
                <TableCell className="text-right whitespace-nowrap">
                  {row.download ? (
                    <span className="inline-flex gap-1">
                      {row.view ? (
                        <a aria-label="Ver" className={buttonVariants({ variant: "ghost", size: "icon-sm" })} href={row.view} rel="noopener" target="_blank" title="Ver">
                          <Eye aria-hidden="true" />
                        </a>
                      ) : null}
                      <a aria-label="Descargar" className={buttonVariants({ variant: "ghost", size: "icon-sm" })} download href={row.download} title="Descargar">
                        <DownloadSimple aria-hidden="true" />
                      </a>
                    </span>
                  ) : (
                    <span className="text-xs text-warning-text">{row.missingLabel ?? "—"}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          {footer ? (
            <TableFooter>
              <TableRow>
                <TableCell />
                {footer.map((cell, index) => <TableCell className={columns[index]?.numeric ? "text-right whitespace-nowrap" : undefined} key={index}>{cell}</TableCell>)}
                <TableCell />
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </TableContainer>
    </div>
  );
}

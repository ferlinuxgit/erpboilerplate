import { formatMoney } from "@/lib/format";

/** Contenido de `FormActions summary`: nº de líneas y total del documento. */
export function FormTotalSummary({ label = "Total", lines, total, currencyCode, testId }: { label?: string; lines: number; total: number; currencyCode?: string; testId?: string }) {
  return (
    <>
      <span className="text-xs text-muted-foreground">{lines} línea{lines === 1 ? "" : "s"} · {label}</span>
      <span className="text-base font-bold tabular-nums" data-testid={testId}>{formatMoney(total, currencyCode)}</span>
    </>
  );
}

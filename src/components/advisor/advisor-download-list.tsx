import { AdvisorDownloadButton } from "@/components/advisor/advisor-download-button";

export type AdvisorDownloadItem = { key: string; title: string; description: string; href: string; kind: "zip" | "xlsx" | "file"; label?: string; primary?: boolean };

/** Lista de descargas con su explicación (libros, listados). */
export function AdvisorDownloadList({ items, testId }: { items: AdvisorDownloadItem[]; testId?: string }) {
  return (
    <ul className="divide-y divide-window-shadow rounded-control border border-window-dark-shadow" data-testid={testId}>
      {items.map((item) => (
        <li className="flex flex-col gap-2 p-2 sm:flex-row sm:items-center sm:justify-between" key={item.key}>
          <div className="min-w-0">
            <p className="font-mono text-sm font-bold">{item.title}</p>
            <p className="text-xs text-muted-foreground">{item.description}</p>
          </div>
          <AdvisorDownloadButton className="shrink-0" href={item.href} kind={item.kind} label={item.label ?? (item.kind === "zip" ? "Descargar ZIP" : "Descargar Excel")} pendingLabel="Generando…" testId={`advisor-download-${item.key}`} variant={item.primary ? "default" : "outline"} />
        </li>
      ))}
    </ul>
  );
}

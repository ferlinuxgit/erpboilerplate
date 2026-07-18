import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";

type CommercialLine = { id: string; description: string; quantity: string; unitPrice?: string; discountPct?: string; taxRate?: string; lineTotal?: string };

export function SalesDocumentLines({ currencyCode, lines }: { currencyCode: string; lines: CommercialLine[] }) {
  return (
    <>
      <div className="grid gap-2 md:hidden">
        {lines.map((line) => <article className="rounded-xl border p-4" key={line.id}><div className="flex items-start justify-between gap-3"><p className="font-medium">{line.description}</p><p className="font-mono font-semibold">{line.lineTotal ? formatMoney(line.lineTotal, currencyCode) : `${Number(line.quantity).toLocaleString("es-ES")} uds.`}</p></div><p className="mt-2 text-xs text-muted-foreground">{Number(line.quantity).toLocaleString("es-ES")} × {line.unitPrice ? formatMoney(line.unitPrice, currencyCode) : "—"}{line.taxRate ? ` · IVA ${Number(line.taxRate).toLocaleString("es-ES")}%` : ""}</p></article>)}
      </div>
      <div className="hidden overflow-x-auto rounded-xl border md:block"><Table><TableHeader><TableRow><TableHead>Concepto</TableHead><TableHead className="text-right">Cantidad</TableHead>{lines.some((line) => line.unitPrice !== undefined) ? <><TableHead className="text-right">Precio</TableHead><TableHead className="text-right">Descuento</TableHead><TableHead className="text-right">IVA</TableHead><TableHead className="text-right">Total</TableHead></> : null}</TableRow></TableHeader><TableBody>{lines.map((line) => <TableRow key={line.id}><TableCell className="font-medium">{line.description}</TableCell><TableCell className="text-right">{Number(line.quantity).toLocaleString("es-ES")}</TableCell>{line.unitPrice !== undefined ? <><TableCell className="text-right">{formatMoney(line.unitPrice, currencyCode)}</TableCell><TableCell className="text-right">{Number(line.discountPct ?? 0).toLocaleString("es-ES")}%</TableCell><TableCell className="text-right">{Number(line.taxRate ?? 0).toLocaleString("es-ES")}%</TableCell><TableCell className="text-right font-mono font-semibold">{formatMoney(line.lineTotal ?? 0, currencyCode)}</TableCell></> : null}</TableRow>)}</TableBody></Table></div>
    </>
  );
}

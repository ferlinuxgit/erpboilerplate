import Link from "next/link";

import { PageSection } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { getInvoiceVerifactuInfo, getInvoiceVerifactuQrSvg, verifactuStatusTone } from "@/server/verifactu/service";

/** QR de cotejo, leyenda y estado del registro VeriFactu en la ficha de una factura emitida. */
export async function InvoiceVerifactuCard({ companyId, invoiceId }: { companyId: string; invoiceId: string }) {
  const info = await getInvoiceVerifactuInfo(companyId, invoiceId);
  if (!info) return null;
  const svg = await getInvoiceVerifactuQrSvg(info);

  return (
    <PageSection title="VeriFactu" description="Registro de facturación de esta factura y código QR que tu cliente puede comprobar en la AEAT.">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* SVG generado en el servidor a partir de la URL de cotejo (sin contenido del usuario sin escapar). */}
        <div
          aria-label="Código QR de cotejo en la sede electrónica de la AEAT"
          className="size-36 shrink-0 bg-white p-1"
          dangerouslySetInnerHTML={{ __html: svg }}
          role="img"
        />
        <div className="min-w-0 space-y-2 text-sm">
          {info.legends.map((legend) => <p className="font-bold" key={legend}>{legend}</p>)}
          <p className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={verifactuStatusTone[info.status] ?? "neutral"}>{info.statusLabel}</StatusBadge>
            <span className="text-muted-foreground">Registro n.º {info.sequence}{info.invoiceTypeCode ? ` · ${info.invoiceTypeCode}` : ""}</span>
          </p>
          {info.errorMessage ? <p className="text-xs text-destructive">{info.errorMessage}</p> : null}
          <p className="break-all font-mono text-xs text-muted-foreground" title="Huella (SHA-256)">{info.hash}</p>
          <p className="flex flex-wrap gap-3 text-xs">
            <a className="text-primary underline" href={info.url} rel="noopener noreferrer" target="_blank">Comprobar en la AEAT</a>
            <Link className="text-primary underline" href="/fiscal/verifactu">Ver todos los registros</Link>
          </p>
        </div>
      </div>
    </PageSection>
  );
}

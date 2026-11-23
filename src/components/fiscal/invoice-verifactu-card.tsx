import Link from "next/link";

import { PageSection } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { getInvoiceVerifactuInfo, getInvoiceVerifactuQrSvg, verifactuStatusTone } from "@/server/verifactu/service";

/** QR de cotejo, leyenda y estado del registro VERI*FACTU en la ficha de una factura emitida. */
export async function InvoiceVerifactuCard({ companyId, invoiceId }: { companyId: string; invoiceId: string }) {
  const info = await getInvoiceVerifactuInfo(companyId, invoiceId);
  if (!info) return null;
  const svg = await getInvoiceVerifactuQrSvg(info);

  return (
    <PageSection title="VERI*FACTU" description="Registro de facturación de esta factura y código QR que tu cliente puede comprobar en la AEAT.">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* SVG generado en el servidor a partir de la URL de cotejo (sin contenido del usuario sin escapar). */}
        <div className="flex shrink-0 flex-col items-center gap-1 text-xs">
          <p>{info.caption}</p>
          <div
            aria-label="Código QR de cotejo en la sede electrónica de la AEAT"
            className="size-36 bg-white p-1"
            dangerouslySetInnerHTML={{ __html: svg }}
            role="img"
          />
          {info.legends.map((legend) => <p className="font-bold" key={legend}>{legend}</p>)}
        </div>
        <div className="min-w-0 space-y-2 text-sm">
          {info.mode === "VERIFACTU" && info.legends.length === 0 && info.status !== "REJECTED" ? (
            <p className="text-xs text-danger-text">El envío a la AEAT no está operativo: la factura no lleva la leyenda «VERI*FACTU» hasta que se resuelva.</p>
          ) : null}
          <p className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={verifactuStatusTone[info.status] ?? "neutral"}>{info.statusLabel}</StatusBadge>
            <span className="text-muted-foreground">Registro n.º {info.sequence}{info.invoiceTypeCode ? ` · ${info.invoiceTypeCode}` : ""}</span>
          </p>
          {info.errorMessage ? <p className="text-xs text-destructive">{info.errorMessage}</p> : null}
          <p className="break-all font-mono text-xs text-muted-foreground" title="Huella (SHA-256)">{info.hash}</p>
          <p className="flex flex-wrap gap-3 text-xs">
            <a className="text-link underline" href={info.url} rel="noopener noreferrer" target="_blank">Comprobar en la AEAT</a>
            <Link className="text-link underline" href="/fiscal/verifactu">Ver todos los registros</Link>
          </p>
        </div>
      </div>
    </PageSection>
  );
}

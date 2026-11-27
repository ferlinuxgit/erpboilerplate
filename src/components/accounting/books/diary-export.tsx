"use client";

import { useState } from "react";

import { FileDownloadButton } from "@/components/accounting/books/file-download-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Exportación del diario a A3 (pide el código de empresa de A3) y a ContaPlus. */
export function DiaryExport({ fiscalYearId }: { fiscalYearId: string }) {
  const [companyCode, setCompanyCode] = useState("1");
  const code = Number(companyCode);
  const validCode = Number.isInteger(code) && code >= 1 && code <= 99_999;
  const year = encodeURIComponent(fiscalYearId);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <h3 className="font-bold">A3 (Wolters Kluwer)</h3>
        <p className="text-sm text-muted-foreground">Fichero <code>SUENLACE.DAT</code> con los apuntes del diario. En A3 se importa desde «Enlace contable de entrada».</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="a3-company-code">Código de la empresa en A3</Label>
            <Input aria-invalid={!validCode} className="w-32" id="a3-company-code" inputMode="numeric" max={99999} min={1} onChange={(event) => setCompanyCode(event.target.value)} type="number" value={companyCode} />
          </div>
          {validCode ? (
            <FileDownloadButton fallbackFileName="SUENLACE.DAT" failure="No se pudo exportar el diario para A3." href={`/api/accounting/books/export?year=${year}&format=a3&companyCode=${code}`} label="Descargar SUENLACE.DAT" />
          ) : (
            <p className="text-sm text-danger-text" role="alert">Escribe un número del 1 al 99999.</p>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="font-bold">ContaPlus / Sage</h3>
        <p className="text-sm text-muted-foreground">ZIP con <code>XDiario.txt</code> (apuntes) y <code>XSubCta.txt</code> (subcuentas). Se importa desde «Importación de ficheros ASCII».</p>
        <FileDownloadButton fallbackFileName="contaplus.zip" failure="No se pudo exportar el diario para ContaPlus." href={`/api/accounting/books/export?year=${year}&format=contaplus`} label="Descargar XDiario y XSubCta" />
      </div>
    </div>
  );
}

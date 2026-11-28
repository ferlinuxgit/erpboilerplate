"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";

type DownloadRequest = { format: "facturae" | "ubl" | "ubl-aeat"; signed?: boolean; regenerate?: boolean };

function fileNameFrom(response: Response, fallback: string) {
  const match = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "");
  return match?.[1] ?? fallback;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // El navegador necesita la URL viva un instante para iniciar la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Botón que genera (y firma, si procede) la factura electrónica y la descarga. */
export function EInvoiceDownloadButton({
  children,
  disabled,
  invoiceId,
  request,
  testId,
  variant = "outline",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  invoiceId: string;
  request: DownloadRequest;
  testId?: string;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function download() {
    setPending(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/einvoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo generar la factura electrónica."));
      saveBlob(await response.blob(), fileNameFrom(response, request.format === "facturae" ? "facturae.xml" : "factura-ubl.xml"));
      toast.success(request.signed ? "Factura electrónica firmada y descargada." : "Factura electrónica descargada.");
      // La copia generada queda guardada: se refresca la lista de ficheros de la ficha.
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo generar la factura electrónica."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button data-testid={testId} disabled={disabled || pending} onClick={download} size="sm" type="button" variant={variant}>
      {pending ? "Generando…" : children}
    </Button>
  );
}

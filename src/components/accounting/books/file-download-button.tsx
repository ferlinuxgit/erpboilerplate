"use client";

import { DownloadSimple } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";

type Props = {
  /** Ruta de la API que devuelve el fichero. */
  href: string;
  /** Con cuerpo se envía por POST (generar y anotar); sin él, GET. */
  body?: Record<string, unknown>;
  label: string;
  pendingLabel?: string;
  fallbackFileName: string;
  failure?: string;
  variant?: "default" | "outline" | "secondary";
  /** Recarga los datos de la página al terminar (p. ej. tras anotar un juego de libros). */
  refresh?: boolean;
};

/** Descarga un fichero generado en el servidor mostrando el progreso (puede tardar unos segundos). */
export function FileDownloadButton({ body, failure = "No se pudo generar el fichero.", fallbackFileName, href, label, pendingLabel = "Generando…", refresh = false, variant = "outline" }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function download() {
    setPending(true);
    try {
      const response = await fetch(href, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
      if (!response.ok) throw new Error(await readApiError(response, failure));
      const fileName = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackFileName;
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(`Descargado: ${fileName}`);
      if (refresh) router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button aria-busy={pending} disabled={pending} onClick={() => void download()} type="button" variant={variant}>
      <DownloadSimple aria-hidden="true" />
      {pending ? pendingLabel : label}
    </Button>
  );
}

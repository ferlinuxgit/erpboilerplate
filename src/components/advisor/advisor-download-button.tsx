"use client";

import { DownloadSimple, FileZip, MicrosoftExcelLogo } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AdvisorDownloadError, downloadAdvisorFile } from "@/components/advisor/advisor-download";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/components/ui/form";

const icons = { zip: FileZip, xlsx: MicrosoftExcelLogo, file: DownloadSimple };

type Props = {
  href: string;
  label: string;
  /** Texto mientras se prepara (los ZIP pueden tardar). */
  pendingLabel?: string;
  kind?: keyof typeof icons;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "xs";
  body?: unknown;
  disabled?: boolean;
  className?: string;
  testId?: string;
};

/** Botón de descarga del portal del asesor: muestra el progreso y los avisos (documentos que faltan). */
export function AdvisorDownloadButton({ href, label, pendingLabel = "Preparando…", kind = "file", variant = "outline", size = "sm", body, disabled, className, testId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const Icon = icons[kind];

  async function run() {
    setBusy(true);
    try {
      const result = await downloadAdvisorFile({ href, body, fallbackName: "descarga", failure: "No se pudo preparar la descarga." });
      if (result.missing > 0) toast.warning(`Descargado ${result.fileName}. Faltan ${result.missing} documento${result.missing === 1 ? "" : "s"}: lo explica el LEEME.txt del ZIP.`);
      else toast.success(`Descargado ${result.fileName}.`);
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo preparar la descarga."));
      if (error instanceof AdvisorDownloadError && error.sessionExpired) router.push("/asesor/acceso?caducada=1");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button aria-busy={busy} className={className} data-testid={testId} disabled={disabled || busy} onClick={() => void run()} size={size} type="button" variant={variant}>
      <Icon aria-hidden="true" />
      {busy ? pendingLabel : label}
    </Button>
  );
}

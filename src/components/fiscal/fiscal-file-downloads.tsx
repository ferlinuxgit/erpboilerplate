"use client";

import { DownloadSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { hasPresentationFile, MODELO_303_ACTIVITY_CODES, MODELO_303_ACTIVITY_LABELS, PRESENTATION_FILE_DESIGNS, PROVINCE_PARAMETER_MODELS } from "@/server/fiscal-files/models";

const FAILURE = "No se pudo generar el fichero para la sede de la AEAT.";

function readWarnings(header: string | null): string[] {
  if (!header) return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(header));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

type DownloadParams = {
  province: string;
  exemptFrom390: boolean;
  activityCode: string;
  iaeCode: string;
  has347Operations: boolean;
  cnae: string;
};

const EMPTY_PARAMS: DownloadParams = { province: "", exemptFrom390: false, activityCode: "", iaeCode: "", has347Operations: false, cnae: "" };

/** Parámetros de la descarga (los datos que el programa no guarda) a la consulta de la ruta. */
function queryOf(code: string, params: DownloadParams) {
  const query = new URLSearchParams();
  if ((PROVINCE_PARAMETER_MODELS as readonly string[]).includes(code) && params.province.trim()) query.set("provincia", params.province.trim());
  if (code === "303") {
    if (params.exemptFrom390) {
      query.set("exonerado390", "1");
      if (params.activityCode) query.set("actividad", params.activityCode);
      if (params.iaeCode.trim()) query.set("iae", params.iaeCode.trim());
      if (params.has347Operations) query.set("con347", "1");
    }
    if (params.cnae.trim()) query.set("cnae", params.cnae.trim());
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

/**
 * Descarga del fichero de presentación de un modelo (303, 111, 115, 123, 130, 347, 349, 190, 180 y
 * 193) para importarlo en la sede de la AEAT. Los datos que el programa no guarda (provincia de los
 * perceptores sin ficha; en el 303 del último periodo, exoneración del 390 y CNAE de la prorrata)
 * se piden en un desplegable opcional y la ruta los valida. No pinta nada en los modelos sin fichero.
 */
export function FiscalFileDownloads({ code, reportId }: { code: string; reportId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [params, setParams] = useState<DownloadParams>(EMPTY_PARAMS);

  if (!hasPresentationFile(code)) return null;
  const set = (patch: Partial<DownloadParams>) => setParams((current) => ({ ...current, ...patch }));
  const asksProvince = (PROVINCE_PARAMETER_MODELS as readonly string[]).includes(code);

  async function download() {
    setState("loading");
    setMessage(null);
    setWarnings([]);
    try {
      const response = await fetch(`/api/fiscal-files/presentation/${encodeURIComponent(reportId)}${queryOf(code, params)}`);
      if (!response.ok) throw new Error(await readApiError(response, FAILURE));
      const fileName = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? `${code}.txt`;
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setWarnings(readWarnings(response.headers.get("X-Fiscal-File-Warnings")));
      setState("done");
      setMessage(`Fichero descargado (${fileName}).`);
      toast.success("Fichero para la sede descargado.");
    } catch (error) {
      const text = errorMessage(error, FAILURE);
      setState("error");
      setMessage(text);
      toast.error(FAILURE);
    }
  }

  return (
    <section aria-label="Fichero para la sede de la AEAT" className="space-y-2 rounded-md border border-border bg-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button aria-busy={state === "loading"} disabled={state === "loading"} onClick={() => void download()} type="button" variant="secondary">
          <DownloadSimple aria-hidden="true" />
          {state === "loading" ? "Generando el fichero…" : "Descargar fichero para la Sede de la AEAT"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Impórtalo en la sede y revísalo antes de firmar. <span className="text-xs">{PRESENTATION_FILE_DESIGNS[code]}.</span>
        </p>
      </div>
      {asksProvince || code === "303" ? (
        <details className="rounded-md border border-border p-2 text-sm">
          <summary className="cursor-pointer font-medium">Datos para el fichero que el programa no guarda (opcional)</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {asksProvince ? (
              <div className="space-y-1">
                <Label htmlFor={`ff-province-${reportId}`}>Provincia de los perceptores sin ficha (dos dígitos)</Label>
                <Input id={`ff-province-${reportId}`} inputMode="numeric" maxLength={2} onChange={(event) => set({ province: event.target.value.replace(/\D/g, "") })} placeholder="28" value={params.province} />
                <p className="text-xs text-muted-foreground">Se usa para los trabajadores y terceros sin código postal en su ficha (98 si residen en el extranjero).</p>
              </div>
            ) : null}
            {code === "303" ? (
              <>
                <p className="text-xs text-muted-foreground sm:col-span-2">Solo en el último periodo del año (4T o diciembre).</p>
                <label className="flex items-center gap-2 sm:col-span-2">
                  <input checked={params.exemptFrom390} onChange={(event) => set({ exemptFrom390: event.target.checked })} type="checkbox" />
                  Estoy exonerado de presentar el 390 (incluir el volumen de operaciones)
                </label>
                {params.exemptFrom390 ? (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor={`ff-activity-${reportId}`}>Actividad principal</Label>
                      <Select id={`ff-activity-${reportId}`} onChange={(event) => set({ activityCode: event.target.value })} value={params.activityCode}>
                        <option value="">Elige la actividad…</option>
                        {MODELO_303_ACTIVITY_CODES.map((activity) => <option key={activity} value={activity}>{activity} · {MODELO_303_ACTIVITY_LABELS[activity]}</option>)}
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`ff-iae-${reportId}`}>Epígrafe del IAE</Label>
                      <Input id={`ff-iae-${reportId}`} inputMode="numeric" maxLength={5} onChange={(event) => set({ iaeCode: event.target.value })} placeholder="8499" value={params.iaeCode} />
                    </div>
                    <label className="flex items-center gap-2 sm:col-span-2">
                      <input checked={params.has347Operations} onChange={(event) => set({ has347Operations: event.target.checked })} type="checkbox" />
                      He hecho operaciones que hay que declarar en el 347
                    </label>
                  </>
                ) : null}
                <div className="space-y-1">
                  <Label htmlFor={`ff-cnae-${reportId}`}>CNAE-2025 de la actividad (si aplicas prorrata)</Label>
                  <Input id={`ff-cnae-${reportId}`} inputMode="numeric" maxLength={4} onChange={(event) => set({ cnae: event.target.value.replace(/\D/g, "") })} placeholder="6201" value={params.cnae} />
                </div>
              </>
            ) : null}
          </div>
        </details>
      ) : null}
      <div aria-live="polite" role="status">
        {message ? <p className={state === "error" ? "text-sm text-danger-text" : "text-sm text-muted-foreground"}>{message}</p> : null}
        {warnings.length > 0 ? (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

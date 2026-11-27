"use client";

import { DownloadSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const FAILURE = "No se pudieron generar los libros en formato de la AEAT.";

/**
 * Descarga de los libros registro en el formato electrónico de la AEAT (un XLSX con una pestaña por
 * libro). La actividad es opcional: la AEAT la pide para distinguir a qué actividad corresponde
 * cada asiento y el programa no la guarda.
 */
export function AeatBooksDownload({ year, defaultQuarter }: { year: number; defaultQuarter: number }) {
  const [quarter, setQuarter] = useState(String(defaultQuarter));
  const [activityCode, setActivityCode] = useState("");
  const [activityType, setActivityType] = useState("");
  const [iae, setIae] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function download() {
    setState("loading");
    setMessage(null);
    try {
      const query = new URLSearchParams({ year: String(year), quarter });
      if (activityCode) query.set("activityCode", activityCode);
      if (activityType) query.set("activityType", activityType);
      if (iae.trim()) query.set("iae", iae.trim());
      const response = await fetch(`/api/fiscal-files/books?${query.toString()}`);
      if (!response.ok) throw new Error(await readApiError(response, FAILURE));
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
      const fileName = encoded ? decodeURIComponent(encoded) : "libros-registro-aeat.xlsx";
      const [issued, received, assets] = (response.headers.get("X-Lsi-Rows") ?? "").split(",");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setState("done");
      setMessage(`Descargado ${fileName}: ${issued ?? 0} filas de expedidas, ${received ?? 0} de recibidas y ${assets ?? 0} bienes de inversión.`);
      toast.success("Libros en formato de la AEAT descargados.");
    } catch (error) {
      const text = errorMessage(error, FAILURE);
      setState("error");
      setMessage(text);
      toast.error(FAILURE);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="aeat-books-quarter">Desde el 1 de enero hasta</Label>
          <Select className="w-52" id="aeat-books-quarter" onChange={(event) => setQuarter(event.target.value)} value={quarter}>
            <option value="1">el final del 1.er trimestre</option>
            <option value="2">el final del 2.º trimestre</option>
            <option value="3">el final del 3.er trimestre</option>
            <option value="4">el final del año</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="aeat-books-activity">Actividad (opcional)</Label>
          <Select className="w-64" id="aeat-books-activity" onChange={(event) => setActivityCode(event.target.value)} value={activityCode}>
            <option value="">Sin indicar</option>
            <option value="A">A · Incluida en el IAE</option>
            <option value="B">B · No incluida en el IAE</option>
            <option value="C">C · Actividad no iniciada</option>
            <option value="D">D · Arrendador de inmuebles</option>
          </Select>
        </div>
        {activityCode === "A" || activityCode === "B" ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="aeat-books-type">Tipo</Label>
              <Select className="w-72" id="aeat-books-type" onChange={(event) => setActivityType(event.target.value)} value={activityType}>
                <option value="">Sin indicar</option>
                {activityCode === "A" ? (
                  <>
                    <option value="01">01 · Arrendamiento de inmuebles</option>
                    <option value="02">02 · Ganadería independiente</option>
                    <option value="03">03 · Resto de actividades empresariales</option>
                    <option value="04">04 · Profesionales artísticas o deportivas</option>
                    <option value="05">05 · Resto de actividades profesionales</option>
                  </>
                ) : (
                  <>
                    <option value="01">01 · Agrícola</option>
                    <option value="02">02 · Ganadera dependiente</option>
                    <option value="03">03 · Forestal</option>
                    <option value="04">04 · Mejillón en batea</option>
                    <option value="05">05 · Pesquera</option>
                    <option value="06">06 · Otras no sujetas al IAE</option>
                  </>
                )}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="aeat-books-iae">Grupo o epígrafe del IAE</Label>
              <Input className="w-32" id="aeat-books-iae" inputMode="numeric" maxLength={4} onChange={(event) => setIae(event.target.value)} placeholder="6533" value={iae} />
            </div>
          </>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button aria-busy={state === "loading"} disabled={state === "loading"} onClick={() => void download()} type="button" variant="secondary">
          <DownloadSimple aria-hidden="true" />
          {state === "loading" ? "Generando los libros…" : "Descargar libros en formato AEAT (XLSX)"}
        </Button>
        <p aria-live="polite" className={state === "error" ? "text-sm text-danger-text" : "text-sm text-muted-foreground"} role="status">
          {message ?? ""}
        </p>
      </div>
    </div>
  );
}

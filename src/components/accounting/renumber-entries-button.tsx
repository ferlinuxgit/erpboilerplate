"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { errorMessage as describeError, readApiError } from "@/components/ui/form";
import { InlineAlert } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCsrfHeader } from "@/lib/csrf-client";

type Preview = {
  yearCode: string;
  total: number;
  changes: number;
  sample: Array<{ id: string; day: string; reference: string | null; from: string; to: string }>;
  blockedReason: string | null;
};

const count = (value: number) => new Intl.NumberFormat("es-ES").format(value);
const formatDay = (key: string) => key.slice(0, 10).split("-").reverse().join("/");

/**
 * «Renumerar asientos del ejercicio por fecha»: abre una vista previa (cuántos asientos cambian de
 * número y los primeros cambios) y solo renumera al confirmar.
 */
export function RenumberEntriesButton({ fiscalYearId, yearCode }: { fiscalYearId: string; yearCode: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/accounting/fiscal-years/${encodeURIComponent(fiscalYearId)}/renumber`;

  async function openPreview() {
    setOpen(true);
    setPreview(null);
    setError(null);
    setBusy("preview");
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo calcular la renumeración."));
      setPreview((await response.json()) as Preview);
    } catch (loadError) {
      setError(describeError(loadError, "No se pudo calcular la renumeración."));
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    setBusy("apply");
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ confirm: true }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudieron renumerar los asientos."));
      const result = (await response.json()) as { changed: number };
      setOpen(false);
      toast.success(result.changed === 0 ? "Los asientos ya estaban en orden." : `${count(result.changed)} ${result.changed === 1 ? "asiento renumerado" : "asientos renumerados"} por fecha.`);
      router.refresh();
    } catch (applyError) {
      setError(describeError(applyError, "No se pudieron renumerar los asientos."));
    } finally {
      setBusy(null);
    }
  }

  const canApply = Boolean(preview && !preview.blockedReason && preview.changes > 0);

  return (
    <>
      <Button onClick={() => void openPreview()} size="sm" type="button" variant="outline">
        Renumerar asientos de {yearCode} por fecha
      </Button>
      <Dialog
        description="El número de cada asiento seguirá el orden de las fechas, como en el Libro Diario: apertura primero, operaciones día a día y regularización y cierre al final. No cambia ningún importe ni ninguna fecha."
        initialFocusId="renumber-entries-cancel"
        onClose={() => { if (busy !== "apply") setOpen(false); }}
        open={open}
        size="lg"
        title={`Renumerar asientos del ejercicio ${yearCode} por fecha`}
      >
        <div className="space-y-3">
          {busy === "preview" ? <p className="text-xs text-muted-foreground" role="status">Calculando qué asientos cambiarían…</p> : null}
          {preview?.blockedReason ? <InlineAlert title="Este ejercicio no se puede renumerar" tone="warning">{preview.blockedReason}</InlineAlert> : null}
          {preview && !preview.blockedReason && preview.changes === 0 ? (
            <InlineAlert tone="success">Los {count(preview.total)} asientos del ejercicio ya están numerados por orden de fecha. No hay nada que cambiar.</InlineAlert>
          ) : null}
          {preview && !preview.blockedReason && preview.changes > 0 ? (
            <>
              <InlineAlert title={`${count(preview.changes)} de ${count(preview.total)} asientos cambiarán de número`} tone="warning">
                Si ya has entregado listados o libros con los números actuales (al gestor, a un auditor…), dejarán de coincidir. El cambio queda anotado en la auditoría con el número antiguo y el nuevo de cada asiento.
              </InlineAlert>
              <TableContainer label="Primeros cambios de número">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Referencia</TableHead>
                      <TableHead>Número actual</TableHead>
                      <TableHead>Número nuevo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sample.map((change) => (
                      <TableRow key={change.id}>
                        <TableCell className="whitespace-nowrap">{formatDay(change.day)}</TableCell>
                        <TableCell>{change.reference ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{change.from}</TableCell>
                        <TableCell className="whitespace-nowrap font-bold">{change.to}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {preview.changes > preview.sample.length ? (
                <p className="text-xs text-muted-foreground">Se muestran los {preview.sample.length} primeros cambios de {count(preview.changes)}.</p>
              ) : null}
            </>
          ) : null}
          {error ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}
        </div>
        <DialogFooter>
          <Button disabled={busy === "apply"} id="renumber-entries-cancel" onClick={() => setOpen(false)} type="button" variant="outline">
            {canApply ? "Cancelar" : "Cerrar"}
          </Button>
          {canApply ? (
            <Button disabled={busy !== null} onClick={() => void apply()} type="button" variant="destructive">
              {busy === "apply" ? "Renumerando…" : `Renumerar ${count(preview?.changes ?? 0)} ${preview?.changes === 1 ? "asiento" : "asientos"}`}
            </Button>
          ) : null}
        </DialogFooter>
      </Dialog>
    </>
  );
}

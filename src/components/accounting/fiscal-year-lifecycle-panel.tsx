"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { errorMessage as describeError, readApiError } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { InlineAlert } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { invalidateActiveContext } from "@/lib/active-context-client";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate } from "@/lib/format";

export type FiscalYearLifecycleView = {
  companyId: string;
  activeYear: { id: string; code: string; startsAt: string; endsAt: string; isClosed: boolean };
  nextYear: { id: string; code: string } | null;
  nextYearCode: string;
  daysUntilEnd: number;
  alert: "none" | "ending-soon" | "ended";
};

type FiscalYearLifecyclePanelProps = {
  lifecycle: FiscalYearLifecycleView;
  canWrite: boolean;
  /** Muestra "Reabrir ejercicio" si el activo está cerrado. Por defecto = canWrite; el servidor exige OWNER. */
  canReopen?: boolean;
  /** "panel": bloque completo en Contabilidad. "alert": solo aviso compacto (otras páginas). */
  variant?: "panel" | "alert";
};

async function switchActiveYear(companyId: string, fiscalYearId: string) {
  const response = await fetch("/api/context/active", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getCsrfHeader() },
    body: JSON.stringify({ companyId, fiscalYearId }),
  });
  if (!response.ok) throw new Error(await readApiError(response, "No se pudo cambiar de ejercicio. Cámbialo desde el selector superior."));
  invalidateActiveContext();
}

function alertText(lifecycle: FiscalYearLifecycleView) {
  if (lifecycle.alert === "ended") {
    return `El ejercicio ${lifecycle.activeYear.code} terminó el ${formatDate(lifecycle.activeYear.endsAt)}. Para registrar facturas, cobros o movimientos con fecha posterior necesitas el ejercicio ${lifecycle.nextYearCode}.`;
  }
  return `El ejercicio ${lifecycle.activeYear.code} termina en ${lifecycle.daysUntilEnd} ${lifecycle.daysUntilEnd === 1 ? "día" : "días"} (${formatDate(lifecycle.activeYear.endsAt)}). Abre el ${lifecycle.nextYearCode} con antelación para seguir trabajando sin cortes.`;
}

const REOPEN_REASON_MIN = 5;
const CLOSE_REASON_MIN = 5;

type CloseChecklistView = {
  items: Array<{ id: string; title: string; status: "ok" | "pending" | "blocking" | "review"; detail: string; href?: string; actionLabel?: string }>;
  blocked: boolean;
  requiresOverride: boolean;
};

const checklistTone = { ok: "success", pending: "warning", blocking: "danger", review: "info" } as const;
const checklistLabel = { ok: "Correcto", pending: "Pendiente", blocking: "Bloquea", review: "Revisar" } as const;
const REOPEN_REASON_MAX = 500;

export function FiscalYearLifecyclePanel({ canReopen, canWrite, lifecycle, variant = "panel" }: FiscalYearLifecyclePanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<"open" | "switch" | "close" | "reopen" | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ code: string; openingEntryId: string | null; openingPending: boolean; created: boolean } | null>(null);
  const [checklist, setChecklist] = useState<CloseChecklistView | null>(null);
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const { activeYear, nextYear, nextYearCode } = lifecycle;
  const showReopen = (canReopen ?? canWrite) && activeYear.isClosed;

  async function reopenYear() {
    const reason = reopenReason.trim();
    if (reason.length < REOPEN_REASON_MIN) {
      setReopenError(`Indica el motivo de la reapertura (mínimo ${REOPEN_REASON_MIN} caracteres).`);
      return;
    }
    setBusy("reopen");
    setReopenError(null);
    try {
      const response = await fetch(`/api/accounting/fiscal-years/${encodeURIComponent(activeYear.id)}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ confirm: true, reason }),
      });
      if (!response.ok) throw new Error(await readApiError(response, `No se pudo reabrir el ejercicio ${activeYear.code}.`));
      setConfirmReopen(false);
      setReopenReason("");
      toast.success(`Ejercicio ${activeYear.code} reabierto. Se han anulado los asientos de cierre${nextYear ? ` y la apertura de ${nextYear.code}` : ""}.`);
      router.refresh();
    } catch (error) {
      setReopenError(describeError(error, `No se pudo reabrir el ejercicio ${activeYear.code}.`));
    } finally {
      setBusy(null);
    }
  }

  async function openNextYear() {
    setBusy("open");
    try {
      const response = await fetch("/api/accounting/fiscal-years", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ fromFiscalYearId: activeYear.id }),
      });
      if (!response.ok) throw new Error(await readApiError(response, `No se pudo abrir el ejercicio ${nextYearCode}.`));
      const payload = (await response.json()) as { fiscalYear: { id: string; code: string }; created: boolean; openingEntryId: string | null; openingPending: boolean };
      // No se cambia de ejercicio automáticamente: el usuario sigue en el actual para poder cerrarlo.
      setOpened({ code: payload.fiscalYear.code, openingEntryId: payload.openingEntryId, openingPending: payload.openingPending, created: payload.created });
      toast.success(`${payload.created ? "Ejercicio" : "Ya existía el ejercicio"} ${payload.fiscalYear.code}${payload.created ? " abierto" : ""}. Sigues trabajando en ${activeYear.code}.`);
      router.refresh();
    } catch (error) {
      toast.error(describeError(error, `No se pudo abrir el ejercicio ${nextYearCode}.`));
    } finally {
      setBusy(null);
    }
  }

  async function goToNextYear() {
    if (!nextYear) return;
    setBusy("switch");
    try {
      await switchActiveYear(lifecycle.companyId, nextYear.id);
      toast.success(`Ahora trabajas en el ejercicio ${nextYear.code}.`);
      router.refresh();
    } catch (error) {
      toast.error(describeError(error, "No se pudo cambiar de ejercicio."));
    } finally {
      setBusy(null);
    }
  }

  async function loadChecklist() {
    setChecklist(null);
    setChecklistError(null);
    try {
      const response = await fetch(`/api/accounting/fiscal-years/${encodeURIComponent(activeYear.id)}/close-checklist`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudieron revisar las comprobaciones del cierre."));
      setChecklist((await response.json()) as CloseChecklistView);
    } catch (error) {
      setChecklistError(describeError(error, "No se pudieron revisar las comprobaciones del cierre."));
    }
  }

  function openCloseDialog() {
    setCloseError(null);
    setOverrideReason("");
    setConfirmClose(true);
    void loadChecklist();
  }

  async function closeYear() {
    setBusy("close");
    setCloseError(null);
    try {
      const response = await fetch("/api/accounting/close-year", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ fiscalYearId: activeYear.id, overrideReason: overrideReason.trim() || undefined }),
      });
      if (!response.ok) throw new Error(await readApiError(response, `No se pudo cerrar el ejercicio ${activeYear.code}.`));
      const payload = (await response.json()) as { alreadyClosed: boolean; openingEntryId: string | null };
      setConfirmClose(false);
      setOpened(null);
      toast.success(payload.alreadyClosed
        ? `El ejercicio ${activeYear.code} ya estaba cerrado.`
        : `Ejercicio ${activeYear.code} cerrado.${payload.openingEntryId ? ` Saldos trasladados a ${nextYearCode}.` : ""}`);
      router.refresh();
    } catch (error) {
      const message = describeError(error, `No se pudo cerrar el ejercicio ${activeYear.code}.`);
      setCloseError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  const needsReason = checklist?.requiresOverride ?? false;
  const canConfirmClose = checklist !== null && !checklist.blocked && (!needsReason || overrideReason.trim().length >= CLOSE_REASON_MIN);

  const openButton = nextYear ? (
    <Button disabled={busy !== null} onClick={() => void goToNextYear()} size="sm" type="button">
      {busy === "switch" ? "Cambiando…" : `Trabajar en ${nextYear.code}`}
    </Button>
  ) : (
    <Button aria-busy={busy === "open"} disabled={!canWrite || busy !== null} onClick={() => void openNextYear()} size="sm" type="button">
      {busy === "open" ? "Abriendo…" : `Abrir ejercicio ${nextYearCode}`}
    </Button>
  );

  if (variant === "alert") {
    if (lifecycle.alert === "none") return null;
    if (nextYear && lifecycle.alert === "ending-soon") return null;
    return (
      <InlineAlert title={lifecycle.alert === "ended" ? "Ejercicio terminado" : "El ejercicio está a punto de terminar"} tone={lifecycle.alert === "ended" ? "danger" : "warning"}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p>{alertText(lifecycle)}</p>
          {canWrite || nextYear ? openButton : <p>Pide a un administrador que abra el ejercicio {nextYearCode}.</p>}
        </div>
      </InlineAlert>
    );
  }

  return (
    <div className="space-y-3">
      {lifecycle.alert !== "none" && !(nextYear && lifecycle.alert === "ending-soon") ? (
        <InlineAlert tone={lifecycle.alert === "ended" ? "danger" : "warning"}>{alertText(lifecycle)}</InlineAlert>
      ) : null}
      {opened ? (
        <InlineAlert title={`Ejercicio ${opened.code} ${opened.created ? "abierto" : "disponible"}`} tone="success">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Sigues trabajando en {activeYear.code}.{" "}
              {opened.openingEntryId
                ? "El asiento de apertura ya está generado."
                : opened.openingPending
                  ? `Los saldos pasarán a ${opened.code} cuando cierres ${activeYear.code}.`
                  : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              {canWrite && !activeYear.isClosed ? (
                <Button disabled={busy !== null} onClick={openCloseDialog} size="sm" type="button">
                  Cerrar {activeYear.code} ahora
                </Button>
              ) : null}
              {nextYear ? (
                <Button disabled={busy !== null} onClick={() => void goToNextYear()} size="sm" type="button" variant="outline">
                  Trabajar en {nextYear.code}
                </Button>
              ) : null}
            </div>
          </div>
        </InlineAlert>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2 rounded-[2px] border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">Ejercicio {activeYear.code}</p>
            <StatusBadge tone={activeYear.isClosed ? "neutral" : "success"}>{activeYear.isClosed ? "Cerrado" : "Abierto"}</StatusBadge>
          </div>
          <p className="text-sm text-muted-foreground">
            Del {formatDate(activeYear.startsAt)} al {formatDate(activeYear.endsAt)}.
          </p>
          <p className="text-xs text-muted-foreground">
            Cerrar {activeYear.code}: pasa gastos e ingresos a la cuenta de resultado (129), salda las cuentas de balance y, si {nextYearCode} ya existe, traslada los saldos con el asiento de apertura. Después no se podrán registrar operaciones con fecha de {activeYear.code}.
          </p>
          {canWrite && !activeYear.isClosed ? (
            <Button disabled={busy !== null} onClick={openCloseDialog} size="sm" type="button" variant="outline">
              Cerrar ejercicio {activeYear.code}
            </Button>
          ) : null}
          {showReopen ? (
            <Button disabled={busy !== null} onClick={() => { setReopenError(null); setConfirmReopen(true); }} size="sm" type="button" variant="outline">
              Reabrir ejercicio {activeYear.code}
            </Button>
          ) : null}
        </div>
        <div className="space-y-2 rounded-[2px] border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">Ejercicio {nextYearCode}</p>
            <StatusBadge tone={nextYear ? "success" : "neutral"}>{nextYear ? "Creado" : "Sin abrir"}</StatusBadge>
          </div>
          <p className="text-xs text-muted-foreground">
            {nextYear
              ? `El ejercicio ${nextYear.code} ya existe. Cambia a él para registrar operaciones con fechas de ese año; puedes seguir cerrando ${activeYear.code} desde aquí.`
              : `Abrir ejercicio ${nextYearCode}: crea el nuevo ejercicio con sus series de numeración y traslada los saldos (asiento de apertura) en cuanto ${activeYear.code} esté cerrado. Podrás seguir trabajando en ${activeYear.code} mientras tanto.`}
          </p>
          {canWrite || nextYear ? openButton : <p className="text-xs text-muted-foreground">Necesitas permisos de contabilidad para abrir ejercicios.</p>}
        </div>
      </div>
      <Dialog
        description={`Se generarán los asientos de regularización y cierre con fecha ${formatDate(activeYear.endsAt)} y el ejercicio quedará bloqueado: no se podrán registrar operaciones con fecha de ${activeYear.code}.`}
        initialFocusId="close-fiscal-year-cancel"
        onClose={() => { if (busy !== "close") setConfirmClose(false); }}
        open={confirmClose}
        size="lg"
        title={`¿Cerrar el ejercicio ${activeYear.code}?`}
      >
        <div className="space-y-3">
          <p className="text-sm font-medium">Comprobaciones antes del cierre</p>
          {checklistError ? <InlineAlert role="alert" tone="danger">{checklistError}</InlineAlert> : null}
          {checklist === null && !checklistError ? <p aria-live="polite" className="text-sm text-muted-foreground">Revisando…</p> : null}
          {checklist ? (
            <ul aria-label="Comprobaciones antes del cierre" className="divide-y divide-window-shadow rounded-[2px] border border-window-dark-shadow">
              {checklist.items.map((item) => (
                <li className="flex flex-col gap-1 p-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3" key={item.id}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                    {item.status !== "ok" && item.href ? (
                      <Link className="link text-xs" href={item.href}>{item.actionLabel ?? "Resolver"}</Link>
                    ) : null}
                  </div>
                  <StatusBadge tone={checklistTone[item.status]}>{checklistLabel[item.status]}</StatusBadge>
                </li>
              ))}
            </ul>
          ) : null}
          {checklist?.blocked ? (
            <InlineAlert tone="danger">Corrige lo marcado como «Bloquea» antes de cerrar.</InlineAlert>
          ) : null}
          {checklist && !checklist.blocked && needsReason ? (
            <div className="space-y-1.5">
              <Label htmlFor="close-fiscal-year-reason">Motivo para cerrar con comprobaciones pendientes</Label>
              <Textarea
                aria-describedby="close-fiscal-year-reason-help"
                disabled={busy === "close"}
                id="close-fiscal-year-reason"
                maxLength={500}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Ej.: el 303 lo presenta la gestoría el 30 de enero"
                rows={2}
                value={overrideReason}
              />
              <p className="text-xs text-muted-foreground" id="close-fiscal-year-reason-help">Mínimo {CLOSE_REASON_MIN} caracteres. Queda registrado en la auditoría.</p>
            </div>
          ) : null}
          {closeError ? <InlineAlert role="alert" tone="danger">{closeError}</InlineAlert> : null}
        </div>
        <DialogFooter>
          <Button disabled={busy === "close"} id="close-fiscal-year-cancel" onClick={() => setConfirmClose(false)} type="button" variant="outline">
            Cancelar
          </Button>
          <Button disabled={busy === "close" || !canConfirmClose} onClick={() => void closeYear()} type="button" variant="destructive">
            {busy === "close" ? "Cerrando…" : needsReason ? `Cerrar ${activeYear.code} igualmente` : `Cerrar ${activeYear.code}`}
          </Button>
        </DialogFooter>
      </Dialog>
      {showReopen ? (
        <Dialog
          description={`Se anularán con asientos inversos (sin borrar nada) los asientos de regularización y cierre de ${activeYear.code}${nextYear ? ` y el asiento de apertura de ${nextYear.code}` : ""}. El ejercicio volverá a admitir operaciones y podrás cerrarlo de nuevo cuando termines.`}
          initialFocusId="reopen-fiscal-year-cancel"
          onClose={() => { if (busy !== "reopen") setConfirmReopen(false); }}
          open={confirmReopen}
          size="sm"
          title={`¿Reabrir el ejercicio ${activeYear.code}?`}
        >
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Solo el propietario de la cuenta puede reabrir un ejercicio y la acción queda registrada en la auditoría. Los ejercicios posteriores tienen que estar abiertos.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="reopen-fiscal-year-reason">Motivo de la reapertura</Label>
              <Textarea
                disabled={busy === "reopen"}
                id="reopen-fiscal-year-reason"
                maxLength={REOPEN_REASON_MAX}
                minLength={REOPEN_REASON_MIN}
                onChange={(event) => setReopenReason(event.target.value)}
                placeholder="Ej.: factura de diciembre registrada tarde"
                required
                rows={3}
                value={reopenReason}
              />
            </div>
            {reopenError ? <InlineAlert role="alert" tone="danger">{reopenError}</InlineAlert> : null}
          </div>
          <DialogFooter>
            <Button disabled={busy === "reopen"} id="reopen-fiscal-year-cancel" onClick={() => setConfirmReopen(false)} type="button" variant="outline">
              Cancelar
            </Button>
            <Button
              disabled={busy === "reopen" || reopenReason.trim().length < REOPEN_REASON_MIN}
              onClick={() => void reopenYear()}
              type="button"
              variant="destructive"
            >
              {busy === "reopen" ? "Procesando…" : `Reabrir ${activeYear.code}`}
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </div>
  );
}

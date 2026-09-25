"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  describeJournalEntryBlockers,
  emptyJournalLine,
  normalizeJournalLinesForSubmit,
  type JournalFormLine,
} from "@/components/accounting/journal-entry-utils";
import { JournalLinesEditor, type JournalAccountOption } from "@/components/accounting/journal-lines-editor";
import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCsrfHeader } from "@/lib/csrf-client";

type CreateJournalEntryFormProps = {
  accounts: JournalAccountOption[];
  redirectHref?: string;
  /** Fecha propuesta (hoy en la zona horaria de la empresa), "YYYY-MM-DD". */
  defaultPostedAt?: string;
};

export function CreateJournalEntryForm({ accounts, defaultPostedAt = "", redirectHref }: CreateJournalEntryFormProps) {
  const router = useRouter();
  const [postedAt, setPostedAt] = useState(defaultPostedAt);
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<JournalFormLine[]>(() => [emptyJournalLine(), emptyJournalLine()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blockers = describeJournalEntryBlockers({ postedAt, lines });
  const canSubmit = blockers.length === 0;
  const errorId = error ? "create-journal-entry-error" : undefined;

  return (
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault();
      if (!canSubmit) {
        setError(blockers[0] ?? "Revisa el asiento antes de guardarlo.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/journal-entries", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify({ postedAt, reference, lines: normalizeJournalLinesForSubmit(lines) }),
        });
        if (!res.ok) throw new Error(await readApiError(res, "No se pudo crear el asiento."));
        const created = (await res.json().catch(() => null)) as { number?: string } | null;
        toast.success(created?.number ? `Asiento ${created.number} creado.` : "Asiento creado.");
        setReference("");
        setLines([emptyJournalLine(), emptyJournalLine()]);
        if (redirectHref) {
          router.push(redirectHref);
        } else {
          router.refresh();
        }
      } catch (submissionError) {
        const message = errorMessage(submissionError, "No se pudo crear el asiento.");
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    }}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="journal-posted-at">Fecha</Label>
          <Input id="journal-posted-at" type="date" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} required aria-describedby={errorId} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="journal-reference">Referencia</Label>
          <Input id="journal-reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ej.: Amortización 2026, cuota de autónomos de marzo…" aria-describedby={errorId} />
        </div>
      </div>
      <JournalLinesEditor accounts={accounts} errorId={errorId} lines={lines} onChange={setLines} />
      {error ? <p id="create-journal-entry-error" className="text-sm text-danger-text" role="alert">{error}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <Button aria-describedby={canSubmit ? undefined : "create-journal-entry-blockers"} type="submit" disabled={loading || !canSubmit}>
          {loading ? "Guardando…" : "Crear asiento"}
        </Button>
        {!canSubmit ? (
          <div className="text-xs text-muted-foreground" id="create-journal-entry-blockers">
            <p className="font-medium">Para poder guardar:</p>
            <ul className="list-disc pl-4">
              {blockers.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </form>
  );
}

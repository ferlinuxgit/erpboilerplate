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

export function EditJournalEntryForm({
  id,
  accounts,
  defaultPostedAt,
  defaultReference,
  defaultLines,
}: {
  id: string;
  accounts: JournalAccountOption[];
  defaultPostedAt: string;
  defaultReference: string;
  defaultLines: JournalFormLine[];
}) {
  const router = useRouter();
  const [postedAt, setPostedAt] = useState(defaultPostedAt);
  const [reference, setReference] = useState(defaultReference);
  const [lines, setLines] = useState<JournalFormLine[]>(defaultLines.length >= 2 ? defaultLines : [emptyJournalLine(), emptyJournalLine()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blockers = describeJournalEntryBlockers({ postedAt, lines });
  const canSubmit = blockers.length === 0;
  const errorId = error ? "edit-journal-entry-error" : undefined;

  return (
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault();
      if (!canSubmit) {
        setError(blockers[0] ?? "Revisa el asiento antes de guardarlo.");
        return;
      }
      setError(null);
      setLoading(true);
      try {
        const response = await fetch(`/api/journal-entries/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify({ postedAt, reference, lines: normalizeJournalLinesForSubmit(lines) }),
        });
        if (!response.ok) throw new Error(await readApiError(response, "No se pudo actualizar el asiento."));
        toast.success("Asiento actualizado.");
        router.push(`/accounting/entries/${id}`);
        router.refresh();
      } catch (submissionError) {
        const message = errorMessage(submissionError, "No se pudo actualizar el asiento.");
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
          <Input id="journal-reference" value={reference} onChange={(e) => setReference(e.target.value)} aria-describedby={errorId} />
        </div>
      </div>
      <JournalLinesEditor accounts={accounts} errorId={errorId} lines={lines} onChange={setLines} />
      {error ? <p id="edit-journal-entry-error" className="text-sm text-danger-text" role="alert">{error}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <Button aria-describedby={canSubmit ? undefined : "edit-journal-entry-blockers"} type="submit" disabled={!canSubmit || loading}>
          {loading ? "Guardando…" : "Guardar cambios"}
        </Button>
        {!canSubmit ? (
          <div className="text-xs text-muted-foreground" id="edit-journal-entry-blockers">
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

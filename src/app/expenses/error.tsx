"use client";

import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page";

export default function ExpensesError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <PageShell>
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-900">
        <p className="font-medium">No se pudo cargar Gastos.</p>
        <p className="mt-1 text-sm">{error.message}</p>
        <Button className="mt-4" onClick={reset} type="button" variant="outline">
          Reintentar
        </Button>
      </div>
    </PageShell>
  );
}

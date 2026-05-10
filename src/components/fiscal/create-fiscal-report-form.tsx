"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCsrfHeader } from "@/lib/csrf-client";

const statuses = ["DRAFT", "READY", "FILED"] as const;

export function CreateFiscalReportForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState<(typeof statuses)[number]>("DRAFT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = error ? "fiscal-report-error" : undefined;

  return (
    <form className="grid gap-4 md:grid-cols-4" onSubmit={async (event) => {
      event.preventDefault();
      setError(null);
      setLoading(true);
      try {
        const response = await fetch("/api/fiscal-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify({ code, period, status }),
        });
        if (!response.ok) {
          const payload = (await response.json()) as { message?: string };
          throw new Error(payload.message ?? "No se pudo crear el reporte fiscal.");
        }
        setCode("");
        setPeriod("");
        setStatus("DRAFT");
        toast.success("Reporte fiscal creado correctamente.");
        router.refresh();
      } catch (submissionError) {
        const message = submissionError instanceof Error ? submissionError.message : "Error inesperado.";
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    }}>
      <div className="space-y-2">
        <Label htmlFor="fiscal-report-code">Modelo</Label>
        <Input
          id="fiscal-report-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          aria-describedby={errorId}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="fiscal-report-period">Periodo</Label>
        <Input
          id="fiscal-report-period"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          placeholder="2026-04"
          required
          aria-describedby={errorId}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="fiscal-report-status">Estado</Label>
        <select
          id="fiscal-report-status"
          className="h-8 rounded-md border px-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as (typeof statuses)[number])}
          aria-describedby={errorId}
        >
          {statuses.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
      <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Crear reporte"}</Button>
      {error ? <p id="fiscal-report-error" className="text-sm text-red-600 md:col-span-4" role="alert">{error}</p> : null}
    </form>
  );
}

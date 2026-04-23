"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";

const statuses = ["DRAFT", "READY", "FILED"] as const;

export function CreateFiscalReportForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState<(typeof statuses)[number]>("DRAFT");
  const [loading, setLoading] = useState(false);
  return (
    <form className="grid gap-2 md:grid-cols-4" onSubmit={async (event) => {
      event.preventDefault();
      setLoading(true);
      await fetch("/api/fiscal-reports", { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify({ code, period, status }) });
      setCode(""); setPeriod(""); setStatus("DRAFT");
      router.refresh(); setLoading(false);
    }}>
      <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Modelo" required />
      <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-04" required />
      <select className="h-8 rounded-md border px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as (typeof statuses)[number])}>
        {statuses.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Crear reporte"}</Button>
    </form>
  );
}

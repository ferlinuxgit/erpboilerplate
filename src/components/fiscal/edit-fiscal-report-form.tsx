"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const statuses = ["DRAFT", "READY", "FILED"] as const;

export function EditFiscalReportForm({
  id,
  defaultCode,
  defaultPeriod,
  defaultStatus,
}: {
  id: string;
  defaultCode: string;
  defaultPeriod: string;
  defaultStatus: (typeof statuses)[number];
}) {
  const router = useRouter();
  const [code, setCode] = useState(defaultCode);
  const [period, setPeriod] = useState(defaultPeriod);
  const [status, setStatus] = useState<(typeof statuses)[number]>(defaultStatus);
  return (
    <form className="grid gap-3" onSubmit={async (event) => {
      event.preventDefault();
      await fetch(`/api/fiscal-reports/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, period, status }) });
      router.push("/fiscal");
      router.refresh();
    }}>
      <Input value={code} onChange={(e) => setCode(e.target.value)} required />
      <Input value={period} onChange={(e) => setPeriod(e.target.value)} required />
      <select className="h-8 rounded-md border px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as (typeof statuses)[number])}>
        {statuses.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <Button type="submit">Guardar cambios</Button>
    </form>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const accountTypes = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;

export function EditAccountForm({ id, defaultCode, defaultName, defaultType }: { id: string; defaultCode: string; defaultName: string; defaultType: (typeof accountTypes)[number] }) {
  const router = useRouter();
  const [code, setCode] = useState(defaultCode);
  const [name, setName] = useState(defaultName);
  const [type, setType] = useState<(typeof accountTypes)[number]>(defaultType);
  const [loading, setLoading] = useState(false);
  return (
    <form className="grid gap-2" onSubmit={async (event) => {
      event.preventDefault();
      setLoading(true);
      await fetch(`/api/accounts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name, type }) });
      router.push("/accounting");
      router.refresh();
    }}>
      <Input value={code} onChange={(e) => setCode(e.target.value)} required />
      <Input value={name} onChange={(e) => setName(e.target.value)} required />
      <select className="h-8 rounded-md border px-2 text-sm" value={type} onChange={(e) => setType(e.target.value as (typeof accountTypes)[number])}>
        {accountTypes.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Guardar cambios"}</Button>
    </form>
  );
}

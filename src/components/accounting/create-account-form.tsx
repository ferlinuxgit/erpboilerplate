"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";

const accountTypes = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;

export function CreateAccountForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof accountTypes)[number]>("ASSET");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="grid gap-2 md:grid-cols-4" onSubmit={async (event) => {
      event.preventDefault();
      setLoading(true); setError(null);
      try {
        const res = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify({ code, name, type }) });
        if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "Error");
        setCode(""); setName(""); setType("ASSET"); router.refresh();
      } catch (e) { setError(e instanceof Error ? e.message : "Error inesperado."); } finally { setLoading(false); }
    }}>
      <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Codigo" required />
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" required />
      <Select value={type} onChange={(e) => setType(e.target.value as (typeof accountTypes)[number])}>
        {accountTypes.map((option) => <option key={option} value={option}>{option}</option>)}
      </Select>
      <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Crear cuenta"}</Button>
      {error ? <p className="text-sm text-red-600 md:col-span-4">{error}</p> : null}
    </form>
  );
}

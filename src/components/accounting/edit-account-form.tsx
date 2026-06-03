"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { accountTypeLabels, statusLabel } from "@/lib/status-labels";

const accountTypes = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;

export function EditAccountForm({ id, defaultCode, defaultName, defaultType }: { id: string; defaultCode: string; defaultName: string; defaultType: (typeof accountTypes)[number] }) {
  const router = useRouter();
  const [code, setCode] = useState(defaultCode);
  const [name, setName] = useState(defaultName);
  const [type, setType] = useState<(typeof accountTypes)[number]>(defaultType);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = error ? "edit-account-error" : undefined;

  return (
    <form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      setError(null);
      setLoading(true);
      try {
        const response = await fetch(`/api/accounts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify({ code, name, type }),
        });
        if (!response.ok) {
          const payload = (await response.json()) as { message?: string };
          throw new Error(payload.message ?? "No se pudo actualizar la cuenta.");
        }
        toast.success("Cuenta actualizada correctamente.");
        router.push("/accounting");
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
        <Label htmlFor="edit-account-code">Codigo</Label>
        <Input
          id="edit-account-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          aria-describedby={errorId}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-account-name">Nombre</Label>
        <Input
          id="edit-account-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          aria-describedby={errorId}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-account-type">Tipo</Label>
        <Select
          id="edit-account-type"
          value={type}
          onChange={(e) => setType(e.target.value as (typeof accountTypes)[number])}
          aria-describedby={errorId}
        >
          {accountTypes.map((option) => <option key={option} value={option}>{statusLabel(accountTypeLabels, option)}</option>)}
        </Select>
      </div>
      <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Guardar cambios"}</Button>
      {error ? <p id="edit-account-error" className="text-sm text-red-600" role="alert">{error}</p> : null}
    </form>
  );
}

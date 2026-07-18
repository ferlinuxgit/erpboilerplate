"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";

type TreasuryOperationsProps = {
  accounts: { id: string; bankName: string; iban: string }[];
  pendingCount: number;
};

export function TreasuryOperations({ accounts, pendingCount }: TreasuryOperationsProps) {
  const router = useRouter();
  const [bankAccountId, setBankAccountId] = useState(accounts[0]?.id ?? "");
  const [csv, setCsv] = useState("");
  const [busyAction, setBusyAction] = useState<"import" | "reconcile" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importCsv() {
    setBusyAction("import");
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/treasury/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ bankAccountId, csv }),
      });
      const payload = (await response.json().catch(() => null)) as { count?: number; message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? "No se pudo importar el extracto.");
      const message = `${payload?.count ?? 0} movimientos importados.`;
      setResult(message);
      setCsv("");
      toast.success(message);
      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "No se pudo importar el extracto.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function reconcile() {
    setBusyAction("reconcile");
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/treasury/reconcile", { method: "POST", headers: getCsrfHeader() });
      const payload = (await response.json().catch(() => null)) as { reconciled?: number; totalPending?: number; message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? "No se pudo ejecutar la conciliación.");
      const message = `${payload?.reconciled ?? 0} de ${payload?.totalPending ?? 0} movimientos conciliados automáticamente.`;
      setResult(message);
      toast.success(message);
      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "No se pudo ejecutar la conciliación.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
      <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
        <div>
          <p className="font-medium">Importar extracto bancario</p>
          <p className="mt-1 text-sm text-muted-foreground">Formato separado por punto y coma: fecha;importe;descripción.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="treasury-import-account">Cuenta de destino</Label>
            <Select id="treasury-import-account" value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.bankName} · {account.iban}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="treasury-import-file">Archivo CSV</Label>
            <Input
              accept=".csv,text/csv,text/plain"
              id="treasury-import-file"
              type="file"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) setCsv(await file.text());
              }}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="treasury-import-preview">Contenido del extracto</Label>
          <Textarea id="treasury-import-preview" value={csv} onChange={(event) => setCsv(event.target.value)} placeholder={"fecha;importe;descripcion\n2026-07-18;1250,00;Cobro factura F-1042"} />
        </div>
        <Button disabled={!bankAccountId || !csv.trim() || busyAction !== null} onClick={importCsv} type="button">
          {busyAction === "import" ? "Importando…" : "Importar movimientos"}
        </Button>
      </div>

      <div className="flex flex-col justify-between gap-5 rounded-xl border bg-muted/20 p-4">
        <div>
          <p className="font-medium">Conciliación automática</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Cruza importe, fecha y referencia con cobros y pagos registrados.</p>
          <p className="mt-4 text-3xl font-semibold tracking-tight">{pendingCount}</p>
          <p className="text-sm text-muted-foreground">movimientos pendientes</p>
        </div>
        <Button disabled={pendingCount === 0 || busyAction !== null} onClick={reconcile} type="button" variant="secondary">
          {busyAction === "reconcile" ? "Conciliando…" : "Conciliar pendientes"}
        </Button>
      </div>

      {error ? <InlineAlert className="lg:col-span-2" tone="danger">{error}</InlineAlert> : null}
      {result ? <InlineAlert className="lg:col-span-2" tone="success">{result}</InlineAlert> : null}
    </div>
  );
}

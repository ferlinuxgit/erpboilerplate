"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import {
  defaultAccountingAccounts,
  defaultAccountingJournals,
  type AccountingMasterAccount,
  type AccountingMasterJournal,
} from "@/lib/accounting-masters";

type AccountingMastersFormProps = {
  missingAccounts: AccountingMasterAccount[];
  missingJournals: AccountingMasterJournal[];
};

export function AccountingMastersForm({ missingAccounts, missingJournals }: AccountingMastersFormProps) {
  const router = useRouter();
  const [selectedAccountCodes, setSelectedAccountCodes] = useState(() => new Set(missingAccounts.map((account) => account.code)));
  const [selectedJournalCodes, setSelectedJournalCodes] = useState(() => new Set(missingJournals.map((journal) => journal.code)));
  const [accountSearch, setAccountSearch] = useState("");
  const [journalSearch, setJournalSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const missingAccountCodes = new Set(missingAccounts.map((account) => account.code));
  const missingJournalCodes = new Set(missingJournals.map((journal) => journal.code));
  const hasMissingMasters = missingAccountCodes.size > 0 || missingJournalCodes.size > 0;
  const normalizedAccountSearch = accountSearch.trim().toLocaleLowerCase();
  const normalizedJournalSearch = journalSearch.trim().toLocaleLowerCase();
  const visibleAccounts = defaultAccountingAccounts.filter((account) =>
    [account.code, account.name, account.type, account.role].join(" ").toLocaleLowerCase().includes(normalizedAccountSearch),
  );
  const visibleJournals = defaultAccountingJournals.filter((journal) =>
    [journal.code, journal.name, journal.role].join(" ").toLocaleLowerCase().includes(normalizedJournalSearch),
  );

  const toggleAccount = (code: string) => {
    setSelectedAccountCodes((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleJournal = (code: string) => {
    setSelectedJournalCodes((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const submit = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/accounting/masters", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          accounts: defaultAccountingAccounts.filter((account) => selectedAccountCodes.has(account.code) && missingAccountCodes.has(account.code)),
          journals: defaultAccountingJournals.filter((journal) => selectedJournalCodes.has(journal.code) && missingJournalCodes.has(journal.code)),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "No se pudieron crear los maestros contables.");
      }
      toast.success("Maestros contables creados.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  };

  if (!hasMissingMasters) {
    return <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">Los maestros contables mínimos están creados.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="accounting-master-preset">
            Opciones predefinidas
          </label>
          <Select id="accounting-master-preset" value="es-pgc-pyme" onChange={() => undefined}>
            <option value="es-pgc-pyme">España - PGC Pyme básico</option>
          </Select>
          <p className="text-sm text-muted-foreground">
            Recomendado para empresas españolas que necesitan emitir facturas, registrar IVA, cobros, pagos y cierres básicos.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSelectedAccountCodes(new Set(missingAccounts.map((account) => account.code)));
            setSelectedJournalCodes(new Set(missingJournals.map((journal) => journal.code)));
          }}
        >
          Seleccionar recomendados
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[
          ["Facturas emitidas", "Clientes, ventas e IVA repercutido quedan configurados para contabilizar ventas automáticamente."],
          ["Facturas recibidas", "Proveedores, compras e IVA soportado quedan preparados para compras y gastos."],
          ["Bancos y cobros", "Cuenta bancaria y diario de bancos quedan listos para tesorería y conciliación."],
          ["Fiscalidad España", "Incluye cuentas de IVA y retenciones habituales en PGC Pyme."],
          ["Cierre contable", "Añade cuenta de resultado y diario de cierre para cierre anual."],
          ["Diarios operativos", "Crea diarios separados para ventas, compras, bancos, general y cierre."],
        ].map(([title, description]) => (
          <div className="rounded-md border bg-muted/20 p-3" key={title}>
            <p className="text-sm font-medium">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        ))}
      </div>

      {defaultAccountingAccounts.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium">Catálogo de cuentas España</p>
              <p className="text-sm text-muted-foreground">Busca por código, nombre, tipo o uso. Las cuentas ya existentes aparecen bloqueadas.</p>
            </div>
            <Input
              className="md:max-w-sm"
              placeholder="Buscar cuenta, IVA, clientes, ventas..."
              value={accountSearch}
              onChange={(event) => setAccountSearch(event.target.value)}
            />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {visibleAccounts.map((account) => {
              const isMissing = missingAccountCodes.has(account.code);
              const checked = selectedAccountCodes.has(account.code);
              return (
                <label className="flex gap-3 rounded-md border p-3 text-sm" key={account.code}>
                  <input
                    checked={!isMissing || checked}
                    disabled={!isMissing}
                    onChange={() => toggleAccount(account.code)}
                    type="checkbox"
                  />
                  <span>
                    <span className="font-medium">{account.code} - {account.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{account.type}</span>
                    {!isMissing ? <span className="ml-2 text-xs text-emerald-700">Creada</span> : null}
                    <span className="mt-1 block text-muted-foreground">{account.role}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {defaultAccountingJournals.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium">Catálogo de diarios España</p>
              <p className="text-sm text-muted-foreground">Selecciona los diarios operativos que necesita la empresa.</p>
            </div>
            <Input
              className="md:max-w-sm"
              placeholder="Buscar diario, ventas, bancos..."
              value={journalSearch}
              onChange={(event) => setJournalSearch(event.target.value)}
            />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {visibleJournals.map((journal) => {
              const isMissing = missingJournalCodes.has(journal.code);
              const checked = selectedJournalCodes.has(journal.code);
              return (
                <label className="flex gap-3 rounded-md border p-3 text-sm" key={journal.code}>
                  <input
                    checked={!isMissing || checked}
                    disabled={!isMissing}
                    onChange={() => toggleJournal(journal.code)}
                    type="checkbox"
                  />
                  <span>
                    <span className="font-medium">{journal.code} - {journal.name}</span>
                    {!isMissing ? <span className="ml-2 text-xs text-emerald-700">Creado</span> : null}
                    <span className="mt-1 block text-muted-foreground">{journal.role}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button disabled={loading || (selectedAccountCodes.size === 0 && selectedJournalCodes.size === 0)} onClick={submit} type="button">
          {loading ? "Creando..." : "Crear configuración recomendada"}
        </Button>
      </div>
    </div>
  );
}

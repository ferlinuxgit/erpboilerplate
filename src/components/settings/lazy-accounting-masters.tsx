"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { AccountingMasterAccount, AccountingMasterJournal } from "@/lib/accounting-masters";

const AccountingMastersForm = dynamic(
  () => import("@/components/accounting/accounting-masters-form").then((module) => module.AccountingMastersForm),
  { loading: () => <p className="font-mono text-xs text-muted-foreground" aria-busy="true">Cargando catálogo contable…</p> },
);

type LazyAccountingMastersProps = {
  missingAccounts: AccountingMasterAccount[];
  missingJournals: AccountingMasterJournal[];
  catalogAccounts: readonly AccountingMasterAccount[];
  catalogJournals: readonly AccountingMasterJournal[];
  catalogLabel: string;
};

export function LazyAccountingMasters(props: LazyAccountingMastersProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-3 border border-dashed border-window-dark-shadow bg-window-panel p-3">
        <div>
          <h3 className="font-mono text-sm font-bold">Catálogo contable completo</h3>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Carga esta vista sólo cuando necesites revisar cuentas y diarios individuales. El catálogo se mostrará por bloques para mantener la página ligera.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} type="button" variant="outline">
          Abrir catálogo avanzado
        </Button>
      </div>
    );
  }

  return <AccountingMastersForm {...props} />;
}

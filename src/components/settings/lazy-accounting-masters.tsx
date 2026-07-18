"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { AccountingMasterAccount, AccountingMasterJournal } from "@/lib/accounting-masters";

const AccountingMastersForm = dynamic(
  () => import("@/components/accounting/accounting-masters-form").then((module) => module.AccountingMastersForm),
  { loading: () => <p className="text-sm text-muted-foreground">Cargando catálogo contable…</p> },
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
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed bg-muted/25 p-5">
        <div>
          <p className="font-medium">Catálogo contable completo</p>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
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

"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CreateBankAccountForm } from "@/components/treasury/create-bank-account-form";
import { CreateBankTransactionForm } from "@/components/treasury/create-bank-transaction-form";
import { EditBankAccountForm } from "@/components/treasury/edit-bank-account-form";
import { EditBankTransactionForm } from "@/components/treasury/edit-bank-transaction-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

type AccountOption = { id: string; bankName: string; iban: string };
type Transaction = { id: string; bankAccountId: string; amount: string; description: string; postedAt: Date | string };

function useRefreshDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), close: () => setOpen(false), complete: () => { setOpen(false); router.refresh(); } };
}

export function CreateBankAccountDialog() {
  const dialog = useRefreshDialog();
  return <><Button onClick={dialog.show} type="button"><Plus aria-hidden="true" />Nueva cuenta</Button><Dialog description="Registra el banco y el IBAN de una cuenta operativa." initialFocusId="bank-account-name" onClose={dialog.close} open={dialog.open} size="lg" title="Nueva cuenta bancaria"><CreateBankAccountForm onCancel={dialog.close} onSuccess={dialog.complete} /></Dialog></>;
}

export function EditBankAccountDialog({ account }: { account: AccountOption }) {
  const dialog = useRefreshDialog();
  return <><Button onClick={dialog.show} size="sm" type="button" variant="outline"><Pencil aria-hidden="true" />Editar</Button><Dialog description={account.iban} initialFocusId={`edit-bank-name-${account.id}`} onClose={dialog.close} open={dialog.open} title="Editar cuenta bancaria"><EditBankAccountForm id={account.id} defaultBankName={account.bankName} defaultIban={account.iban} onCancel={dialog.close} onSuccess={dialog.complete} /></Dialog></>;
}

export function CreateBankTransactionDialog({ accounts }: { accounts: AccountOption[] }) {
  const dialog = useRefreshDialog();
  return <><Button disabled={accounts.length === 0} onClick={dialog.show} type="button"><Plus aria-hidden="true" />Nuevo movimiento</Button><Dialog description="Añade una transacción a una cuenta bancaria de la empresa activa." initialFocusId="bank-transaction-account" onClose={dialog.close} open={dialog.open} size="lg" title="Nuevo movimiento bancario"><CreateBankTransactionForm accounts={accounts} onCancel={dialog.close} onSuccess={dialog.complete} /></Dialog></>;
}

export function EditBankTransactionDialog({ accounts, transaction }: { accounts: AccountOption[]; transaction: Transaction }) {
  const dialog = useRefreshDialog();
  const date = typeof transaction.postedAt === "string" ? transaction.postedAt.slice(0, 10) : transaction.postedAt.toISOString().slice(0, 10);
  return <><Button onClick={dialog.show} size="sm" type="button" variant="outline"><Pencil aria-hidden="true" />Editar</Button><Dialog description={transaction.description} initialFocusId="edit-bank-transaction-account" onClose={dialog.close} open={dialog.open} title="Editar movimiento bancario"><EditBankTransactionForm id={transaction.id} accounts={accounts} defaultBankAccountId={transaction.bankAccountId} defaultAmount={transaction.amount} defaultDescription={transaction.description} defaultPostedAt={date} onCancel={dialog.close} onSuccess={dialog.complete} /></Dialog></>;
}

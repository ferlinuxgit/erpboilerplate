"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { CreateAccountForm } from "@/components/accounting/create-account-form";
import { EditAccountForm } from "@/components/accounting/edit-account-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" | "MIXED";

export function CreateAccountDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const close = () => setOpen(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} type="button"><Plus aria-hidden="true" />Nueva cuenta</Button>
      <Dialog description="Añade una cuenta al plan contable de la empresa activa." initialFocusId="account-code" onClose={close} open={open} size="lg" title="Nueva cuenta contable">
        <CreateAccountForm onCancel={close} onSuccess={() => { close(); router.refresh(); }} />
      </Dialog>
    </>
  );
}

export function EditAccountDialog({ account }: { account: { id: string; code: string; name: string; type: AccountType } }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const close = () => setOpen(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" type="button" variant="outline"><Pencil aria-hidden="true" />Editar</Button>
      <Dialog description={`${account.code} · ${account.name}`} initialFocusId="edit-account-code" onClose={close} open={open} title="Editar cuenta contable">
        <EditAccountForm {...{ id: account.id, defaultCode: account.code, defaultName: account.name, defaultType: account.type }} onCancel={close} onSuccess={() => { close(); router.refresh(); }} />
      </Dialog>
    </>
  );
}

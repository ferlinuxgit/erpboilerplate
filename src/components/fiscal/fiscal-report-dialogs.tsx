"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CreateFiscalReportForm } from "@/components/fiscal/create-fiscal-report-form";
import { EditFiscalReportForm } from "@/components/fiscal/edit-fiscal-report-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

type FiscalStatus = "DRAFT" | "READY" | "FILED";

function useRefreshDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), close: () => setOpen(false), complete: () => { setOpen(false); router.refresh(); } };
}

export function CreateFiscalReportDialog() {
  const dialog = useRefreshDialog();
  return <><Button onClick={dialog.show} type="button"><Plus aria-hidden="true" />Nuevo modelo</Button><Dialog description="Crea un borrador para un periodo fiscal de la empresa activa." initialFocusId="fiscal-report-code" onClose={dialog.close} open={dialog.open} size="lg" title="Nuevo modelo fiscal"><CreateFiscalReportForm onCancel={dialog.close} onSuccess={dialog.complete} /></Dialog></>;
}

export function EditFiscalReportDialog({ report }: { report: { id: string; code: string; period: string; status: FiscalStatus } }) {
  const dialog = useRefreshDialog();
  return <><Button onClick={dialog.show} size="sm" type="button" variant="outline"><Pencil aria-hidden="true" />Editar</Button><Dialog description={`${report.code} · ${report.period}`} initialFocusId="edit-fiscal-report-code" onClose={dialog.close} open={dialog.open} title="Editar modelo fiscal"><EditFiscalReportForm id={report.id} defaultCode={report.code} defaultPeriod={report.period} defaultStatus={report.status} onCancel={dialog.close} onSuccess={dialog.complete} /></Dialog></>;
}

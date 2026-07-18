import Link from "next/link";
import { DownloadSimple as Download } from "@phosphor-icons/react";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

export function FiscalReportRowActions({ report }: { report: { id: string; code: string; period: string; status: "DRAFT" | "READY" | "FILED" } }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/fiscal/${report.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
        Editar
      </Link>
      <Link href={`/api/fiscal-reports/${report.id}/pdf`} className={buttonVariants({ variant: "outline", size: "sm" })}>
        <Download aria-hidden="true" />
        PDF
      </Link>
      <Link href={`/api/fiscal-reports/${report.id}/export`} className={buttonVariants({ variant: "outline", size: "sm" })}>
        <Download aria-hidden="true" />
        JSON
      </Link>
      <DeleteButton url={`/api/fiscal-reports/${report.id}`} />
    </div>
  );
}

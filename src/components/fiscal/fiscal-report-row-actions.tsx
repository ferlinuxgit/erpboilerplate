import Link from "next/link";
import { DownloadSimple as Download } from "@phosphor-icons/react/dist/ssr";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

export function FiscalReportRowActions({ canWrite = true, hideView = false, report }: { canWrite?: boolean; hideView?: boolean; report: { id: string; code: string; period: string; status: "DRAFT" | "READY" | "FILED" } }) {
  return (
    <div className="flex flex-wrap gap-2">
      {!hideView ? <Link href={`/fiscal/${report.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Ver</Link> : null}
      {canWrite ? <Link href={`/fiscal/${report.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>Editar</Link> : null}
      <Link href={`/api/fiscal-reports/${report.id}/pdf`} className={buttonVariants({ variant: "outline", size: "sm" })}>
        <Download aria-hidden="true" />
        PDF
      </Link>
      <Link href={`/api/fiscal-reports/${report.id}/export`} className={buttonVariants({ variant: "outline", size: "sm" })}>
        <Download aria-hidden="true" />
        JSON
      </Link>
      {canWrite && report.status !== "FILED" ? <DeleteButton url={`/api/fiscal-reports/${report.id}`} redirectTo={hideView ? "/fiscal" : undefined} /> : null}
    </div>
  );
}

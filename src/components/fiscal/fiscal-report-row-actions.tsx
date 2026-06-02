import Link from "next/link";
import { Download } from "lucide-react";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

export function FiscalReportRowActions({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/fiscal/${id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>Editar</Link>
      <Link href={`/api/fiscal-reports/${id}/pdf`} className={buttonVariants({ variant: "outline", size: "sm" })}>
        <Download aria-hidden="true" />
        PDF
      </Link>
      <Link href={`/api/fiscal-reports/${id}/export`} className={buttonVariants({ variant: "outline", size: "sm" })}>
        <Download aria-hidden="true" />
        JSON
      </Link>
      <DeleteButton url={`/api/fiscal-reports/${id}`} />
    </div>
  );
}

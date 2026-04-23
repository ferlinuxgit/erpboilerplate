import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

export function JournalEntryRowActions({ id }: { id: string }) {
  return (
    <div className="flex gap-2">
      <Link href={`/accounting/entries/${id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>Editar</Link>
      <DeleteButton url={`/api/journal-entries/${id}`} />
    </div>
  );
}

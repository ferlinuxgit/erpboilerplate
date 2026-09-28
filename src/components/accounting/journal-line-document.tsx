import Link from "next/link";

import { accountingDocumentHref, accountingDocumentLabel } from "@/lib/accounting-documents";

/** Documento de un apunte («Factura FA-2026/000049») con enlace a su ficha cuando existe. */
export function JournalLineDocument({
  documentId,
  documentNumber,
  documentType,
}: {
  documentId: string | null;
  documentNumber: string | null;
  documentType: string | null;
}) {
  const label = accountingDocumentLabel(documentType);
  if (!label && !documentNumber) return <span className="text-muted-foreground">—</span>;
  const text = [label, documentNumber].filter(Boolean).join(" ");
  const href = accountingDocumentHref(documentType, documentId);
  return href ? (
    <Link className="text-link hover:underline" href={href}>
      {text}
    </Link>
  ) : (
    <span>{text}</span>
  );
}

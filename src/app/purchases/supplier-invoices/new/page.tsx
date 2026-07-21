import { redirect } from "next/navigation";

export default async function NewSupplierInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string | string[] }>;
}) {
  const query = await searchParams;
  const initialSupplierId = Array.isArray(query.supplierId)
    ? query.supplierId[0]
    : query.supplierId;
  redirect(`/expenses/new${initialSupplierId ? `?supplierId=${encodeURIComponent(initialSupplierId)}` : ""}`);
}

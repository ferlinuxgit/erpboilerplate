import { redirect } from "next/navigation";

export default async function LegacyEditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/purchases/orders/${encodeURIComponent(id)}/edit`);
}

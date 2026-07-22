import { redirect } from "next/navigation";

export default function LegacyNewPurchaseOrderPage() {
  redirect("/purchases/orders/new");
}

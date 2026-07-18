"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getCsrfHeader } from "@/lib/csrf-client";

export function ReceivePurchaseButton({ orderId }: { orderId: string }) { const router = useRouter(); const [loading, setLoading] = useState(false); const receive = async () => { setLoading(true); try { const response = await fetch("/api/goods-receipts", { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify({ purchaseOrderId: orderId, receivedAt: new Date().toISOString() }) }); const payload = (await response.json()) as { message?: string }; if (!response.ok) throw new Error(payload.message ?? "No se pudo registrar la recepción."); toast.success("Mercancía recepcionada."); router.refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : "Error inesperado."); } finally { setLoading(false); } }; return <Button disabled={loading} onClick={receive} type="button">{loading ? "Recepcionando…" : "Recepcionar mercancía"}</Button>; }

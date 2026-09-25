import { readApiError } from "@/components/ui/form";
import type { AllocationInput } from "@/lib/bank-import/allocations";
import { getCsrfHeader } from "@/lib/csrf-client";

export type RememberRule = {
  conceptContains: string;
  direction: "ANY" | "IN" | "OUT";
  accountId: string;
  autoApply: boolean;
};

export async function applyReconciliation(input: { transactionId: string; allocations: AllocationInput[]; ruleId?: string | null; remember?: RememberRule | null }) {
  const response = await fetch("/api/treasury/reconciliation/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getCsrfHeader() },
    body: JSON.stringify({
      transactionId: input.transactionId,
      allocations: input.allocations.map(({ type, targetId, amount }) => ({ type, targetId, amount })),
      ruleId: input.ruleId ?? null,
      remember: input.remember ?? null,
    }),
  });
  if (!response.ok) throw new Error(await readApiError(response, "No se pudo conciliar el movimiento."));
  return (await response.json()) as { transactionId: string; resolution: string; createdPayments: string[]; rememberedRuleId: string | null };
}

export async function acceptSafeReconciliations(transactionIds: string[]) {
  const response = await fetch("/api/treasury/reconciliation/accept-safe", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getCsrfHeader() },
    body: JSON.stringify({ transactionIds }),
  });
  if (!response.ok) throw new Error(await readApiError(response, "No se pudieron aplicar las propuestas."));
  return (await response.json()) as { applied: Array<{ transactionId: string; title: string }>; skipped: Array<{ transactionId: string; reason: string }> };
}

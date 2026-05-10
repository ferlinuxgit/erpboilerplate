"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { getCsrfHeader } from "@/lib/csrf-client";
import type { BillingViewModel } from "@/server/billing/state";

type Props = {
  checkout: BillingViewModel["checkout"];
  portal: BillingViewModel["portal"];
};

export function BillingActions({ checkout, portal }: Props) {
  const [isLoading, setIsLoading] = useState(false);

  async function openCheckout() {
    if (!checkout.priceId) return;
    setIsLoading(true);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ priceId: checkout.priceId }),
      });
      const payload = (await response.json()) as { url?: string };
      if (payload.url) window.location.href = payload.url;
    } finally {
      setIsLoading(false);
    }
  }

  async function openPortal() {
    if (!portal.stripeCustomerId) return;
    setIsLoading(true);
    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ stripeCustomerId: portal.stripeCustomerId }),
      });
      const payload = (await response.json()) as { url?: string };
      if (payload.url) window.location.href = payload.url;
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={isLoading || !checkout.enabled} onClick={openCheckout}>
        Checkout Stripe
      </Button>
      <Button disabled={isLoading || !portal.enabled} onClick={openPortal} variant="outline">
        Portal Stripe
      </Button>
      {checkout.configurationError ? <p className="text-sm text-muted-foreground">{checkout.configurationError}</p> : null}
    </div>
  );
}

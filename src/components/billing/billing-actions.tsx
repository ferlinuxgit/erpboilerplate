"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { getCsrfHeader } from "@/lib/csrf-client";

export function BillingActions({ fallbackPriceId }: { fallbackPriceId: string }) {
  const [isLoading, setIsLoading] = useState(false);

  return (
    <div className="flex gap-2">
      <Button
        disabled={isLoading}
        onClick={async () => {
          setIsLoading(true);
          const response = await fetch("/api/billing/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getCsrfHeader() },
            body: JSON.stringify({ priceId: fallbackPriceId }),
          });
          const payload = (await response.json()) as { url?: string };
          if (payload.url) window.location.href = payload.url;
          setIsLoading(false);
        }}
      >
        Checkout Stripe
      </Button>
    </div>
  );
}

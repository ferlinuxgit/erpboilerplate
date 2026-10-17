"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function WaitlistCancel({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button className="h-12" data-testid="waitlist-cancel" disabled={pending} onClick={async () => {
      setPending(true);
      await fetch(`/api/public/bookings/waitlist/${token}/cancel`, { method: "POST" }).catch(() => undefined);
      router.refresh();
      setPending(false);
    }} type="button" variant="outline">Salir de la lista de espera</Button>
  );
}

"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="container mx-auto flex min-h-[70vh] items-center justify-center px-4 py-10">
      <div className="space-y-4 text-center">
        <h2 className="text-2xl font-semibold">Ha ocurrido un error inesperado</h2>
        <p className="text-muted-foreground">Puedes reintentar la operación o volver al panel.</p>
        <Button onClick={reset}>Reintentar</Button>
      </div>
    </main>
  );
}

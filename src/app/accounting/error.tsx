"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

import { RouteErrorState } from "@/components/route-state";

export default function Error({
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
    <RouteErrorState
      title="No se pudo cargar contabilidad"
      description="Puedes reintentar la operación o volver al dashboard sin perder la navegación principal."
      error={error}
      reset={reset}
    />
  );
}

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
      title="No se pudo cargar la puesta en marcha"
      description="Puedes reintentar la configuración inicial o volver al panel."
      error={error}
      reset={reset}
    />
  );
}

"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

import { RouteErrorState } from "@/components/route-state";

export default function RootError({
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
      description="Puedes reintentar la operación o volver al panel. Si el problema persiste, comparte el código de error con soporte."
      error={error}
      reset={reset}
      title="Ha ocurrido un error inesperado"
    />
  );
}

"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

import "./globals.css";

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
    <html lang="es">
      <body className="flex min-h-dvh items-center justify-center bg-background p-3 text-foreground">
        <title>Error · ERP Suite</title>
        <main className="win-bevel w-full max-w-xl bg-card" role="alert">
          <p className="bg-chrome-active px-2 py-1 font-mono text-xs font-bold text-chrome-active-foreground">ERP_SUITE.EXE</p>
          <div className="space-y-3 p-4">
            <h1 className="font-mono text-lg font-bold">La aplicación no ha podido cargarse</h1>
            <p className="text-sm text-muted-foreground">
              Se ha producido un error inesperado. Reintenta la operación; si el problema persiste, comparte el código de error con soporte.
            </p>
            {error.digest ? (
              <p className="border border-window-shadow bg-muted p-2 font-mono text-xs text-muted-foreground">Código de error: {error.digest}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                className="win-bevel h-8 bg-primary px-3 font-mono text-[0.78rem] font-bold text-primary-foreground"
                onClick={reset}
                type="button"
              >
                Reintentar
              </button>
              {/* A full reload is intentional: the root layout itself failed. */}
              <a className="win-bevel inline-flex h-8 items-center bg-window-surface px-3 font-mono text-[0.78rem] font-bold text-window-text" href="/dashboard">
                Volver al panel
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}

"use client";

import { useEffect, useRef } from "react";

type TurnstileApi = { render: (element: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void };
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstile() {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("No se pudo cargar la verificación de seguridad."));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Verificación anti-bots de Cloudflare Turnstile (solo si el servidor tiene clave). */
export function CaptchaWidget({ onToken, siteKey }: { onToken: (token: string | null) => void; siteKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    void loadTurnstile().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return;
      widgetId = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        language: "es",
        callback: (token: string) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
      });
    }).catch(() => onTokenRef.current(null));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey]);

  return <div aria-label="Verificación de seguridad" className="min-h-16" ref={ref} />;
}

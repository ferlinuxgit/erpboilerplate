"use client";

import { useEffect } from "react";

import { loginPathWithNext, SESSION_EXPIRED_REASON } from "@/lib/auth-client";

/** A 401 from the app's API means the session expired or was revoked (`/api/auth/*` answers 401 for bad credentials). */
export function isSessionExpiredResponse(url: string, status: number, origin: string) {
  if (status !== 401) return false;
  let parsed: URL;
  try {
    parsed = new URL(url, origin);
  } catch {
    return false;
  }
  return parsed.origin === origin && parsed.pathname.startsWith("/api/") && !parsed.pathname.startsWith("/api/auth/");
}

/**
 * If the session expires while a page is open, every API call answers 401 and the user
 * only sees generic errors. Watches `fetch` responses and sends them to the login
 * (keeping the current page as `next`) instead.
 */
export function SessionExpiryWatcher() {
  useEffect(() => {
    const originalFetch = window.fetch;
    let redirecting = false;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);
      const [input] = args;
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!redirecting && isSessionExpiredResponse(url, response.status, window.location.origin)) {
        redirecting = true;
        const current = `${window.location.pathname}${window.location.search}`;
        window.location.assign(loginPathWithNext(current, SESSION_EXPIRED_REASON));
      }
      return response;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, []);
  return null;
}

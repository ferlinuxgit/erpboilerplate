/**
 * Configuración de la conexión bancaria PSD2 (GoCardless Bank Account Data, antes Nordigen).
 * Solo servidor: los secretos nunca se exponen al cliente. Sin GOCARDLESS_SECRET_ID y
 * GOCARDLESS_SECRET_KEY la funcionalidad queda oculta (se explica cómo activarla).
 */

export const GOCARDLESS_DEFAULT_BASE_URL = "https://bankaccountdata.gocardless.com/api/v2";
export const DEFAULT_BANK_SYNC_INTERVAL_HOURS = 6;

export type BankConnectionsConfig = {
  secretId: string;
  secretKey: string;
  baseUrl: string;
  /** Clave (texto) de la que se deriva la de cifrado de los identificadores guardados. */
  encryptionSecret: string;
  appUrl: string;
  syncIntervalHours: number;
};

export function bankSyncIntervalHours(env: Record<string, string | undefined> = process.env) {
  const value = Number(env.BANK_SYNC_INTERVAL_HOURS ?? DEFAULT_BANK_SYNC_INTERVAL_HOURS);
  // GoCardless permite 4 consultas de movimientos al día por cuenta: menos de 6 h no aporta.
  return Number.isFinite(value) && value >= 1 ? Math.min(value, 24 * 7) : DEFAULT_BANK_SYNC_INTERVAL_HOURS;
}

export function getBankConnectionsConfig(env: Record<string, string | undefined> = process.env): BankConnectionsConfig | null {
  const secretId = env.GOCARDLESS_SECRET_ID?.trim();
  const secretKey = env.GOCARDLESS_SECRET_KEY?.trim();
  if (!secretId || !secretKey) return null;
  const encryptionSecret = env.BANK_CONNECTIONS_ENCRYPTION_KEY?.trim() || env.JWT_SECRET?.trim() || "";
  if (!encryptionSecret) return null;
  return {
    secretId,
    secretKey,
    baseUrl: (env.GOCARDLESS_BASE_URL?.trim() || GOCARDLESS_DEFAULT_BASE_URL).replace(/\/+$/, ""),
    encryptionSecret,
    appUrl: (env.APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, ""),
    syncIntervalHours: bankSyncIntervalHours(env),
  };
}

export function isBankConnectionsEnabled(env: Record<string, string | undefined> = process.env) {
  return getBankConnectionsConfig(env) !== null;
}

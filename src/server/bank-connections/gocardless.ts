import type { BankConnectionsConfig } from "@/lib/bank-connections-config";

/*
 * Cliente HTTP mínimo de GoCardless Bank Account Data (API v2, antes Nordigen).
 * - El token de acceso es de la aplicación (credenciales GOCARDLESS_SECRET_*), vive solo en el
 *   servidor y en memoria: se renueva con el refresh token y, si también caduca, se pide otro.
 * - `fetchImpl` permite simular todas las llamadas en las pruebas (nunca se llama a la API real).
 */

export type Institution = { id: string; name: string; bic?: string | null; logo?: string | null; transaction_total_days?: string | number | null; max_access_valid_for_days?: string | number | null };
export type Agreement = { id: string; max_historical_days: number; access_valid_for_days: number; accepted?: string | null };
export type Requisition = { id: string; status: string; link?: string; accounts: string[]; agreement?: string; reference?: string; institution_id?: string };
export type AccountDetails = { account?: { iban?: string; currency?: string; name?: string; ownerName?: string; product?: string } };
export type GoCardlessTransaction = {
  transactionId?: string;
  internalTransactionId?: string;
  entryReference?: string;
  bookingDate?: string;
  valueDate?: string;
  bookingDateTime?: string;
  transactionAmount: { amount: string; currency?: string };
  remittanceInformationUnstructured?: string;
  remittanceInformationUnstructuredArray?: string[];
  remittanceInformationStructured?: string;
  additionalInformation?: string;
  creditorName?: string;
  debtorName?: string;
  balanceAfterTransaction?: { balanceAmount?: { amount: string; currency?: string } };
};
export type TransactionsResponse = { transactions: { booked: GoCardlessTransaction[]; pending?: GoCardlessTransaction[] } };

export class GoCardlessError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`GoCardless ${status}: ${detail}`);
    this.name = "GoCardlessError";
    this.status = status;
    this.detail = detail;
  }

  /** El consentimiento del banco ha caducado o se ha revocado: hay que renovarlo. */
  get consentExpired() {
    return this.status === 401 || this.status === 403 || /expired|suspended|revoked/i.test(this.detail);
  }

  get rateLimited() {
    return this.status === 429;
  }
}

type TokenState = { access: string; accessExpiresAt: number; refresh: string; refreshExpiresAt: number };

// Caché por credenciales (una por proceso): evita pedir un token nuevo en cada llamada.
const tokenCache = new Map<string, TokenState>();

export function clearGoCardlessTokenCache() {
  tokenCache.clear();
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GoCardlessClient {
  private readonly config: Pick<BankConnectionsConfig, "secretId" | "secretKey" | "baseUrl">;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(config: Pick<BankConnectionsConfig, "secretId" | "secretKey" | "baseUrl">, options: { fetchImpl?: FetchLike; now?: () => number } = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
  }

  private async raw(path: string, init: RequestInit & { token?: string | null } = {}) {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body) headers["Content-Type"] = "application/json";
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
      const detail = [record.summary, record.detail].filter((part) => typeof part === "string").join(" · ") || response.statusText || "Error";
      throw new GoCardlessError(response.status, detail);
    }
    return body;
  }

  private async token() {
    const key = this.config.secretId;
    const now = this.now();
    const cached = tokenCache.get(key);
    if (cached && cached.accessExpiresAt - 60_000 > now) return cached.access;
    if (cached && cached.refreshExpiresAt - 60_000 > now) {
      try {
        const refreshed = (await this.raw("/token/refresh/", { method: "POST", body: JSON.stringify({ refresh: cached.refresh }) })) as { access: string; access_expires: number };
        const next = { ...cached, access: refreshed.access, accessExpiresAt: now + refreshed.access_expires * 1000 };
        tokenCache.set(key, next);
        return next.access;
      } catch (error) {
        if (!(error instanceof GoCardlessError) || error.status !== 401) throw error;
        // Refresh token rechazado: se pide un par nuevo.
      }
    }
    const created = (await this.raw("/token/new/", {
      method: "POST",
      body: JSON.stringify({ secret_id: this.config.secretId, secret_key: this.config.secretKey }),
    })) as { access: string; access_expires: number; refresh: string; refresh_expires: number };
    const state = {
      access: created.access,
      accessExpiresAt: now + created.access_expires * 1000,
      refresh: created.refresh,
      refreshExpiresAt: now + created.refresh_expires * 1000,
    };
    tokenCache.set(key, state);
    return state.access;
  }

  private async call<T>(path: string, init: RequestInit = {}) {
    const token = await this.token();
    try {
      return (await this.raw(path, { ...init, token })) as T;
    } catch (error) {
      // Token revocado en el proveedor: se descarta la caché y se reintenta una vez.
      if (error instanceof GoCardlessError && error.status === 401 && /token/i.test(error.detail)) {
        tokenCache.delete(this.config.secretId);
        return (await this.raw(path, { ...init, token: await this.token() })) as T;
      }
      throw error;
    }
  }

  listInstitutions(country = "ES") {
    return this.call<Institution[]>(`/institutions/?country=${encodeURIComponent(country.toLowerCase())}`);
  }

  getInstitution(id: string) {
    return this.call<Institution>(`/institutions/${encodeURIComponent(id)}/`);
  }

  createAgreement(input: { institutionId: string; maxHistoricalDays: number; accessValidForDays: number }) {
    return this.call<Agreement>("/agreements/enduser/", {
      method: "POST",
      body: JSON.stringify({
        institution_id: input.institutionId,
        max_historical_days: input.maxHistoricalDays,
        access_valid_for_days: input.accessValidForDays,
        access_scope: ["balances", "details", "transactions"],
      }),
    });
  }

  createRequisition(input: { institutionId: string; agreementId: string; redirect: string; reference: string }) {
    return this.call<Requisition>("/requisitions/", {
      method: "POST",
      body: JSON.stringify({
        redirect: input.redirect,
        institution_id: input.institutionId,
        agreement: input.agreementId,
        reference: input.reference,
        user_language: "ES",
      }),
    });
  }

  getRequisition(id: string) {
    return this.call<Requisition>(`/requisitions/${encodeURIComponent(id)}/`);
  }

  deleteRequisition(id: string) {
    return this.call<unknown>(`/requisitions/${encodeURIComponent(id)}/`, { method: "DELETE" });
  }

  getAccountDetails(accountId: string) {
    return this.call<AccountDetails>(`/accounts/${encodeURIComponent(accountId)}/details/`);
  }

  getAccountTransactions(accountId: string, dateFrom?: string, dateTo?: string) {
    const query = new URLSearchParams();
    if (dateFrom) query.set("date_from", dateFrom);
    if (dateTo) query.set("date_to", dateTo);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return this.call<TransactionsResponse>(`/accounts/${encodeURIComponent(accountId)}/transactions/${suffix}`);
  }
}

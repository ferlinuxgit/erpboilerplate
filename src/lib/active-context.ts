import { cookies } from "next/headers";

export const ACTIVE_COMPANY_COOKIE = "active-company-id";
export const ACTIVE_FISCAL_YEAR_COOKIE = "active-fiscal-year-id";

export async function getActiveContextCookies() {
  const cookieStore = await cookies();
  return {
    companyId: cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value ?? null,
    fiscalYearId: cookieStore.get(ACTIVE_FISCAL_YEAR_COOKIE)?.value ?? null,
  };
}

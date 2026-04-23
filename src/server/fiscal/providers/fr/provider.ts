import type { FiscalProvider } from "@/server/fiscal/provider";

export const frFiscalProvider: FiscalProvider = {
  countryCode: "FR",
  listReports() {
    return [{ code: "TVA-CA3", name: "TVA CA3 FR" }];
  },
  async buildReport(_companyId, period, code) {
    return { code, period, summary: `Reporte ${code} generado para ${period}.` };
  },
};

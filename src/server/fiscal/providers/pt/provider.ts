import type { FiscalProvider } from "@/server/fiscal/provider";

export const ptFiscalProvider: FiscalProvider = {
  countryCode: "PT",
  listReports() {
    return [
      { code: "IVA-PT-Q", name: "IVA trimestral PT" },
      { code: "IES-PT", name: "IES PT" },
    ];
  },
  async buildReport(_companyId, period, code) {
    return { code, period, summary: `Reporte ${code} generado para ${period}.` };
  },
};

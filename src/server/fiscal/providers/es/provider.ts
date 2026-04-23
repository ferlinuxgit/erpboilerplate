import type { FiscalProvider } from "@/server/fiscal/provider";

export const esFiscalProvider: FiscalProvider = {
  countryCode: "ES",
  listReports() {
    return [
      { code: "303", name: "Modelo 303" },
      { code: "390", name: "Modelo 390" },
      { code: "111", name: "Modelo 111" },
      { code: "115", name: "Modelo 115" },
      { code: "347", name: "Modelo 347" },
    ];
  },
  async buildReport(_companyId, period, code) {
    return { code, period, summary: `Reporte ${code} generado para ${period}.` };
  },
};

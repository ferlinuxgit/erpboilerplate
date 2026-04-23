export type FiscalReportDefinition = {
  code: string;
  name: string;
};

export type FiscalReportData = {
  code: string;
  period: string;
  summary: string;
};

export interface FiscalProvider {
  countryCode: string;
  listReports(): FiscalReportDefinition[];
  buildReport(companyId: string, period: string, code: string): Promise<FiscalReportData>;
  renderPdf?(data: FiscalReportData): Promise<Buffer>;
  exportFile?(data: FiscalReportData): Promise<{ filename: string; content: string }>;
}

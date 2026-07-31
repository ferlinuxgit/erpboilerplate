export type PdfDisplaySettings = {
  showLogo: boolean;
  showEmail: boolean;
  showPhone: boolean;
  showWebsite: boolean;
  showCustomerNumber: boolean;
  showPaymentMethod: boolean;
  showTaxBreakdown: boolean;
};

export const defaultPdfDisplaySettings: PdfDisplaySettings = {
  showLogo: true,
  showEmail: true,
  showPhone: true,
  showWebsite: true,
  showCustomerNumber: true,
  showPaymentMethod: true,
  showTaxBreakdown: true,
};

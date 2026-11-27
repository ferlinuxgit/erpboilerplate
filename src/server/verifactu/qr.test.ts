import { describe, expect, it } from "vitest";

import QRCode from "qrcode";

import { buildVerifactuQrUrl, QR_QUIET_ZONE_MODULES, renderQrPngDataUrl, renderQrSvg, verifactuLegends } from "@/server/verifactu/qr";

const input = {
  mode: "VERIFACTU" as const,
  environment: "test" as const,
  issuerTaxId: "89890001K",
  invoiceNumber: "12345678&G33",
  invoiceIssueDate: "01-01-2024",
  totalAmount: "241.40",
};

describe("VeriFactu QR", () => {
  it("builds the pre-production cotejo URL for a test record with URL-encoded parameters", () => {
    expect(buildVerifactuQrUrl(input, {})).toBe(
      "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K&numserie=12345678%26G33&fecha=01-01-2024&importe=241.40",
    );
  });

  it("takes the host from the environment OF THE RECORD, never from the deployment", () => {
    const production = { ...input, environment: "production" as const };
    // Un registro de producción apunta a producción aunque el proceso esté en pruebas, y al revés.
    expect(buildVerifactuQrUrl(production, { VERIFACTU_ENVIRONMENT: "test" })).toMatch(
      /^https:\/\/www2\.agenciatributaria\.gob\.es\/wlpl\/TIKE-CONT\/ValidarQR\?nif=89890001K&/,
    );
    expect(buildVerifactuQrUrl(input, { VERIFACTU_ENVIRONMENT: "production" })).toMatch(/^https:\/\/prewww2\.aeat\.es\/wlpl\/TIKE-CONT\/ValidarQR\?/);
    expect(buildVerifactuQrUrl({ ...production, mode: "NO_VERIFACTU" }, {})).toContain("/ValidarQRNoVerifactu?");
    expect(buildVerifactuQrUrl(input, { VERIFACTU_QR_BASE_URL: "https://simulador.local/qr" })).toMatch(/^https:\/\/simulador\.local\/qr\?nif=/);
  });

  it("shows a single VERI*FACTU legend, only in VERI*FACTU mode and while sending is operational", () => {
    expect(verifactuLegends("VERIFACTU")).toEqual(["VERI*FACTU"]);
    expect(verifactuLegends("VERIFACTU", false)).toEqual([]);
    expect(verifactuLegends("NO_VERIFACTU")).toEqual([]);
  });

  it("labels test-environment records instead of announcing them as verifiable", () => {
    expect(verifactuLegends("VERIFACTU", true, "test")).toEqual(["ENTORNO DE PRUEBAS · SIN VALIDEZ FISCAL"]);
    expect(verifactuLegends("VERIFACTU", false, "test")).toEqual(["ENTORNO DE PRUEBAS · SIN VALIDEZ FISCAL"]);
    expect(verifactuLegends("VERIFACTU", true, "production")).toEqual(["VERI*FACTU"]);
  });

  it("keeps a quiet zone of at least 2 mm and a symbol of at least 30 mm at the printed sizes", () => {
    // URL realista más larga posible: número de factura de 60 caracteres e importe grande.
    const longest = buildVerifactuQrUrl({ ...input, environment: "production", invoiceNumber: "F".repeat(60), totalAmount: "99999999.99" }, {});
    for (const url of [buildVerifactuQrUrl(input, {}), longest]) {
      const modules = QRCode.create(url, { errorCorrectionLevel: "M" }).modules.size;
      const total = modules + 2 * QR_QUIET_ZONE_MODULES;
      // PDF: imagen de 105 pt (37,04 mm). Ticket: caja de 38 mm.
      for (const printedMm of [105 * 25.4 / 72, 38]) {
        expect(printedMm * QR_QUIET_ZONE_MODULES / total).toBeGreaterThanOrEqual(2);
        expect(printedMm * modules / total).toBeGreaterThanOrEqual(30);
        expect(printedMm * modules / total).toBeLessThanOrEqual(40);
      }
    }
  });

  it("renders the QR as PNG data URL and SVG", async () => {
    const url = buildVerifactuQrUrl(input, {});
    expect(await renderQrPngDataUrl(url)).toMatch(/^data:image\/png;base64,/);
    expect(await renderQrSvg(url)).toContain("<svg");
  });
});

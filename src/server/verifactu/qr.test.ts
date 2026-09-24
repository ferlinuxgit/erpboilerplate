import { describe, expect, it } from "vitest";

import { buildVerifactuQrUrl, renderQrPngDataUrl, renderQrSvg, verifactuLegends } from "@/server/verifactu/qr";

const input = {
  mode: "VERIFACTU" as const,
  issuerTaxId: "89890001K",
  invoiceNumber: "12345678&G33",
  invoiceIssueDate: "01-01-2024",
  totalAmount: "241.40",
};

describe("VeriFactu QR", () => {
  it("builds the pre-production cotejo URL by default with URL-encoded parameters", () => {
    expect(buildVerifactuQrUrl(input, {})).toBe(
      "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K&numserie=12345678%26G33&fecha=01-01-2024&importe=241.40",
    );
  });

  it("uses the production host and the NO VERI*FACTU service when configured", () => {
    expect(buildVerifactuQrUrl(input, { VERIFACTU_ENVIRONMENT: "production" })).toMatch(
      /^https:\/\/www2\.agenciatributaria\.gob\.es\/wlpl\/TIKE-CONT\/ValidarQR\?nif=89890001K&/,
    );
    expect(buildVerifactuQrUrl({ ...input, mode: "NO_VERIFACTU" }, { VERIFACTU_ENVIRONMENT: "production" })).toContain("/ValidarQRNoVerifactu?");
    expect(buildVerifactuQrUrl(input, { VERIFACTU_QR_BASE_URL: "https://simulador.local/qr" })).toMatch(/^https:\/\/simulador\.local\/qr\?nif=/);
  });

  it("shows the VERI*FACTU legends only in VERI*FACTU mode", () => {
    expect(verifactuLegends("VERIFACTU")).toEqual(["VERI*FACTU", "Factura verificable en la sede electrónica de la AEAT"]);
    expect(verifactuLegends("NO_VERIFACTU")).toEqual([]);
  });

  it("renders the QR as PNG data URL and SVG", async () => {
    const url = buildVerifactuQrUrl(input, {});
    expect(await renderQrPngDataUrl(url)).toMatch(/^data:image\/png;base64,/);
    expect(await renderQrSvg(url)).toContain("<svg");
  });
});

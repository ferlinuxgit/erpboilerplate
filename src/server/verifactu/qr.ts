import QRCode from "qrcode";

import { getQrBaseUrl } from "@/server/verifactu/config";

/**
 * Código QR de la factura (art. 20 y 21 Orden HAC/1177/2024 y documento técnico "Características
 * del QR y especificaciones del servicio de cotejo"):
 * - URL del servicio de cotejo con los parámetros nif, numserie, fecha (dd-mm-aaaa) e importe
 *   (ImporteTotal con punto decimal), codificados en URL.
 * - QR ISO/IEC 18004 con nivel de corrección de errores M, de 30×30 a 40×40 mm, al inicio de la factura.
 * - En modo VERI*FACTU, junto al QR la frase "Factura verificable en la sede electrónica de la AEAT"
 *   o "VERI*FACTU". En modo NO VERI*FACTU no se puede usar esa leyenda.
 */

export const VERIFACTU_LEGEND = "VERI*FACTU";
export const VERIFIABLE_LEGEND = "Factura verificable en la sede electrónica de la AEAT";

export type VerifactuQrInput = {
  mode: "VERIFACTU" | "NO_VERIFACTU";
  issuerTaxId: string;
  invoiceNumber: string;
  /** dd-mm-aaaa */
  invoiceIssueDate: string;
  /** Texto exacto de ImporteTotal. */
  totalAmount: string;
};

export function buildVerifactuQrUrl(input: VerifactuQrInput, env: Record<string, string | undefined> = process.env) {
  const params = [
    ["nif", input.issuerTaxId],
    ["numserie", input.invoiceNumber],
    ["fecha", input.invoiceIssueDate],
    ["importe", input.totalAmount],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value.trim())}`)
    .join("&");
  return `${getQrBaseUrl(input.mode, env)}?${params}`;
}

export function verifactuLegends(mode: "VERIFACTU" | "NO_VERIFACTU") {
  return mode === "VERIFACTU" ? [VERIFACTU_LEGEND, VERIFIABLE_LEGEND] : [];
}

/** PNG en data URL (para el PDF) con corrección de errores M. */
export async function renderQrPngDataUrl(url: string) {
  return QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 360 });
}

/** SVG (para la ficha de la factura en la aplicación). */
export async function renderQrSvg(url: string) {
  return QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}

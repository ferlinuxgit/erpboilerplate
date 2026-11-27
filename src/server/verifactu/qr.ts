import QRCode from "qrcode";

import { getQrBaseUrl, TEST_ENVIRONMENT_LEGEND, type VerifactuEnvironment } from "@/server/verifactu/config";

/**
 * Código QR de la factura (art. 20 y 21 Orden HAC/1177/2024 y documento técnico "Características
 * del QR y especificaciones del servicio de cotejo"):
 * - URL del servicio de cotejo con los parámetros nif, numserie, fecha (dd-mm-aaaa) e importe
 *   (ImporteTotal con punto decimal), codificados en URL.
 * - QR ISO/IEC 18004 con nivel de corrección de errores M, de 30×30 a 40×40 mm, al inicio de la
 *   factura (arriba, antes del contenido) y con al menos 2 mm en blanco por los cuatro lados.
 * - Encima del QR, el texto "QR tributario:". Debajo, solo en facturas de un sistema VERI*FACTU,
 *   la frase "Factura verificable en la sede electrónica de la AEAT" o "VERI*FACTU". Ambos textos,
 *   con letra igual o mayor que la del resto de la factura.
 * - La URL es la del entorno en el que nació el registro: un registro de pruebas apunta siempre al
 *   cotejo de pruebas, se pinte donde se pinte, y lleva el rótulo de entorno de pruebas.
 */

export const QR_CAPTION = "QR tributario:";

export const VERIFACTU_LEGEND = "VERI*FACTU";
export const VERIFIABLE_LEGEND = "Factura verificable en la sede electrónica de la AEAT";

export type VerifactuQrInput = {
  mode: "VERIFACTU" | "NO_VERIFACTU";
  /** Entorno del registro (no el del despliegue). */
  environment: VerifactuEnvironment;
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
  return `${getQrBaseUrl(input.mode, input.environment, env)}?${params}`;
}

/**
 * Leyenda bajo el QR. Solo si el registro es VERI*FACTU y el sistema lo está remitiendo de verdad
 * (`operational`): una factura no puede anunciarse como verificable si no se envía a la AEAT.
 */
export function verifactuLegends(mode: "VERIFACTU" | "NO_VERIFACTU", operational = true, environment: VerifactuEnvironment = "production") {
  // Un registro de pruebas no llega a la AEAT real: no se anuncia como verificable y se rotula.
  if (environment === "test") return [TEST_ENVIRONMENT_LEGEND];
  return mode === "VERIFACTU" && operational ? [VERIFACTU_LEGEND] : [];
}

/**
 * Zona en blanco del QR, en módulos por cada lado. La norma ISO/IEC 18004 pide 4; con un QR de
 * 30 mm o más y esta URL (versión 6 a 9, 41 a 53 módulos) son siempre más de los 2 mm exigidos.
 */
export const QR_QUIET_ZONE_MODULES = 4;

/** PNG en data URL (para el PDF) con corrección de errores M. */
export async function renderQrPngDataUrl(url: string) {
  return QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: QR_QUIET_ZONE_MODULES, width: 480 });
}

/** SVG (para la ficha de la factura en la aplicación). */
export async function renderQrSvg(url: string) {
  return QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: QR_QUIET_ZONE_MODULES });
}

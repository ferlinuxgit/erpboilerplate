import { createCipheriv, createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Redsys (TPV virtual de los bancos españoles), versión HMAC_SHA256_V1:
 * - pago: el navegador del cliente se envía a Redsys con los parámetros firmados;
 * - notificación: Redsys llama a nuestra URL (servidor a servidor) con el resultado firmado;
 * - devolución: petición REST firmada (tipo de operación 3).
 * La clave de firma de cada operación se obtiene cifrando el número de pedido con 3DES y la clave
 * secreta del comercio; con ella se calcula el HMAC-SHA256 de los parámetros en base64.
 */

export type RedsysEnvironment = "test" | "live";
export type RedsysCredentials = { merchantCode: string; terminal: string; merchantKey: string; environment: RedsysEnvironment };

const ENDPOINTS: Record<RedsysEnvironment, { redirect: string; rest: string }> = {
  test: { redirect: "https://sis-t.redsys.es:25443/sis/realizarPago", rest: "https://sis-t.redsys.es:25443/sis/rest/trataPeticionREST" },
  live: { redirect: "https://sis.redsys.es/sis/realizarPago", rest: "https://sis.redsys.es/sis/rest/trataPeticionREST" },
};

/** Número de pedido Redsys: 12 caracteres, los 4 primeros numéricos. */
export function redsysOrderNumber(now = Date.now()) {
  return `${String(now).slice(-8)}${String(randomInt(10_000)).padStart(4, "0")}`;
}

function orderKey(order: string, merchantKey: string) {
  const key = Buffer.from(merchantKey, "base64");
  const iv = Buffer.alloc(8, 0);
  const cipher = createCipheriv("des-ede3-cbc", key, iv);
  cipher.setAutoPadding(false);
  const data = Buffer.from(order, "utf8");
  const padded = Buffer.concat([data, Buffer.alloc((8 - (data.length % 8)) % 8, 0)]);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

export function encodeParameters(parameters: Record<string, string>) {
  return Buffer.from(JSON.stringify(parameters), "utf8").toString("base64");
}

export function decodeParameters(encoded: string): Record<string, string> {
  return JSON.parse(Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as Record<string, string>;
}

/** Firma (base64) de unos parámetros codificados para un número de pedido. */
export function redsysSignature(encodedParameters: string, order: string, merchantKey: string) {
  return createHmac("sha256", orderKey(order, merchantKey)).update(encodedParameters).digest("base64");
}

const normalize = (signature: string) => signature.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");

/** Comprueba una notificación de Redsys y devuelve sus parámetros (o null si la firma no cuadra). */
export function verifyRedsysNotification(encodedParameters: string, signature: string, merchantKey: string) {
  let parameters: Record<string, string>;
  try {
    parameters = decodeParameters(encodedParameters);
  } catch {
    return null;
  }
  const order = parameters.Ds_Order ?? parameters.DS_ORDER;
  if (!order) return null;
  const expected = Buffer.from(normalize(redsysSignature(encodedParameters, order, merchantKey)));
  const received = Buffer.from(normalize(signature));
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  return parameters;
}

/** Ds_Response 0000–0099 = pago autorizado. */
export function isRedsysAuthorized(parameters: Record<string, string>) {
  const code = Number(parameters.Ds_Response ?? parameters.DS_RESPONSE ?? "9999");
  return Number.isInteger(code) && code >= 0 && code <= 99;
}

/** Formulario que el navegador envía a Redsys para pagar. */
export function redsysPaymentForm(credentials: RedsysCredentials, input: { order: string; amountCents: number; description: string; merchantName: string; urlOk: string; urlKo: string; notificationUrl: string }) {
  const parameters = {
    DS_MERCHANT_AMOUNT: String(input.amountCents),
    DS_MERCHANT_ORDER: input.order,
    DS_MERCHANT_MERCHANTCODE: credentials.merchantCode,
    DS_MERCHANT_CURRENCY: "978",
    DS_MERCHANT_TRANSACTIONTYPE: "0",
    DS_MERCHANT_TERMINAL: credentials.terminal,
    DS_MERCHANT_MERCHANTURL: input.notificationUrl,
    DS_MERCHANT_URLOK: input.urlOk,
    DS_MERCHANT_URLKO: input.urlKo,
    DS_MERCHANT_PRODUCTDESCRIPTION: input.description.slice(0, 125),
    DS_MERCHANT_MERCHANTNAME: input.merchantName.slice(0, 25),
    DS_MERCHANT_CONSUMERLANGUAGE: "001",
  };
  const encoded = encodeParameters(parameters);
  return {
    url: ENDPOINTS[credentials.environment].redirect,
    fields: { Ds_SignatureVersion: "HMAC_SHA256_V1", Ds_MerchantParameters: encoded, Ds_Signature: redsysSignature(encoded, input.order, credentials.merchantKey) },
  };
}

/** Devolución (total o parcial) de un pago autorizado. */
export async function redsysRefund(credentials: RedsysCredentials, input: { order: string; amountCents: number }) {
  const parameters = {
    DS_MERCHANT_AMOUNT: String(input.amountCents),
    DS_MERCHANT_ORDER: input.order,
    DS_MERCHANT_MERCHANTCODE: credentials.merchantCode,
    DS_MERCHANT_CURRENCY: "978",
    DS_MERCHANT_TRANSACTIONTYPE: "3",
    DS_MERCHANT_TERMINAL: credentials.terminal,
  };
  const encoded = encodeParameters(parameters);
  const response = await fetch(ENDPOINTS[credentials.environment].rest, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Ds_SignatureVersion: "HMAC_SHA256_V1", Ds_MerchantParameters: encoded, Ds_Signature: redsysSignature(encoded, input.order, credentials.merchantKey) }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => ({}))) as { Ds_MerchantParameters?: string; errorCode?: string };
  if (!response.ok || body.errorCode || !body.Ds_MerchantParameters) throw new Error(`Redsys rechazó la devolución${body.errorCode ? ` (${body.errorCode})` : ""}.`);
  const result = decodeParameters(body.Ds_MerchantParameters);
  if (!isRedsysAuthorized(result)) throw new Error(`Redsys rechazó la devolución (código ${result.Ds_Response ?? "?"}).`);
  return result;
}

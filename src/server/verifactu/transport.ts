import { readFile } from "node:fs/promises";
import { request } from "node:https";

import { getVerifactuTransportConfig, type VerifactuTransportConfig } from "@/server/verifactu/config";

/**
 * Transporte del envío a la AEAT. Intercambiable: en tests se inyecta uno falso; en producción,
 * el de mTLS con certificado cualificado (sello o representante) solo si está configurado.
 */
export interface VerifactuTransport {
  readonly kind: string;
  send(soapXml: string): Promise<{ httpStatus: number; body: string }>;
}

/** Transporte HTTPS con autenticación de cliente (certificado .p12/.pfx). */
export function createAeatHttpsTransport(config: Extract<VerifactuTransportConfig, { kind: "aeat" }>, timeoutMs = 60_000): VerifactuTransport {
  let pfx: Buffer | null = null;
  return {
    kind: "aeat",
    async send(soapXml) {
      pfx ??= await readFile(config.certPath);
      const url = new URL(config.endpoint);
      const body = Buffer.from(soapXml, "utf8");
      return new Promise((resolve, reject) => {
        const req = request(
          {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || 443,
            path: `${url.pathname}${url.search}`,
            method: "POST",
            pfx: pfx!,
            passphrase: config.certPassword,
            headers: {
              "Content-Type": "text/xml; charset=utf-8",
              "Content-Length": body.length,
              SOAPAction: "",
            },
            timeout: timeoutMs,
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => resolve({ httpStatus: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
            response.on("error", reject);
          },
        );
        req.on("timeout", () => req.destroy(new Error("Tiempo de espera agotado al conectar con la AEAT.")));
        req.on("error", reject);
        req.end(body);
      });
    },
  };
}

/** Transporte según el entorno; null si el envío no está configurado (los registros quedan pendientes). */
export function getConfiguredTransport(env: Record<string, string | undefined> = process.env): { transport: VerifactuTransport | null; reason: string | null } {
  const config = getVerifactuTransportConfig(env);
  if (config.kind === "disabled") return { transport: null, reason: config.reason };
  return { transport: createAeatHttpsTransport(config), reason: null };
}

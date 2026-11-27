import { readFile } from "node:fs/promises";
import { request } from "node:https";

import { getVerifactuEndpoint, getVerifactuTransportConfig, type VerifactuEnvironment, type VerifactuTransportConfig } from "@/server/verifactu/config";

/**
 * Transporte del envío a la AEAT. Intercambiable: en tests se inyecta uno falso; en producción,
 * el de mTLS con certificado cualificado (sello o representante) solo si está configurado.
 */
export type VerifactuCredentials = {
  pfx: Buffer;
  passphrase: string;
  /** Certificado de sello electrónico: se remite por el punto de acceso de sello de la AEAT. */
  seal?: boolean;
  /** Caducidad del certificado, si se conoce: con uno caducado no se intenta el envío. */
  validTo?: Date | null;
};

/** Destino de un envío: el entorno de los registros que viajan en él. */
export type VerifactuSendTarget = { environment: VerifactuEnvironment };

export interface VerifactuTransport {
  readonly kind: string;
  /**
   * Entorno de la AEAT en el que trabaja este despliegue: solo se remiten los registros nacidos en
   * él. Sin declarar (transportes de prueba), el entorno del proceso.
   */
  readonly environment?: VerifactuEnvironment;
  /** true si el transporte no tiene certificado del sistema: cada envío necesita el de la empresa. */
  readonly requiresCredentials?: boolean;
  send(soapXml: string, credentials?: VerifactuCredentials | null, target?: VerifactuSendTarget): Promise<{ httpStatus: number; body: string }>;
}

/** URL a la que va un envío: entorno de los registros y tipo del certificado que firma la conexión. */
export function endpointForSend(
  config: Extract<VerifactuTransportConfig, { kind: "aeat" }>,
  credentials: VerifactuCredentials | null | undefined,
  target: VerifactuSendTarget | undefined,
  env: Record<string, string | undefined> = process.env,
) {
  const environment = target?.environment ?? config.environment;
  if (environment !== config.environment) {
    throw new Error(`Se ha intentado remitir un registro del entorno «${environment}» desde un servidor configurado para «${config.environment}».`);
  }
  return getVerifactuEndpoint({ environment, seal: credentials ? Boolean(credentials.seal) : config.certSeal }, env);
}

/** Transporte HTTPS con autenticación de cliente (certificado .p12/.pfx). */
export function createAeatHttpsTransport(config: Extract<VerifactuTransportConfig, { kind: "aeat" }>, timeoutMs = 60_000): VerifactuTransport {
  let systemPfx: Buffer | null = null;
  return {
    kind: "aeat",
    environment: config.environment,
    requiresCredentials: !config.certPath,
    async send(soapXml, credentials, target) {
      if (!credentials && !config.certPath) throw new Error("La empresa no tiene certificado electrónico para remitir a la AEAT.");
      if (!credentials) systemPfx ??= await readFile(config.certPath!);
      const pfx = credentials?.pfx ?? systemPfx!;
      const passphrase = credentials ? credentials.passphrase : config.certPassword;
      const url = new URL(endpointForSend(config, credentials, target));
      const body = Buffer.from(soapXml, "utf8");
      return new Promise((resolve, reject) => {
        const req = request(
          {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || 443,
            path: `${url.pathname}${url.search}`,
            method: "POST",
            pfx,
            passphrase,
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

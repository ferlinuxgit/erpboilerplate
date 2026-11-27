import { readFile } from "node:fs/promises";
import { request } from "node:https";

import { getSiiEndpoint, getSiiTransportConfig, type SiiEnvironment, type SiiTransportConfig } from "@/server/sii/config";
import type { SiiBook } from "@/server/sii/types";
import type { VerifactuCredentials } from "@/server/verifactu/transport";

/**
 * Transporte del envío al SII: HTTPS con autenticación de cliente (mTLS) con el certificado de la
 * empresa —el mismo que usa para VERI*FACTU— o, si lo hay, el del sistema. Intercambiable: en los
 * tests se inyecta uno falso y nunca se llama a la AEAT.
 */
export type SiiCredentials = VerifactuCredentials;
export type SiiSendTarget = { book: SiiBook; environment: SiiEnvironment };

export interface SiiTransport {
  readonly kind: string;
  /** Entorno de este despliegue: solo se envían los registros nacidos en él. */
  readonly environment: SiiEnvironment;
  /** true si no hay certificado del sistema: cada envío necesita el de la empresa. */
  readonly requiresCredentials?: boolean;
  send(soapXml: string, target: SiiSendTarget, credentials?: SiiCredentials | null): Promise<{ httpStatus: number; body: string }>;
}

export function createAeatSiiTransport(config: Extract<SiiTransportConfig, { kind: "aeat" }>, timeoutMs = 120_000): SiiTransport {
  let systemPfx: Buffer | null = null;
  return {
    kind: "aeat",
    environment: config.environment,
    requiresCredentials: !config.certPath,
    async send(soapXml, target, credentials) {
      if (target.environment !== config.environment) {
        throw new Error(`Se ha intentado enviar al SII un registro del entorno «${target.environment}» desde un servidor configurado para «${config.environment}».`);
      }
      if (!credentials && !config.certPath) throw new Error("La empresa no tiene certificado electrónico para enviar al SII.");
      if (!credentials) systemPfx ??= await readFile(config.certPath!);
      const pfx = credentials?.pfx ?? systemPfx!;
      const passphrase = credentials ? credentials.passphrase : config.certPassword;
      const url = new URL(getSiiEndpoint({ book: target.book, environment: target.environment, seal: credentials ? Boolean(credentials.seal) : config.certSeal }));
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
            headers: { "Content-Type": "text/xml; charset=utf-8", "Content-Length": body.length, SOAPAction: "" },
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
export function getConfiguredSiiTransport(env: Record<string, string | undefined> = process.env): { transport: SiiTransport | null; reason: string | null } {
  const config = getSiiTransportConfig(env);
  if (config.kind === "disabled") return { transport: null, reason: config.reason };
  return { transport: createAeatSiiTransport(config), reason: null };
}

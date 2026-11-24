/**
 * Protocolo MCP (JSON-RPC 2.0 sobre "Streamable HTTP" sin estado): cada POST trae un mensaje o un
 * lote y se responde con JSON. Sin sesiones ni notificaciones del servidor: solo herramientas.
 */
import { callTool, listTools, type McpCallContext } from "@/server/mcp/tools";

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const SERVER_VERSION = "1.0.0";

export const MCP_INSTRUCTIONS = [
  "Servidor MCP del ERP (ventas, compras, gastos, tesorería, contabilidad, fiscalidad, inventario, TPV y CRM) de la empresa que el usuario autorizó.",
  "Empieza por erp_contexto si no sabes qué empresa, rol o módulos hay. Para consultar usa search/fetch, erp_panel, erp_indicadores, erp_calculo_fiscal, erp_estados_financieros o los erp_listar_*.",
  "Cualquier otra acción de la aplicación está en erp_catalogo → erp_describir_accion → erp_ejecutar_accion.",
  "Antes de crear, emitir, modificar o borrar datos, resume lo que vas a hacer y pide confirmación al usuario. Los importes van en la moneda de la empresa y las fechas en AAAA-MM-DD.",
].join("\n");

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> };
export type JsonRpcResponse = { jsonrpc: "2.0"; id: JsonRpcId; result?: unknown; error?: { code: number; message: string; data?: unknown } };

function failure(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Procesa un mensaje JSON-RPC; null para notificaciones (sin respuesta). */
export async function handleMcpMessage(message: unknown, context: McpCallContext): Promise<JsonRpcResponse | null> {
  if (!message || typeof message !== "object" || Array.isArray(message)) return failure(null, -32600, "Petición JSON-RPC no válida.");
  const request = message as JsonRpcRequest;
  const id = request.id ?? null;
  const isNotification = request.id === undefined;
  // Un mensaje mal formado nunca es una notificación válida: siempre se responde (id null si falta).
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") return failure(id, -32600, "Petición JSON-RPC no válida.");

  switch (request.method) {
    case "initialize": {
      const requested = typeof request.params?.protocolVersion === "string" ? request.params.protocolVersion : "";
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "norpie", title: "Norpie", version: SERVER_VERSION },
          instructions: MCP_INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return isNotification ? null : { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: listTools(context.scope) } };
    case "tools/call": {
      const name = typeof request.params?.name === "string" ? request.params.name : "";
      if (!name) return failure(id, -32602, "Falta el nombre de la herramienta.");
      const args = request.params?.arguments && typeof request.params.arguments === "object" ? (request.params.arguments as Record<string, unknown>) : {};
      return { jsonrpc: "2.0", id, result: await callTool(name, args, context) };
    }
    case "resources/list":
      return { jsonrpc: "2.0", id, result: { resources: [] } };
    case "prompts/list":
      return { jsonrpc: "2.0", id, result: { prompts: [] } };
    default:
      if (isNotification || request.method.startsWith("notifications/")) return null;
      return failure(id, -32601, `Método no soportado: ${request.method}.`);
  }
}

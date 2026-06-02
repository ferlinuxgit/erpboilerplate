"use client";

import { ClipboardCopy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ApiEndpoint = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  request: string;
  response: string;
};

type ApiTokenOption = {
  id: string;
  name: string;
  revokedAt: Date | string | null;
};

type ApiKeySecretEvent = CustomEvent<{
  keyId: string;
  name: string;
  plainKey: string;
}>;

const endpoints: ApiEndpoint[] = [
  {
    method: "GET",
    path: "/api/customers",
    summary: "Lista clientes de la empresa activa.",
    request: "Authorization: Bearer ak_...",
    response: "{ data: Customer[] }",
  },
  {
    method: "POST",
    path: "/api/customers",
    summary: "Crea un cliente con datos fiscales.",
    request: "{ name, taxId, address, postalCode, city, province, countryCode, email?, phone? }",
    response: "{ id, name, email, phone, status, partnerId }",
  },
  {
    method: "GET",
    path: "/api/customers/{id}",
    summary: "Devuelve un cliente y sus datos fiscales.",
    request: "Authorization: Bearer ak_...",
    response: "{ id, name, taxId, address, status, ... }",
  },
  {
    method: "PATCH",
    path: "/api/customers/{id}",
    summary: "Actualiza un cliente.",
    request: "{ name, taxId, address, postalCode, city, province, countryCode, status? }",
    response: "{ id, name, status, ... }",
  },
  {
    method: "DELETE",
    path: "/api/customers/{id}",
    summary: "Elimina un cliente si no está restringido por relaciones.",
    request: "Authorization: Bearer ak_...",
    response: "{ ok: true }",
  },
  {
    method: "GET",
    path: "/api/invoices",
    summary: "Lista facturas de venta.",
    request: "Authorization: Bearer ak_...",
    response: "{ data: Invoice[] }",
  },
  {
    method: "POST",
    path: "/api/invoices",
    summary: "Crea una factura y opcionalmente devuelve el PDF en base64.",
    request: "{ customerId? | newCustomer?, issueDate, dueDate?, totalAmount, lines, returnPdf? }",
    response: "{ id, number, status, pdfUrl, pdf? }",
  },
  {
    method: "GET",
    path: "/api/invoices/{id}",
    summary: "Devuelve una factura con líneas.",
    request: "Authorization: Bearer ak_...",
    response: "{ id, number, status, lines, ... }",
  },
  {
    method: "GET",
    path: "/api/invoices/{id}/pdf",
    summary: "Devuelve el PDF generado de la factura.",
    request: "Authorization: Bearer ak_...",
    response: "application/pdf",
  },
  {
    method: "PATCH",
    path: "/api/invoices/{id}",
    summary: "Actualiza estado, notas y líneas de una factura.",
    request: "{ status, notes?, totalAmount, lines }",
    response: "{ id, number, status, ... }",
  },
  {
    method: "DELETE",
    path: "/api/invoices/{id}",
    summary: "Elimina una factura si el periodo fiscal está abierto.",
    request: "Authorization: Bearer ak_...",
    response: "{ ok: true }",
  },
];

const methodTone = {
  GET: "info",
  POST: "success",
  PATCH: "warning",
  DELETE: "danger",
} as const;

function invoiceExample(token: string) {
  return `curl "$ERP_BASE_URL/api/invoices" \\
  -X POST \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "customerId": "customer-id",
    "issueDate": "2026-06-02",
    "totalAmount": 121,
    "returnPdf": true,
    "lines": [
      { "description": "Servicio API", "quantity": 1, "unitPrice": 100, "taxRate": 21 }
    ]
  }'`;
}

function buildDocumentationCopy(tokenName: string, token: string) {
  const endpointLines = endpoints
    .map((endpoint) => [
      `${endpoint.method} ${endpoint.path}`,
      `Uso: ${endpoint.summary}`,
      `Peticion: ${endpoint.request.replaceAll("Authorization: Bearer ak_...", `Authorization: Bearer ${token}`)}`,
      `Respuesta: ${endpoint.response}`,
    ].join("\n"))
    .join("\n\n");

  return [
    "ERP API - Documentacion de integracion",
    `Token seleccionado: ${tokenName}`,
    "",
    "Base URL",
    "https://erp.comodore.es",
    "Ejemplo de endpoint completo: https://erp.comodore.es/api/invoices",
    "",
    "Autenticacion",
    `Authorization: Bearer ${token}`,
    "",
    "Endpoints",
    endpointLines,
    "",
    "Ejemplo: crear factura y devolver PDF en base64",
    invoiceExample(token),
  ].join("\n");
}

export function ApiDocumentationPanel({ tokens }: { tokens: ApiTokenOption[] }) {
  const activeTokens = tokens.filter((token) => !token.revokedAt);
  const [selectedTokenId, setSelectedTokenId] = useState(activeTokens[0]?.id ?? "");
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, string>>({});
  const [manualToken, setManualToken] = useState("");

  useEffect(() => {
    function handleSecret(event: Event) {
      const { detail } = event as ApiKeySecretEvent;
      setVisibleSecrets((current) => ({ ...current, [detail.keyId]: detail.plainKey }));
      setSelectedTokenId(detail.keyId);
    }

    window.addEventListener("api-key-secret-visible", handleSecret);
    return () => window.removeEventListener("api-key-secret-visible", handleSecret);
  }, []);

  const selectedToken = activeTokens.find((token) => token.id === selectedTokenId) ?? activeTokens[0] ?? null;
  const selectedSecret = selectedToken ? visibleSecrets[selectedToken.id] : null;
  const effectiveToken = manualToken.trim() || selectedSecret || "$ERP_API_KEY";
  const selectedTokenName = selectedToken?.name ?? "Token no seleccionado";
  const example = useMemo(() => invoiceExample(effectiveToken), [effectiveToken]);

  async function copyFullDocumentation() {
    await navigator.clipboard.writeText(buildDocumentationCopy(selectedTokenName, effectiveToken));
    toast.success("Documentación API copiada.");
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-end">
        <p className="text-xs text-muted-foreground md:col-span-3">
          Base URL para integraciones: <code>https://erp.comodore.es</code>. Configura los endpoints como rutas relativas, por ejemplo <code>/api/customers</code> o <code>/api/invoices</code>.
        </p>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="api-doc-token">
            Token seleccionado
          </label>
          <select
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
            id="api-doc-token"
            onChange={(event) => setSelectedTokenId(event.target.value)}
            value={selectedTokenId}
          >
            {activeTokens.length === 0 ? <option value="">Sin tokens activos</option> : null}
            {activeTokens.map((token) => (
              <option key={token.id} value={token.id}>
                {token.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="api-doc-token-secret">
            Secreto para ejemplos
          </label>
          <Input
            id="api-doc-token-secret"
            onChange={(event) => setManualToken(event.target.value)}
            placeholder={selectedSecret ? "Se usará el token recién generado" : "Pega el secreto si quieres reemplazar $ERP_API_KEY"}
            type="password"
            value={manualToken}
          />
        </div>
        <Button disabled={!selectedToken && !manualToken.trim()} onClick={copyFullDocumentation} type="button">
          <ClipboardCopy aria-hidden="true" />
          Copiar documentación
        </Button>
        <p className="text-xs text-muted-foreground md:col-span-3">
          Los secretos ya creados no se pueden recuperar porque se guardan hasheados. La documentación usará automáticamente el secreto recién creado o rotado mientras siga visible; también puedes pegarlo manualmente.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Método</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Uso</TableHead>
              <TableHead>Petición</TableHead>
              <TableHead>Respuesta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {endpoints.map((endpoint) => (
              <TableRow key={`${endpoint.method}-${endpoint.path}`}>
                <TableCell>
                  <StatusBadge tone={methodTone[endpoint.method]}>{endpoint.method}</StatusBadge>
                </TableCell>
                <TableCell>
                  <code className="text-xs">{endpoint.path}</code>
                </TableCell>
                <TableCell className="min-w-56">{endpoint.summary}</TableCell>
                <TableCell className="min-w-64">
                  <code className="text-xs text-muted-foreground">{endpoint.request}</code>
                </TableCell>
                <TableCell className="min-w-52">
                  <code className="text-xs text-muted-foreground">{endpoint.response}</code>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-medium">Ejemplo de creación de factura con PDF</p>
          <Button
            onClick={async () => {
              await navigator.clipboard.writeText(example);
              toast.success("Ejemplo copiado.");
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <ClipboardCopy aria-hidden="true" />
            Copiar
          </Button>
        </div>
        <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs">
          <code>{example}</code>
        </pre>
      </div>
    </div>
  );
}

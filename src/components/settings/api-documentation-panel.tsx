import { BadgeButton } from "@/components/settings/badge-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ApiEndpoint = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  request: string;
  response: string;
};

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
    request: "{ customerId? | newCustomer?, number, issueDate, dueDate?, totalAmount, lines, returnPdf? }",
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
    request: "{ number, status, notes?, totalAmount, lines }",
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

const example = `curl "$ERP_BASE_URL/api/invoices" \\
  -X POST \\
  -H "Authorization: Bearer $ERP_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "customerId": "customer-id",
    "number": "FAC-API-0001",
    "issueDate": "2026-06-02",
    "totalAmount": 121,
    "returnPdf": true,
    "lines": [
      { "description": "Servicio API", "quantity": 1, "unitPrice": 100, "taxRate": 21 }
    ]
  }'`;

export function ApiDocumentationPanel() {
  return (
    <div className="space-y-5">
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
          <BadgeButton value={example} />
        </div>
        <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs">
          <code>{example}</code>
        </pre>
      </div>
    </div>
  );
}

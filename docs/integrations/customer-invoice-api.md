# Customer and Invoice API

This API can be called either with the normal web session token or with an API key created in the application.

## Authentication

Send the API key as a bearer token:

```bash
curl "$ERP_BASE_URL/api/customers" \
  -H "Authorization: Bearer $ERP_API_KEY"
```

API keys currently use the first company configured for the tenant and run with integration-level access for customer and invoice operations.

## Customers

Create a customer:

```bash
curl "$ERP_BASE_URL/api/customers" \
  -X POST \
  -H "Authorization: Bearer $ERP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Cliente Integracion SL",
    "taxId": "B12345674",
    "address": "Calle API 1",
    "postalCode": "28013",
    "city": "Madrid",
    "province": "Madrid",
    "countryCode": "ES",
    "email": "facturacion@example.test",
    "phone": "+34 600 000 000"
  }'
```

List customers:

```bash
curl "$ERP_BASE_URL/api/customers" \
  -H "Authorization: Bearer $ERP_API_KEY"
```

Read one customer:

```bash
curl "$ERP_BASE_URL/api/customers/$CUSTOMER_ID" \
  -H "Authorization: Bearer $ERP_API_KEY"
```

## Invoices

Create an invoice with an existing customer:

```bash
curl "$ERP_BASE_URL/api/invoices" \
  -X POST \
  -H "Authorization: Bearer $ERP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "'$CUSTOMER_ID'",
    "number": "FAC-API-0001",
    "issueDate": "2026-06-02",
    "dueDate": "2026-06-17",
    "totalAmount": 121,
    "notes": "Factura creada desde integracion",
    "returnPdf": true,
    "lines": [
      {
        "description": "Servicio API",
        "quantity": 1,
        "unitPrice": 100,
        "taxRate": 21
      }
    ]
  }'
```

When `returnPdf` is `true`, the response includes `pdfUrl` and a `pdf` object with base64 data:

```json
{
  "id": "invoice-id",
  "number": "FAC-API-0001",
  "status": "DRAFT",
  "pdfUrl": "/api/invoices/invoice-id/pdf",
  "pdf": {
    "filename": "invoice-FAC-API-0001.pdf",
    "contentType": "application/pdf",
    "encoding": "base64",
    "data": "JVBERi0x..."
  }
}
```

Create an invoice and customer in one request:

```bash
curl "$ERP_BASE_URL/api/invoices" \
  -X POST \
  -H "Authorization: Bearer $ERP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "newCustomer": {
      "name": "Nuevo Cliente API SL",
      "taxId": "B12345674",
      "address": "Calle API 2",
      "postalCode": "28013",
      "city": "Madrid",
      "province": "Madrid",
      "countryCode": "ES"
    },
    "number": "FAC-API-0002",
    "issueDate": "2026-06-02",
    "totalAmount": 121,
    "lines": [
      {
        "description": "Servicio API",
        "quantity": 1,
        "unitPrice": 100,
        "taxRate": 21
      }
    ]
  }'
```

List invoices:

```bash
curl "$ERP_BASE_URL/api/invoices" \
  -H "Authorization: Bearer $ERP_API_KEY"
```

Read one invoice:

```bash
curl "$ERP_BASE_URL/api/invoices/$INVOICE_ID" \
  -H "Authorization: Bearer $ERP_API_KEY"
```

Download the generated invoice PDF:

```bash
curl "$ERP_BASE_URL/api/invoices/$INVOICE_ID/pdf" \
  -H "Authorization: Bearer $ERP_API_KEY" \
  -o "$INVOICE_ID.pdf"
```

## Next Integration Hardening

The next API layer should add stable `/api/v1` contracts, key prefixes for fast lookup, per-key scopes, idempotency keys, pagination, filtering, webhooks, and OpenAPI documentation.

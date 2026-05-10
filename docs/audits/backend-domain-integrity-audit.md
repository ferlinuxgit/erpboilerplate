# Backend/domain integrity audit

Estado: auditoría estática L0-B generada por inspección de código. No ejecuta migraciones ni llamadas HTTP reales.

## Alcance

- Proyecto inspeccionado: `/root/projects/erpboilerplate`.
- API inspeccionada: `src/app/api/**/route.ts`.
- Total `route.ts`: 56.
- Backend/domain inspeccionado: `src/lib/{current-context,current-user,rbac,tenant}.ts`, `src/server/**`, `src/db/schema.ts`.
- Criterio de endpoint crítico: usa `requireContext`, escribe en DB, llama servicios de mutación, o toca dominios sensibles (tenant/company/user/role/accounting/fiscal/treasury/sales/purchases/payments).

## Comandos reproducibles

Ejecutar desde `/root/projects/erpboilerplate`:

```bash
python - <<'PY'
from pathlib import Path
root=Path('src/app/api')
files=sorted(root.rglob('route.ts'))
print(len(files))
for f in files: print(f)
PY
rg -n 'requireContext\(|getUserSession\(|ensureUserTenant\(|request\.json\(|safeParse\(|\.parse\(' src/app/api
rg -n 'recordAudit\(|logAudit\(|auditLog|db\.(insert|update|delete|transaction)' src/app/api src/server
rg -n 'export const .* = pgTable' src/db/schema.ts
git status --short
git diff -- docs/audits/backend-domain-integrity-audit.md
```

## Resumen cuantitativo

| Métrica | Valor |
|---|---:|
| route_files | 56 |
| methods | {'GET': 38, 'POST': 39, 'PUT': 1, 'PATCH': 9, 'DELETE': 8} |
| requireContext_files | 2 |
| getUserSession_files | 51 |
| ensureUserTenant_files | 46 |
| requestJson_files | 42 |
| zod_or_validation_files | 20 |
| direct_db_write_files | 24 |
| audit_ref_route_files | 2 |
| server_files | 21 |
| schema_tables | 52 |
| findings_total | 63 |

## Modelo de datos observado

`src/db/schema.ts` declara 52 tablas Drizzle `pgTable`. Tablas detectadas:

| Export | Tabla | Línea |
|---|---|---:|
| `user` | `user` | 28 |
| `session` | `session` | 38 |
| `tenant` | `tenant` | 82 |
| `company` | `company` | 105 |
| `fiscalYear` | `fiscal_year` | 118 |
| `country` | `country` | 127 |
| `currency` | `currency` | 132 |
| `permission` | `permission` | 152 |
| `auditLog` | `audit_log` | 168 |
| `documentSeries` | `document_series` | 180 |
| `documentAttachment` | `document_attachment` | 189 |
| `itemCategory` | `item_category` | 199 |
| `unitOfMeasure` | `unit_of_measure` | 208 |
| `paymentMethod` | `payment_method` | 217 |
| `taxRetention` | `tax_retention` | 227 |
| `companySettings` | `company_settings` | 236 |
| `partner` | `partner` | 250 |
| `customer` | `customer` | 271 |
| `item` | `item` | 283 |
| `warehouse` | `warehouse` | 301 |
| `stockMovement` | `stock_movement` | 308 |
| `itemCostHistory` | `item_cost_history` | 332 |
| `invoiceLine` | `invoice_line` | 361 |
| `salesQuote` | `sales_quote` | 371 |
| `salesQuoteLine` | `sales_quote_line` | 387 |
| `salesOrder` | `sales_order` | 400 |
| `salesOrderLine` | `sales_order_line` | 416 |
| `deliveryNote` | `delivery_note` | 429 |
| `deliveryNoteLine` | `delivery_note_line` | 441 |
| `invoicePayment` | `invoice_payment` | 449 |
| `purchaseOrder` | `purchase_order` | 458 |
| `purchaseOrderLine` | `purchase_order_line` | 467 |
| `goodsReceipt` | `goods_receipt` | 477 |
| `goodsReceiptLine` | `goods_receipt_line` | 483 |
| `supplierInvoice` | `supplier_invoice` | 490 |
| `supplierInvoiceLine` | `supplier_invoice_line` | 498 |
| `journal` | `journal` | 508 |
| `accountChart` | `account_chart` | 515 |
| `journalEntry` | `journal_entry` | 523 |
| `journalLine` | `journal_line` | 531 |
| `bankAccount` | `bank_account` | 539 |
| `bankTransaction` | `bank_transaction` | 546 |
| `tax` | `tax` | 558 |
| `fiscalReport` | `fiscal_report` | 565 |
| `kpiSnapshot` | `kpi_snapshot` | 573 |
| `subscription` | `subscription` | 581 |
| `apiKey` | `api_key` | 589 |
| `invitation` | `invitation` | 597 |
| `plan` | `plan` | 608 |
| `payment` | `payment` | 617 |
| `supplierPayment` | `supplier_payment` | 626 |
| `supplierInvoicePayment` | `supplier_invoice_payment` | 635 |

## Patrones de autorización y contexto

- `requireContext()` aparece en rutas que necesitan `tenantId`, `companyId` y usuario actor para dominios contables/ERP.
- Muchas rutas usan `getUserSession()` + `ensureUserTenant()` para comprobar sesión y pertenencia, pero sin elevar a `requireContext()`; eso es aceptable para lectura/onboarding, pero en mutaciones críticas conviene uniformar.
- `recordAudit()` vive en `src/server/audit.ts:14` y persiste `tenantId`, `companyId`, `actorUserId`, `action`, `entityName`, `entityId`, `payload` serializado.
- Los servicios de compras, tesorería, fiscalidad y autopost contable sí registran auditoría en mutaciones relevantes.

## Hallazgos

Nota: los hallazgos son señales de auditoría estática. `getUserSession()` + `ensureUserTenant()` puede ser suficiente en algunas rutas, pero las mutaciones críticas quedan marcadas para revisar si conviene normalizarlas con `requireContext()` o un helper equivalente.

| Severidad | Endpoint | Archivo | Hallazgo | Evidencia |
|---|---|---|---|---|
| high | `POST /api/accounting/close-year` | `src/app/api/accounting/close-year/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[12]; ensureUserTenant=[14]; dbOps=['update@L23']; serviceImports=['@/server/accounting/auto-post:postYearEndClosing'] |
| high | `GET,PATCH,DELETE /api/accounts/[id]` | `src/app/api/accounts/[id]/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[9, 20, 33]; ensureUserTenant=[11, 22, 35]; requestJson=[24]; serviceImports=['@/server/accounting/service:deleteAccount,getAccount,updateAccount'] |
| medium | `GET,PATCH,DELETE /api/accounts/[id]` | `src/app/api/accounts/[id]/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[24] |
| medium | `GET,POST /api/accounts` | `src/app/api/accounts/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[22] |
| high | `GET,POST /api/api-keys` | `src/app/api/api-keys/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[12, 20]; ensureUserTenant=[14, 22]; requestJson=[24]; dbOps=['insert@L28'] |
| medium | `GET,POST /api/api-keys` | `src/app/api/api-keys/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[24] |
| high | `GET,PATCH,DELETE /api/bank-accounts/[id]` | `src/app/api/bank-accounts/[id]/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[9, 20, 36]; ensureUserTenant=[11, 22, 38]; requestJson=[24]; serviceImports=['@/server/treasury/service:deleteBankAccount,getBankAccount,updateBankAccount'] |
| medium | `GET,PATCH,DELETE /api/bank-accounts/[id]` | `src/app/api/bank-accounts/[id]/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[24] |
| high | `GET,POST /api/bank-accounts` | `src/app/api/bank-accounts/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[9, 19]; ensureUserTenant=[11, 21]; requestJson=[25]; serviceImports=['@/server/treasury/service:createBankAccount,listBankAccounts'] |
| medium | `GET,POST /api/bank-accounts` | `src/app/api/bank-accounts/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[25] |
| high | `GET,PATCH,DELETE /api/bank-transactions/[id]` | `src/app/api/bank-transactions/[id]/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[9, 20, 40]; ensureUserTenant=[11, 22, 42]; requestJson=[24]; serviceImports=['@/server/treasury/service:deleteBankTransaction,getBankTransaction,updateBankTransaction'] |
| medium | `GET,PATCH,DELETE /api/bank-transactions/[id]` | `src/app/api/bank-transactions/[id]/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[24] |
| high | `GET,POST /api/bank-transactions` | `src/app/api/bank-transactions/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[10, 18]; ensureUserTenant=[12, 20]; requestJson=[22]; serviceImports=['@/server/accounting/auto-post:postBankTransaction', '@/server/treasury/service:createBankTransaction,listBankTransactions'] |
| medium | `GET,POST /api/bank-transactions` | `src/app/api/bank-transactions/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[22] |
| medium | `POST /api/billing/checkout` | `src/app/api/billing/checkout/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[9] |
| medium | `POST /api/billing/portal` | `src/app/api/billing/portal/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[9] |
| high | `GET,PUT /api/company-settings` | `src/app/api/company-settings/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[22, 37]; ensureUserTenant=[24, 39]; requestJson=[42]; dbOps=['insert@L65', 'update@L53'] |
| high | `PATCH,DELETE /api/customers/[id]` | `src/app/api/customers/[id]/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[13, 43]; ensureUserTenant=[15, 45]; requestJson=[18]; dbOps=['update@L27', 'delete@L48']; serviceImports=['@/server/audit:recordAudit', '@/server/schemas/forms:updateCustomerSchema'] |
| high | `POST /api/customers` | `src/app/api/customers/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[11]; ensureUserTenant=[17]; requestJson=[29]; dbOps=['insert@L40']; serviceImports=['@/server/schemas/forms:createCustomerSchema'] |
| high | `POST /api/delivery-notes/[id]/to-invoice` | `src/app/api/delivery-notes/[id]/to-invoice/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[9]; ensureUserTenant=[11]; serviceImports=['@/server/sales/service:convertDeliveryToInvoice'] |
| high | `GET,POST /api/delivery-notes` | `src/app/api/delivery-notes/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[22, 30]; ensureUserTenant=[24, 32]; requestJson=[35]; dbOps=['insert@L66', 'insert@L81', 'insert@L91']; serviceImports=['@/server/documents/series:reserveSeriesNumber', '@/server/inventory/stock-location:refreshStockLocation'] |
| high | `GET,POST /api/document-series` | `src/app/api/document-series/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[11, 20]; ensureUserTenant=[13, 22]; requestJson=[24]; dbOps=['insert@L27'] |
| medium | `GET,POST /api/document-series` | `src/app/api/document-series/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[24] |
| high | `GET,PATCH,DELETE /api/fiscal-reports/[id]` | `src/app/api/fiscal-reports/[id]/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[9, 20, 33]; ensureUserTenant=[11, 22, 35]; requestJson=[24]; serviceImports=['@/server/fiscal/service:deleteFiscalReport,getFiscalReport,updateFiscalReport'] |
| medium | `GET,PATCH,DELETE /api/fiscal-reports/[id]` | `src/app/api/fiscal-reports/[id]/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[24] |
| high | `GET,POST /api/fiscal-reports` | `src/app/api/fiscal-reports/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[9, 17]; ensureUserTenant=[11, 19]; requestJson=[21]; serviceImports=['@/server/fiscal/service:createFiscalReport,listFiscalReports'] |
| medium | `GET,POST /api/fiscal-reports` | `src/app/api/fiscal-reports/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[21] |
| high | `GET,POST /api/goods-receipts` | `src/app/api/goods-receipts/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[27, 46]; ensureUserTenant=[29, 48]; requestJson=[51]; dbOps=['insert@L76', 'insert@L102', 'insert@L105']; serviceImports=['@/server/inventory/stock-location:refreshStockLocation,registerInMovementCost'] |
| high | `GET,POST /api/inventory` | `src/app/api/inventory/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[12, 20]; ensureUserTenant=[14, 22]; requestJson=[27]; dbOps=['insert@L33', 'insert@L41', 'insert@L51']; serviceImports=['@/server/inventory/service:getStockSnapshot'] |
| medium | `GET,POST /api/inventory` | `src/app/api/inventory/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[27] |
| high | `POST /api/invitations/[id]/accept` | `src/app/api/invitations/[id]/accept/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[7]; serviceImports=['@/server/team/service:acceptInvitation'] |
| high | `POST /api/invitations` | `src/app/api/invitations/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[9]; ensureUserTenant=[11]; requestJson=[13]; serviceImports=['@/server/team/service:createInvitation'] |
| medium | `POST /api/invitations` | `src/app/api/invitations/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[13] |
| high | `GET,POST /api/invoice-payments` | `src/app/api/invoice-payments/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[19, 27]; ensureUserTenant=[21, 29]; requestJson=[32]; dbOps=['insert@L42', 'insert@L49']; serviceImports=['@/server/accounting/auto-post:postCustomerPayment'] |
| high | `PATCH,DELETE /api/invoices/[id]` | `src/app/api/invoices/[id]/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[13, 36]; ensureUserTenant=[15, 38]; requestJson=[18]; dbOps=['update@L26', 'delete@L41']; serviceImports=['@/server/audit:recordAudit', '@/server/schemas/forms:updateInvoiceSchema'] |
| high | `POST /api/invoices` | `src/app/api/invoices/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[14]; ensureUserTenant=[20]; requestJson=[32]; dbOps=['insert@L65', 'insert@L82', 'transaction@L63']; serviceImports=['@/server/accounting/auto-post:postSalesInvoice', '@/server/schemas/forms:createInvoiceSchema'] |
| high | `GET,POST /api/item-categories` | `src/app/api/item-categories/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[17, 30]; ensureUserTenant=[19, 32]; requestJson=[35]; dbOps=['insert@L39'] |
| high | `GET,POST /api/items` | `src/app/api/items/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[11, 19]; ensureUserTenant=[13, 21]; requestJson=[23]; dbOps=['insert@L25'] |
| medium | `GET,POST /api/items` | `src/app/api/items/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[23] |
| high | `GET,PATCH,DELETE /api/journal-entries/[id]` | `src/app/api/journal-entries/[id]/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[9, 20, 41]; ensureUserTenant=[11, 22, 43]; requestJson=[24]; serviceImports=['@/server/accounting/service:deleteJournalEntry,getJournalEntry,updateJournalEntry'] |
| medium | `GET,PATCH,DELETE /api/journal-entries/[id]` | `src/app/api/journal-entries/[id]/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[24] |
| high | `GET,POST /api/journal-entries` | `src/app/api/journal-entries/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[9, 17]; ensureUserTenant=[11, 19]; requestJson=[21]; serviceImports=['@/server/accounting/service:createJournalEntry,listJournalEntries'] |
| medium | `GET,POST /api/journal-entries` | `src/app/api/journal-entries/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[21] |
| high | `GET,POST /api/payment-methods` | `src/app/api/payment-methods/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[18, 26]; ensureUserTenant=[20, 28]; requestJson=[31]; dbOps=['insert@L34'] |
| high | `GET,PATCH,DELETE /api/purchases/[id]` | `src/app/api/purchases/[id]/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[9, 23, 45]; ensureUserTenant=[11, 25, 47]; requestJson=[30]; serviceImports=['@/server/purchases/service:deletePurchaseOrder,getPurchaseOrder,updatePurchaseOrder'] |
| medium | `GET,PATCH,DELETE /api/purchases/[id]` | `src/app/api/purchases/[id]/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[30] |
| high | `GET,POST /api/purchases` | `src/app/api/purchases/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[25, 33]; ensureUserTenant=[27, 35]; requestJson=[40]; serviceImports=['@/server/purchases/service:createPurchaseOrder,listPurchaseOrders'] |
| high | `POST /api/sales-orders/[id]/to-delivery` | `src/app/api/sales-orders/[id]/to-delivery/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[9]; ensureUserTenant=[11]; serviceImports=['@/server/sales/service:convertOrderToDelivery'] |
| high | `GET,POST /api/sales-orders` | `src/app/api/sales-orders/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[24, 32]; ensureUserTenant=[26, 34]; requestJson=[37]; dbOps=['insert@L56', 'insert@L74', 'update@L89']; serviceImports=['@/server/documents/series:reserveSeriesNumber'] |
| high | `POST /api/sales-quotes/[id]/to-order` | `src/app/api/sales-quotes/[id]/to-order/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[9]; ensureUserTenant=[11]; serviceImports=['@/server/sales/service:convertQuoteToOrder'] |
| high | `GET,POST /api/sales-quotes` | `src/app/api/sales-quotes/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[35, 43]; ensureUserTenant=[37, 45]; requestJson=[48]; dbOps=['insert@L68', 'insert@L80', 'transaction@L59']; serviceImports=['@/server/documents/series:reserveSeriesNumber', '@/server/taxation/engine:computeDocumentTotals'] |
| high | `GET,POST /api/stock-movements` | `src/app/api/stock-movements/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[12, 20]; ensureUserTenant=[14, 22]; requestJson=[24]; dbOps=['insert@L34']; serviceImports=['@/server/inventory/stock-location:refreshStockLocation'] |
| medium | `GET,POST /api/stock-movements` | `src/app/api/stock-movements/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[24] |
| medium | `POST /api/storage/presign` | `src/app/api/storage/presign/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[9] |
| high | `GET,POST /api/supplier-invoices` | `src/app/api/supplier-invoices/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[29, 37]; ensureUserTenant=[31, 39]; requestJson=[42]; dbOps=['insert@L114', 'insert@L121', 'transaction@L104']; serviceImports=['@/server/accounting/auto-post:postSupplierInvoice', '@/server/documents/series:reserveSeriesNumber'] |
| high | `GET,POST /api/supplier-payments` | `src/app/api/supplier-payments/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[19, 27]; ensureUserTenant=[21, 29]; requestJson=[32]; dbOps=['insert@L42', 'insert@L49']; serviceImports=['@/server/accounting/auto-post:postSupplierPayment'] |
| high | `GET,POST /api/tax-retentions` | `src/app/api/tax-retentions/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[17, 25]; ensureUserTenant=[19, 27]; requestJson=[30]; dbOps=['insert@L34'] |
| high | `GET,POST /api/taxes` | `src/app/api/taxes/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[11, 18]; ensureUserTenant=[13, 20]; requestJson=[22]; dbOps=['insert@L24'] |
| medium | `GET,POST /api/taxes` | `src/app/api/taxes/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[22] |
| high | `POST /api/treasury/reconcile` | `src/app/api/treasury/reconcile/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[9]; ensureUserTenant=[11]; serviceImports=['@/server/treasury/reconciliation:autoReconcileBankTransactions']; mutationCalls=['autoReconcileBankTransactions@L14'] |
| high | `GET,POST /api/unit-of-measure` | `src/app/api/unit-of-measure/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[17, 26]; ensureUserTenant=[19, 28]; requestJson=[31]; dbOps=['insert@L35'] |
| high | `GET,POST /api/warehouses` | `src/app/api/warehouses/route.ts` | mutation endpoint without requireContext() in route | getUserSession=[11, 19]; ensureUserTenant=[13, 21]; requestJson=[23]; dbOps=['insert@L25'] |
| medium | `GET,POST /api/warehouses` | `src/app/api/warehouses/route.ts` | request.json() without visible zod parse/safeParse in route | requestJson=[23] |

## Endpoints críticos

| Métodos | Path | Archivo | Razón | Contexto | Validación/body | DB/audit/servicios |
|---|---|---|---|---|---|---|
| `POST` | `/api/accounting/close-year` | `src/app/api/accounting/close-year/route.ts` | direct-db-write, sensitive-domain | session L12; tenant L14 | — | db update@L23; imports @/server/accounting/auto-post:postYearEndClosing |
| `GET` | `/api/accounting` | `src/app/api/accounting/route.ts` | sensitive-domain | session L9; tenant L11 | — | imports @/server/accounting/service:getTrialBalance |
| `GET,POST` | `/api/accounts` | `src/app/api/accounts/route.ts` | requireContext | requireContext L8,18 | request.json L22 | imports @/server/accounting/service:createAccount,listAccounts |
| `GET,POST` | `/api/api-keys` | `src/app/api/api-keys/route.ts` | direct-db-write | session L12,20; tenant L14,22 | request.json L24 | db insert@L28 |
| `GET,PUT` | `/api/company-settings` | `src/app/api/company-settings/route.ts` | direct-db-write, sensitive-domain | session L22,37; tenant L24,39 | request.json L42; schemas payloadSchema@L11; validation safeParse@L42 | db insert@L65, update@L53 |
| `GET,PATCH` | `/api/context/active` | `src/app/api/context/active/route.ts` | requireContext | requireContext L21,40; session L18,33 | request.json L36; schemas payloadSchema@L12; validation safeParse@L37 | — |
| `PATCH,DELETE` | `/api/customers/[id]` | `src/app/api/customers/[id]/route.ts` | direct-db-write | session L13,43; tenant L15,45 | request.json L18; schemas forms:updateCustomerSchema; validation safeParse@L19 | db update@L27, delete@L48; audit L38,50; imports @/server/audit:recordAudit, @/server/schemas/forms:updateCustomerSchema |
| `POST` | `/api/customers` | `src/app/api/customers/route.ts` | direct-db-write | session L11; tenant L17 | request.json L29; schemas forms:createCustomerSchema; validation safeParse@L30 | db insert@L40; imports @/server/schemas/forms:createCustomerSchema |
| `POST` | `/api/delivery-notes/[id]/to-invoice` | `src/app/api/delivery-notes/[id]/to-invoice/route.ts` | sensitive-domain | session L9; tenant L11 | — | imports @/server/sales/service:convertDeliveryToInvoice |
| `GET,POST` | `/api/delivery-notes` | `src/app/api/delivery-notes/route.ts` | direct-db-write | session L22,30; tenant L24,32 | request.json L35; schemas payloadSchema@L13; validation safeParse@L35 | db insert@L66, insert@L81, insert@L91, update@L102, transaction@L57; imports @/server/documents/series:reserveSeriesNumber, @/server/inventory/stock-location:refreshStockLocation |
| `GET,POST` | `/api/document-series` | `src/app/api/document-series/route.ts` | direct-db-write | session L11,20; tenant L13,22 | request.json L24 | db insert@L27 |
| `GET` | `/api/fiscal-reports/[id]/pdf` | `src/app/api/fiscal-reports/[id]/pdf/route.ts` | sensitive-domain | — | — | — |
| `GET,PATCH,DELETE` | `/api/fiscal-reports/[id]` | `src/app/api/fiscal-reports/[id]/route.ts` | sensitive-domain | session L9,20,33; tenant L11,22,35 | request.json L24 | imports @/server/fiscal/service:deleteFiscalReport,getFiscalReport,updateFiscalReport |
| `GET,POST` | `/api/fiscal-reports` | `src/app/api/fiscal-reports/route.ts` | sensitive-domain | session L9,17; tenant L11,19 | request.json L21 | imports @/server/fiscal/service:createFiscalReport,listFiscalReports |
| `GET,POST` | `/api/goods-receipts` | `src/app/api/goods-receipts/route.ts` | direct-db-write | session L27,46; tenant L29,48 | request.json L51; schemas payloadSchema@L12; validation safeParse@L51 | db insert@L76, insert@L102, insert@L105, transaction@L74; imports @/server/inventory/stock-location:refreshStockLocation,registerInMovementCost |
| `GET,POST` | `/api/inventory` | `src/app/api/inventory/route.ts` | direct-db-write | session L12,20; tenant L14,22 | request.json L27 | db insert@L33, insert@L41, insert@L51; imports @/server/inventory/service:getStockSnapshot |
| `GET,POST` | `/api/invoice-payments` | `src/app/api/invoice-payments/route.ts` | direct-db-write, sensitive-domain | session L19,27; tenant L21,29 | request.json L32; schemas payloadSchema@L12; validation safeParse@L32 | db insert@L42, insert@L49; imports @/server/accounting/auto-post:postCustomerPayment |
| `GET` | `/api/invoices/[id]/pdf` | `src/app/api/invoices/[id]/pdf/route.ts` | sensitive-domain | session L11; tenant L13 | — | imports @/server/pdf/render:renderInvoicePdf |
| `PATCH,DELETE` | `/api/invoices/[id]` | `src/app/api/invoices/[id]/route.ts` | direct-db-write, sensitive-domain | session L13,36; tenant L15,38 | request.json L18; schemas forms:updateInvoiceSchema; validation safeParse@L19 | db update@L26, delete@L41; audit L31,43; imports @/server/audit:recordAudit, @/server/schemas/forms:updateInvoiceSchema |
| `POST` | `/api/invoices` | `src/app/api/invoices/route.ts` | direct-db-write, sensitive-domain | session L14; tenant L20 | request.json L32; schemas forms:createInvoiceSchema; validation safeParse@L33 | db insert@L65, insert@L82, transaction@L63; imports @/server/accounting/auto-post:postSalesInvoice, @/server/schemas/forms:createInvoiceSchema |
| `GET,POST` | `/api/item-categories` | `src/app/api/item-categories/route.ts` | direct-db-write | session L17,30; tenant L19,32 | request.json L35; schemas payloadSchema@L11; validation safeParse@L35 | db insert@L39 |
| `GET,POST` | `/api/items` | `src/app/api/items/route.ts` | direct-db-write | session L11,19; tenant L13,21 | request.json L23 | db insert@L25 |
| `POST` | `/api/onboarding/seed` | `src/app/api/onboarding/seed/route.ts` | sensitive-domain | session L15; tenant L18 | request.json L23; schemas payloadSchema@L9; validation safeParse@L24 | imports @/server/seeds/apply:applyEsSeeds |
| `GET,POST` | `/api/payment-methods` | `src/app/api/payment-methods/route.ts` | direct-db-write, sensitive-domain | session L18,26; tenant L20,28 | request.json L31; schemas payloadSchema@L11; validation safeParse@L31 | db insert@L34 |
| `GET` | `/api/purchases/[id]/pdf` | `src/app/api/purchases/[id]/pdf/route.ts` | sensitive-domain | — | — | — |
| `GET,PATCH,DELETE` | `/api/purchases/[id]` | `src/app/api/purchases/[id]/route.ts` | sensitive-domain | session L9,23,45; tenant L11,25,47 | request.json L30 | imports @/server/purchases/service:deletePurchaseOrder,getPurchaseOrder,updatePurchaseOrder |
| `GET,POST` | `/api/purchases` | `src/app/api/purchases/route.ts` | sensitive-domain | session L25,33; tenant L27,35 | request.json L40; schemas payloadSchema@L9; validation safeParse@L40 | imports @/server/purchases/service:createPurchaseOrder,listPurchaseOrders |
| `POST` | `/api/sales-orders/[id]/to-delivery` | `src/app/api/sales-orders/[id]/to-delivery/route.ts` | sensitive-domain | session L9; tenant L11 | — | imports @/server/sales/service:convertOrderToDelivery |
| `GET,POST` | `/api/sales-orders` | `src/app/api/sales-orders/route.ts` | direct-db-write, sensitive-domain | session L24,32; tenant L26,34 | request.json L37; schemas payloadSchema@L12; validation safeParse@L37 | db insert@L56, insert@L74, update@L89, transaction@L47; imports @/server/documents/series:reserveSeriesNumber |
| `POST` | `/api/sales-quotes/[id]/to-order` | `src/app/api/sales-quotes/[id]/to-order/route.ts` | sensitive-domain | session L9; tenant L11 | — | imports @/server/sales/service:convertQuoteToOrder |
| `GET,POST` | `/api/sales-quotes` | `src/app/api/sales-quotes/route.ts` | direct-db-write, sensitive-domain | session L35,43; tenant L37,45 | request.json L48; schemas lineSchema@L13, payloadSchema@L21; validation safeParse@L48 | db insert@L68, insert@L80, transaction@L59; imports @/server/documents/series:reserveSeriesNumber, @/server/taxation/engine:computeDocumentTotals |
| `GET,POST` | `/api/stock-movements` | `src/app/api/stock-movements/route.ts` | direct-db-write | session L12,20; tenant L14,22 | request.json L24 | db insert@L34; imports @/server/inventory/stock-location:refreshStockLocation |
| `GET,POST` | `/api/supplier-invoices` | `src/app/api/supplier-invoices/route.ts` | direct-db-write, sensitive-domain | session L29,37; tenant L31,39 | request.json L42; schemas payloadSchema@L13; validation safeParse@L42 | db insert@L114, insert@L121, transaction@L104; imports @/server/accounting/auto-post:postSupplierInvoice, @/server/documents/series:reserveSeriesNumber |
| `GET,POST` | `/api/supplier-payments` | `src/app/api/supplier-payments/route.ts` | direct-db-write, sensitive-domain | session L19,27; tenant L21,29 | request.json L32; schemas payloadSchema@L12; validation safeParse@L32 | db insert@L42, insert@L49; imports @/server/accounting/auto-post:postSupplierPayment |
| `GET,POST` | `/api/tax-retentions` | `src/app/api/tax-retentions/route.ts` | direct-db-write | session L17,25; tenant L19,27 | request.json L30; schemas payloadSchema@L11; validation safeParse@L30 | db insert@L34 |
| `GET,POST` | `/api/taxes` | `src/app/api/taxes/route.ts` | direct-db-write | session L11,18; tenant L13,20 | request.json L22 | db insert@L24 |
| `POST` | `/api/treasury/import-csv` | `src/app/api/treasury/import-csv/route.ts` | sensitive-domain | session L15; tenant L17 | request.json L20; schemas payloadSchema@L9; validation safeParse@L20 | imports @/server/treasury/reconciliation:importBankCsv |
| `POST` | `/api/treasury/reconcile` | `src/app/api/treasury/reconcile/route.ts` | mutation-service-call, sensitive-domain | session L9; tenant L11 | — | imports @/server/treasury/reconciliation:autoReconcileBankTransactions; calls autoReconcileBankTransactions@L14 |
| `GET,POST` | `/api/unit-of-measure` | `src/app/api/unit-of-measure/route.ts` | direct-db-write | session L17,26; tenant L19,28 | request.json L31; schemas payloadSchema@L11; validation safeParse@L31 | db insert@L35 |
| `GET,POST` | `/api/warehouses` | `src/app/api/warehouses/route.ts` | direct-db-write | session L11,19; tenant L13,21 | request.json L23 | db insert@L25 |

## Inventario completo de route.ts

| # | Métodos | Path | Archivo | LOC | requireContext | request.json | Zod/validación | DB ops | audit |
|---:|---|---|---|---:|---|---|---|---|---|
| 1 | `POST` | `/api/accounting/close-year` | `src/app/api/accounting/close-year/route.ts` | 28 | — | — | — | update@L23 | — |
| 2 | `GET` | `/api/accounting` | `src/app/api/accounting/route.ts` | 16 | — | — | — | — | — |
| 3 | `GET,PATCH,DELETE` | `/api/accounts/[id]` | `src/app/api/accounts/[id]/route.ts` | 41 | — | 24 | — | — | — |
| 4 | `GET,POST` | `/api/accounts` | `src/app/api/accounts/route.ts` | 26 | 8, 18 | 22 | — | — | — |
| 5 | `GET,POST` | `/api/api-keys` | `src/app/api/api-keys/route.ts` | 30 | — | 24 | — | insert@L28 | — |
| 6 | `—` | `/api/auth/[...all]` | `src/app/api/auth/[...all]/route.ts` | 5 | — | — | — | — | — |
| 7 | `GET,PATCH,DELETE` | `/api/bank-accounts/[id]` | `src/app/api/bank-accounts/[id]/route.ts` | 44 | — | 24 | — | — | — |
| 8 | `GET,POST` | `/api/bank-accounts` | `src/app/api/bank-accounts/route.ts` | 34 | — | 25 | — | — | — |
| 9 | `GET,PATCH,DELETE` | `/api/bank-transactions/[id]` | `src/app/api/bank-transactions/[id]/route.ts` | 48 | — | 24 | — | — | — |
| 10 | `GET,POST` | `/api/bank-transactions` | `src/app/api/bank-transactions/route.ts` | 42 | — | 22 | — | — | — |
| 11 | `POST` | `/api/billing/checkout` | `src/app/api/billing/checkout/route.ts` | 18 | — | 9 | — | — | — |
| 12 | `POST` | `/api/billing/portal` | `src/app/api/billing/portal/route.ts` | 13 | — | 9 | — | — | — |
| 13 | `POST` | `/api/billing/webhook` | `src/app/api/billing/webhook/route.ts` | 18 | — | — | — | — | — |
| 14 | `GET,PUT` | `/api/company-settings` | `src/app/api/company-settings/route.ts` | 73 | — | 42 | payloadSchema@L11, safeParse@L42 | insert@L65, update@L53 | — |
| 15 | `GET,PATCH` | `/api/context/active` | `src/app/api/context/active/route.ts` | 60 | 21, 40 | 36 | payloadSchema@L12, safeParse@L37 | — | — |
| 16 | `PATCH,DELETE` | `/api/customers/[id]` | `src/app/api/customers/[id]/route.ts` | 52 | — | 18 | forms:updateCustomerSchema, safeParse@L19 | update@L27, delete@L48 | 38, 50 |
| 17 | `POST` | `/api/customers` | `src/app/api/customers/route.ts` | 56 | — | 29 | forms:createCustomerSchema, safeParse@L30 | insert@L40 | — |
| 18 | `POST` | `/api/delivery-notes/[id]/to-invoice` | `src/app/api/delivery-notes/[id]/to-invoice/route.ts` | 25 | — | — | — | — | — |
| 19 | `GET,POST` | `/api/delivery-notes` | `src/app/api/delivery-notes/route.ts` | 120 | — | 35 | payloadSchema@L13, safeParse@L35 | insert@L66, insert@L81, insert@L91, update@L102, transaction@L57 | — |
| 20 | `GET,POST` | `/api/document-series` | `src/app/api/document-series/route.ts` | 31 | — | 24 | — | insert@L27 | — |
| 21 | `GET` | `/api/fiscal-reports/[id]/pdf` | `src/app/api/fiscal-reports/[id]/pdf/route.ts` | 5 | — | — | — | — | — |
| 22 | `GET,PATCH,DELETE` | `/api/fiscal-reports/[id]` | `src/app/api/fiscal-reports/[id]/route.ts` | 41 | — | 24 | — | — | — |
| 23 | `GET,POST` | `/api/fiscal-reports` | `src/app/api/fiscal-reports/route.ts` | 25 | — | 21 | — | — | — |
| 24 | `GET,POST` | `/api/goods-receipts` | `src/app/api/goods-receipts/route.ts` | 144 | — | 51 | payloadSchema@L12, safeParse@L51 | insert@L76, insert@L102, insert@L105, transaction@L74 | — |
| 25 | `GET` | `/api/inventory/alerts` | `src/app/api/inventory/alerts/route.ts` | 13 | — | — | — | — | — |
| 26 | `GET,POST` | `/api/inventory` | `src/app/api/inventory/route.ts` | 62 | — | 27 | — | insert@L33, insert@L41, insert@L51 | — |
| 27 | `POST` | `/api/invitations/[id]/accept` | `src/app/api/invitations/[id]/accept/route.ts` | 13 | — | — | — | — | — |
| 28 | `POST` | `/api/invitations` | `src/app/api/invitations/route.ts` | 17 | — | 13 | — | — | — |
| 29 | `GET,POST` | `/api/invoice-payments` | `src/app/api/invoice-payments/route.ts` | 67 | — | 32 | payloadSchema@L12, safeParse@L32 | insert@L42, insert@L49 | — |
| 30 | `GET` | `/api/invoices/[id]/pdf` | `src/app/api/invoices/[id]/pdf/route.ts` | 36 | — | — | — | — | — |
| 31 | `PATCH,DELETE` | `/api/invoices/[id]` | `src/app/api/invoices/[id]/route.ts` | 45 | — | 18 | forms:updateInvoiceSchema, safeParse@L19 | update@L26, delete@L41 | 31, 43 |
| 32 | `POST` | `/api/invoices` | `src/app/api/invoices/route.ts` | 116 | — | 32 | forms:createInvoiceSchema, safeParse@L33 | insert@L65, insert@L82, transaction@L63 | — |
| 33 | `GET,POST` | `/api/item-categories` | `src/app/api/item-categories/route.ts` | 48 | — | 35 | payloadSchema@L11, safeParse@L35 | insert@L39 | — |
| 34 | `GET,POST` | `/api/items` | `src/app/api/items/route.ts` | 27 | — | 23 | — | insert@L25 | — |
| 35 | `GET,PATCH,DELETE` | `/api/journal-entries/[id]` | `src/app/api/journal-entries/[id]/route.ts` | 49 | — | 24 | — | — | — |
| 36 | `GET,POST` | `/api/journal-entries` | `src/app/api/journal-entries/route.ts` | 33 | — | 21 | — | — | — |
| 37 | `POST` | `/api/onboarding/seed` | `src/app/api/onboarding/seed/route.ts` | 38 | — | 23 | payloadSchema@L9, safeParse@L24 | — | — |
| 38 | `GET,POST` | `/api/payment-methods` | `src/app/api/payment-methods/route.ts` | 36 | — | 31 | payloadSchema@L11, safeParse@L31 | insert@L34 | — |
| 39 | `GET` | `/api/purchases/[id]/pdf` | `src/app/api/purchases/[id]/pdf/route.ts` | 5 | — | — | — | — | — |
| 40 | `GET,PATCH,DELETE` | `/api/purchases/[id]` | `src/app/api/purchases/[id]/route.ts` | 56 | — | 30 | — | — | — |
| 41 | `GET,POST` | `/api/purchases` | `src/app/api/purchases/route.ts` | 51 | — | 40 | payloadSchema@L9, safeParse@L40 | — | — |
| 42 | `GET` | `/api/reporting/export` | `src/app/api/reporting/export/route.ts` | 18 | — | — | — | — | — |
| 43 | `POST` | `/api/sales-orders/[id]/to-delivery` | `src/app/api/sales-orders/[id]/to-delivery/route.ts` | 25 | — | — | — | — | — |
| 44 | `GET,POST` | `/api/sales-orders` | `src/app/api/sales-orders/route.ts` | 98 | — | 37 | payloadSchema@L12, safeParse@L37 | insert@L56, insert@L74, update@L89, transaction@L47 | — |
| 45 | `POST` | `/api/sales-quotes/[id]/to-order` | `src/app/api/sales-quotes/[id]/to-order/route.ts` | 25 | — | — | — | — | — |
| 46 | `GET,POST` | `/api/sales-quotes` | `src/app/api/sales-quotes/route.ts` | 98 | — | 48 | lineSchema@L13, payloadSchema@L21, safeParse@L48 | insert@L68, insert@L80, transaction@L59 | — |
| 47 | `GET,POST` | `/api/stock-movements` | `src/app/api/stock-movements/route.ts` | 49 | — | 24 | — | insert@L34 | — |
| 48 | `POST` | `/api/storage/presign` | `src/app/api/storage/presign/route.ts` | 16 | — | 9 | — | — | — |
| 49 | `GET,POST` | `/api/supplier-invoices` | `src/app/api/supplier-invoices/route.ts` | 148 | — | 42 | payloadSchema@L13, safeParse@L42 | insert@L114, insert@L121, transaction@L104 | — |
| 50 | `GET,POST` | `/api/supplier-payments` | `src/app/api/supplier-payments/route.ts` | 67 | — | 32 | payloadSchema@L12, safeParse@L32 | insert@L42, insert@L49 | — |
| 51 | `GET,POST` | `/api/tax-retentions` | `src/app/api/tax-retentions/route.ts` | 38 | — | 30 | payloadSchema@L11, safeParse@L30 | insert@L34 | — |
| 52 | `GET,POST` | `/api/taxes` | `src/app/api/taxes/route.ts` | 26 | — | 22 | — | insert@L24 | — |
| 53 | `POST` | `/api/treasury/import-csv` | `src/app/api/treasury/import-csv/route.ts` | 25 | — | 20 | payloadSchema@L9, safeParse@L20 | — | — |
| 54 | `POST` | `/api/treasury/reconcile` | `src/app/api/treasury/reconcile/route.ts` | 16 | — | — | — | — | — |
| 55 | `GET,POST` | `/api/unit-of-measure` | `src/app/api/unit-of-measure/route.ts` | 44 | — | 31 | payloadSchema@L11, safeParse@L31 | insert@L35 | — |
| 56 | `GET,POST` | `/api/warehouses` | `src/app/api/warehouses/route.ts` | 27 | — | 23 | — | insert@L25 | — |

## Servicios backend relevantes

| Archivo | Funciones exportadas | Escrituras/auditoría |
|---|---|---|
| `src/server/accounting/auto-post.ts` | postSalesInvoice@L108, postSupplierInvoice@L123, postCustomerPayment@L140, postSupplierPayment@L154, postBankTransaction@L168, postYearEndClosing@L188 | insert@L79, insert@L88, recordAudit@L97 |
| `src/server/accounting/service.ts` | getTrialBalance@L7, listAccounts@L20, getAccount@L24, createAccount@L29, updateAccount@L35, deleteAccount@L42, ensureDefaultJournal@L49, listJournalEntries@L56, getJournalEntry@L7… | insert@L30, insert@L52, insert@L100, insert@L101, insert@L119, update@L36, update@L116, delete@L43, delete@L118, delete@L126, transaction@L98, transaction@L115… |
| `src/server/audit.ts` | recordAudit@L14 | insert@L15, recordAudit@L14 |
| `src/server/billing/stripe.ts` | stripe@L5, createCheckoutSession@L7, createPortalSession@L18 | — |
| `src/server/documents/series.ts` | reserveSeriesNumber@L17 | update@L39 |
| `src/server/email/send.ts` | sendEmail@L6 | — |
| `src/server/fiscal/registry.ts` | getFiscalProvider@L12 | — |
| `src/server/fiscal/service.ts` | listFiscalReports@L7, getFiscalReport@L11, createFiscalReport@L16, updateFiscalReport@L22, deleteFiscalReport@L29 | insert@L17, update@L23, delete@L32, recordAudit@L18, recordAudit@L25, recordAudit@L33 |
| `src/server/inventory/service.ts` | getStockSnapshot@L6, getLowStockAlerts@L27 | — |
| `src/server/inventory/stock-location.ts` | refreshStockLocation@L17, registerInMovementCost@L62 | insert@L43, insert@L107, update@L103 |
| `src/server/pdf/render.ts` | renderInvoicePdf@L6 | — |
| `src/server/purchases/service.ts` | listPurchaseOrders@L8, getPurchaseOrder@L23, createPurchaseOrder@L46, updatePurchaseOrder@L110, deletePurchaseOrder@L138 | insert@L63, insert@L69, insert@L84, update@L118, delete@L140, transaction@L52, recordAudit@L96, recordAudit@L125, recordAudit@L146 |
| `src/server/reporting/service.ts` | listKpis@L7, exportKpisExcel@L11 | — |
| `src/server/sales/service.ts` | convertQuoteToOrder@L39, convertOrderToDelivery@L78, convertDeliveryToInvoice@L113, assertCustomerOwnership@L164 | insert@L54, insert@L93, insert@L136, update@L32, update@L70, update@L105, update@L149, update@L155, transaction@L44, transaction@L83, transaction@L118 |
| `src/server/schemas/forms.ts` | authSignInSchema@L3, authSignUpSchema@L8, customerStatusSchema@L12, createCustomerSchema@L14, updateCustomerSchema@L25, invoiceStatusSchema@L29, createInvoiceSchema@L37, updateInv… | — |
| `src/server/seeds/apply.ts` | applyEsSeeds@L42 | insert@L75, insert@L92, insert@L108, insert@L131, update@L58, transaction@L55, recordAudit@L142 |
| `src/server/storage/s3.ts` | createUploadUrl@L18 | — |
| `src/server/taxation/engine.ts` | computeLineAmounts@L20, computeDocumentTotals@L34 | — |
| `src/server/team/service.ts` | listTeamMembers@L7, createInvitation@L21, acceptInvitation@L36 | insert@L23, insert@L42, update@L47, recordAudit@L32 |
| `src/server/treasury/reconciliation.ts` | parseBankCsv@L12, importBankCsv@L32, autoReconcileBankTransactions@L49 | insert@L44, update@L80, update@L107, update@L127, update@L154 |
| `src/server/treasury/service.ts` | listTreasury@L7, listBankAccounts@L22, getBankAccount@L26, createBankAccount@L35, updateBankAccount@L41, deleteBankAccount@L52, listBankTransactions@L59, getBankTransaction@L84, c… | insert@L36, insert@L97, update@L43, update@L111, delete@L53, delete@L120, recordAudit@L37, recordAudit@L48, recordAudit@L55, recordAudit@L98, recordAudit@L113,… |

## Riesgos y recomendaciones

1. Uniformar mutaciones críticas para que entren por `requireContext()` o un helper equivalente que devuelva `tenantId`, `companyId` y `actorUserId` de forma obligatoria.
2. Añadir tests de contrato/API para endpoints con `request.json()` y validación Zod, cubriendo payload inválido y ausencia de contexto.
3. Revisar endpoints marcados como `request.json() without visible zod parse/safeParse`; si delegan validación a servicios, documentarlo o mover schemas compartidos a `src/server/schemas`.
4. Reforzar ownership tenant/company en servicios donde `update/delete` filtra por id sin `companyId` en el `where`; aunque el route valide antes, el servicio debería ser defensa en profundidad.
5. Mantener `recordAudit()` fuera de la transacción solo si se acepta perder auditoría ante fallo posterior; en escrituras compuestas conviene registrar auditoría dentro de la misma transacción o con outbox.

## Artefactos generados

- `docs/audits/backend-domain-integrity-audit.md`: este informe.
- `docs/audits/backend-endpoints-inventory.json`: inventario estructurado de los 56 route.ts usado para generar tablas.

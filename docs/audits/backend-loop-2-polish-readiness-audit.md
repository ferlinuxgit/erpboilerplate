# Backend loop 2 polish readiness audit

Fecha: 2026-05-09
Repo: `/root/projects/erpboilerplate`
Alcance: inspección estática de endpoints `src/app/api/**/route.ts` y servicios backend críticos de ventas, compras, inventario, contabilidad, billing y auditoría. No se modificó código de aplicación.

## Resumen ejecutivo

El backend tiene una base razonable de autenticación/tenant context en la mayoría de rutas, pero todavía hay huecos importantes antes de cerrar el loop 2:

1. Hay fallos de aislamiento multi-tenant en rutas de creación de documentos de venta cuando aceptan IDs opcionales de documentos origen (`salesQuoteId`, `salesOrderId`).
2. La conversión `deliveryNote -> invoice` genera una factura de cabecera sin líneas ni asiento contable automático.
3. Varias operaciones de inventario mezclan escrituras transaccionales con helpers que escriben fuera de la transacción, dejando riesgo de movimientos/costes/stock agregado divergentes.
4. La auditoría no es uniforme y algunos helpers de auditoría se ejecutan fuera de la transacción que están auditando.
5. Billing portal confía en `stripeCustomerId` enviado por el cliente autenticado, sin resolverlo desde la suscripción del tenant.

Prioridad recomendada: corregir primero los puntos P0/P1 de aislamiento, facturación y atomicidad de inventario; después cerrar auditoría y cobertura de tests.

## Hallazgos

### P0 — Falta validación de ownership en documentos origen de ventas

Archivos:
- `src/app/api/sales-orders/route.ts:47-92`
- `src/app/api/delivery-notes/route.ts:57-105`

Evidencia:
- `sales-orders/route.ts` valida que `customerId` pertenezca a `ctx.company.id` (`lines 40-45`), pero si llega `salesQuoteId` lo usa directamente para:
  - copiar líneas: `where(eq(salesQuoteLine.salesQuoteId, parsed.data.salesQuoteId))` (`lines 68-72`)
  - actualizar estado del presupuesto: `where(eq(salesQuote.id, parsed.data.salesQuoteId))` (`lines 88-91`)
- `delivery-notes/route.ts` valida customer/warehouse, pero si llega `salesOrderId` lo usa directamente para:
  - copiar líneas: `where(eq(salesOrderLine.salesOrderId, parsed.data.salesOrderId))` (`lines 75-79`)
  - actualizar estado del pedido: `where(eq(salesOrder.id, parsed.data.salesOrderId))` (`lines 101-104`)

Impacto:
- Un usuario de una empresa puede proporcionar un ID de presupuesto/pedido de otra empresa, copiar sus líneas y cambiar su estado.
- También permite crear relaciones cruzadas inconsistentes: cabecera en una compañía enlazada a documento origen de otra.

Corrección recomendada:
- Antes de usar `salesQuoteId`, cargar `salesQuote` con `and(eq(salesQuote.id, id), eq(salesQuote.companyId, ctx.company.id))`; validar también que `customerId` coincide si aplica.
- Antes de usar `salesOrderId`, cargar `salesOrder` con `companyId = ctx.company.id` y validar `customerId`.
- En todos los `update` de documentos origen, añadir `companyId` al `where` aunque ya se haya validado previamente.
- Añadir tests negativos cross-tenant para `POST /api/sales-orders` y `POST /api/delivery-notes`.

### P1 — `deliveryNote -> invoice` crea facturas incompletas y sin asiento contable

Archivo:
- `src/server/sales/service.ts:134-183`

Evidencia:
- `convertDeliveryToInvoice` valida `deliveryNote.companyId` y reserva número (`lines 139-156`).
- Inserta solo cabecera en `invoice` (`lines 157-168`).
- No inserta `invoiceLine`.
- Calcula `totalAmount` desde `order?.totalAmount ?? "0"` (`line 165`), no desde líneas/tax engine.
- No llama a `postSalesInvoice`, a diferencia de `src/app/api/invoices/route.ts:86-97`, donde la creación manual de facturas sí inserta líneas y asiento contable dentro de la misma transacción.

Impacto:
- Facturas generadas desde albaranes pueden aparecer en listados como emitidas, pero sin líneas de detalle.
- Contabilidad/fiscalidad no se actualiza para esas facturas.
- Si el albarán no tiene pedido asociado, se emite una factura con total `0`.

Corrección recomendada:
- Copiar líneas desde `deliveryNoteLine` o desde `salesOrderLine` preservando descripción, cantidad, precio, impuestos, descuentos y retenciones.
- Recalcular totales con `computeDocumentTotals` o reutilizar los totales validados del pedido si se garantiza consistencia.
- Insertar `invoiceLine` dentro de la misma `tx`.
- Llamar `postSalesInvoice({ ..., dbClient: tx })` dentro de la misma transacción.
- Añadir test que verifique: cabecera, líneas, total, estado de albarán/pedido y asiento contable.

### P1 — Atomicidad rota en recepciones y movimientos de inventario

Archivos:
- `src/app/api/goods-receipts/route.ts:74-141`
- `src/app/api/delivery-notes/route.ts:57-117`
- `src/server/inventory/stock-movement-service.ts:8-16`
- `src/server/inventory/stock-location.ts:17-81`

Evidencia:
- `goods-receipts/route.ts` abre `db.transaction` e inserta cabecera/líneas/movimientos (`lines 74-112`). Dentro de esa transacción llama a `registerInMovementCost` (`lines 121-127`), pero `registerInMovementCost` usa `db.insert(...)` directamente (`stock-location.ts:62-81`), no `tx`.
- Después de commitear la recepción, refresca `stock_location` en un bucle fuera de la transacción (`goods-receipts/route.ts:134-141`).
- `delivery-notes/route.ts` inserta movimientos dentro de `tx` (`lines 89-99`), pero refresca `stock_location` fuera de la transacción (`lines 110-117`).
- `registerStockMovementOperation` inserta `stockMovement` y luego llama a `refreshStockLocation` como segunda operación separada (`stock-movement-service.ts:8-16`).

Impacto:
- Si falla el refresh de stock después del commit, quedan movimientos persistidos y stock agregado obsoleto.
- Si falla la escritura de coste en una recepción, puede fallar/colgar por usar otro cliente de DB dentro de una transacción abierta o persistir fuera del rollback esperado.
- Los tests unitarios actuales cubren el happy path del helper, pero no prueban rollback/atomicidad real entre movimiento, coste y stock agregado.

Corrección recomendada:
- Hacer `refreshStockLocation` y `registerInMovementCost` tx-aware: aceptar `dbClient`/`tx` opcional y usarlo para todas las escrituras relacionadas.
- Crear un servicio único para movimientos de inventario que haga movimiento + coste + stock_location en la misma transacción.
- Para recepciones/albaranes, mover el refresh de stock dentro de la transacción o recalcular mediante evento idempotente con retry explícito y estado observable.
- Añadir tests que simulen fallo en coste/refresh y verifiquen rollback o compensación idempotente.

### P1 — Billing portal permite `stripeCustomerId` controlado por cliente

Archivo:
- `src/app/api/billing/portal/route.ts:13-36`

Evidencia:
- La ruta autentica usuario y tenant (`lines 14-18`).
- Lee `stripeCustomerId` desde `await request.json()` (`line 20`).
- Llama `createPortalSession({ stripeCustomerId, returnUrl })` (`lines 30-33`).
- No consulta la tabla `subscription` del tenant actual (`src/db/schema.ts:586-599`) para comprobar que ese customer pertenece al tenant.

Impacto:
- Un usuario autenticado puede intentar abrir un portal de Stripe para cualquier customer ID que conozca o adivine.
- Riesgo de exposición/gestión de datos de facturación ajenos si Stripe no bloquea el flujo por otro medio.

Corrección recomendada:
- El body no debe aceptar `stripeCustomerId`.
- Resolver `stripeCustomerId` desde `subscription` filtrando por `tenantId = ctx.tenant.id`.
- Devolver 404/400 si el tenant no tiene customer asociado.
- Test negativo: request con customer ID de otro tenant no debe llamar a Stripe.

### P2 — Auditoría no transaccional en creación de pedidos de compra

Archivo:
- `src/server/purchases/service.ts:123-205`

Evidencia:
- `createPurchaseOrder` usa `db.transaction` (`line 123`).
- Dentro de esa transacción inserta cabecera/líneas (`lines 142-180`).
- Dentro del mismo callback llama a `recordAudit(...)` (`lines 196-204`).
- `recordAudit` usa siempre `db.insert(auditLog)` (`src/server/audit.ts:14-27`) y no acepta `tx`.

Impacto:
- El log de auditoría puede escribirse fuera de la transacción de negocio.
- Si la auditoría falla, puede abortar el callback después de escrituras de negocio ya ejecutadas en `tx` o provocar comportamiento inesperado por uso de otro cliente dentro de una transacción.
- Se pierde la garantía de “pedido + líneas + auditoría” como una unidad atómica.

Corrección recomendada:
- Cambiar `recordAudit` para aceptar `dbClient` opcional.
- Pasar `tx` desde `createPurchaseOrder` y desde cualquier otro flujo que audite dentro de una transacción.
- Añadir test que fuerce fallo de auditoría y compruebe rollback esperado.

### P2 — Cobertura de auditoría inconsistente en mutaciones críticas

Archivos representativos:
- `src/app/api/sales-quotes/route.ts`
- `src/app/api/sales-orders/route.ts`
- `src/app/api/delivery-notes/route.ts`
- `src/app/api/goods-receipts/route.ts`
- `src/app/api/supplier-invoices/route.ts`
- `src/server/sales/service.ts`
- `src/server/inventory/stock-movement-service.ts`

Evidencia:
- `recordAudit` aparece en algunos dominios (`customers/[id]`, `invoices/[id]`, `accounting`, `billing`, `purchases`, `security-policy`, `team`, `treasury`), pero no en creación/conversión de presupuestos, pedidos, albaranes, recepciones, movimientos de stock ni facturas de proveedor creadas desde la API.
- Ejemplo: `supplier-invoices/route.ts` crea factura y asiento contable (`lines 104-145`) pero no registra evento de auditoría de negocio.

Impacto:
- Actividades que cambian inventario, ventas, compras y contabilidad quedan sin trazabilidad uniforme.
- Dificulta investigación de incidencias y cumplimiento básico.

Corrección recomendada:
- Definir una matriz mínima de auditoría por dominio: create/update/delete/transition/post/reconcile.
- Centralizar mutaciones en servicios de dominio y auditar desde ahí, no desde rutas dispersas.
- Añadir tests de contrato que verifiquen que las mutaciones críticas insertan `auditLog` con `tenantId`, `companyId`, `actorUserId`, entidad y payload mínimo.

## Observaciones de arquitectura

- Las rutas hacen bastante lógica de dominio directamente (`sales-orders`, `delivery-notes`, `goods-receipts`, `supplier-invoices`). Esto aumenta el riesgo de validaciones divergentes. Conviene mover esas operaciones a servicios de dominio testeables y dejar las rutas como capa HTTP/auth/parsing.
- Ya existe un patrón correcto en `src/app/api/invoices/route.ts`: transacción única, líneas, post contable con `dbClient: tx`, logging de error y respuesta controlada. Ese patrón debería replicarse en conversiones de ventas y compras.
- `src/server/sales/service.ts` contiene validaciones de ownership más seguras para conversiones (`convertDeliveryToInvoice` filtra por `companyId`), pero varias rutas de creación implementan conversiones/copias similares sin reutilizar ese servicio.

## Tests recomendados para cerrar loop 2

1. `sales-orders route`:
   - rechaza `salesQuoteId` de otra compañía.
   - rechaza `salesQuoteId` cuyo customer no coincide.
   - actualiza presupuesto con `where(id, companyId)`.
2. `delivery-notes route`:
   - rechaza `salesOrderId` de otra compañía.
   - rechaza pedido con customer distinto.
   - no copia líneas ni cambia estado de documentos ajenos.
3. `convertDeliveryToInvoice`:
   - crea cabecera + líneas + asiento contable.
   - total de factura coincide con líneas.
   - rollback si falla `postSalesInvoice`.
4. `goods-receipts` / inventario:
   - rollback si falla coste o refresh de stock.
   - `stockMovement`, `stockMovementCost` y `stockLocation` quedan consistentes.
5. `billing portal`:
   - ignora/rechaza customer ID enviado por cliente.
   - usa solo customer asociado a `ctx.tenant.id`.
6. Auditoría:
   - mutaciones críticas insertan `auditLog` en la misma transacción o con patrón outbox idempotente.

## Comandos ejecutados durante la auditoría

- `git status --short && git branch --show-current`
- Lecturas con herramientas de repo de:
  - `docs/plans/2026-05-09-loop-2-polish-plan.md`
  - `docs/audits/backend-domain-integrity-audit.md`
  - `src/app/api/**/route.ts` seleccionados
  - `src/server/sales/service.ts`
  - `src/server/purchases/service.ts`
  - `src/server/inventory/stock-location.ts`
  - `src/server/inventory/stock-movement-service.ts`
  - `src/server/accounting/auto-post.ts`
  - `src/server/audit.ts`
  - `src/server/billing/actions.ts`
  - `src/db/schema.ts`

No se ejecutó suite completa de tests porque el encargo fue de inspección/auditoría estática y no se cambiaron fuentes de aplicación.

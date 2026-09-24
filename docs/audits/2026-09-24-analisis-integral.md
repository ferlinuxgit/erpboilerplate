# Análisis integral — ERP Suite (2026-09-24)

Alcance: arquitectura, dominio contable/fiscal (España), seguridad, multi-tenancy, rendimiento, calidad/CI/DevOps y UX/UI.
Base: `main` @ `28810ca` (~48k líneas TS/TSX, 91 route handlers, 29 migraciones, 60 ficheros de test).
Cada hallazgo se verificó leyendo el código; las referencias `fichero:línea` corresponden a esa base.

## 1. Resumen ejecutivo

| Área | Nota | Comentario |
|---|---|---|
| Arquitectura y convenciones | 7/10 | Buena estructura `app / server / lib`, reglas explícitas en `.cursor/rules`, pero lógica de negocio dentro de route handlers y ficheros "dios". |
| Aislamiento multi-tenant | 8,5/10 | No se encontraron fugas de lectura/escritura entre tenants. |
| Integridad contable/fiscal | **4/10** | Hay 4 fallos críticos que producen contabilidad o modelos fiscales incorrectos. |
| Seguridad | 7/10 | Base sólida (argon2, sesiones revocables, CSP, CSRF), pero la allowlist de IP se puede saltar y el rate limit falla en abierto. |
| Calidad / tests | 6,5/10 | Typecheck, lint y 313 tests unitarios en verde; **CI rojo** desde hace varios commits; cobertura baja en servicios críticos. |
| UX/UI | 7,5/10 → **8,5/10 tras este PR** | Identidad visual retro coherente y muy trabajada; fallaban contraste, consistencia de tokens, feedback y detalles de navegación. |

**Recomendación de prioridad:** antes de más pulido visual, corregir los 4 fallos críticos de contabilidad y fiscalidad (§3) y dejar el CI en verde (§6). Mientras sigan ahí, el producto no es apto para producción con clientes reales.

## 2. Fortalezas

- **Tenancy consistente.** Las mutaciones toman `companyId` del contexto de servidor y revalidan la propiedad de entidades relacionadas: clientes, impuestos, métodos de pago, almacenes y cuentas.
- **Numeración con bloqueo.** Documentos con `SELECT … FOR UPDATE` (`server/documents/series.ts:22-32`), asientos con upsert-increment (`server/accounting/numbers.ts`) y bloqueo de fila en edición, anulación y cobro de facturas.
- **Cobros en céntimos enteros** con guardia de sobrepago (`api/invoice-payments/route.ts:85-89`). Los asientos automáticos se corrigen por reversión, nunca por borrado. Hay bloqueos de periodo fiscal (`server/fiscal/locks.ts`).
- **Autenticación sólida.** argon2, tokens de sesión hasheados y revocables, JWT secret con longitud mínima en producción y API keys con scopes. Las subidas se validan con allowlist de content-type y magic bytes. Hay CSP, HSTS y X-Frame-Options.
- **Tooling de calidad por encima de la media:**
  - E2E sobre PGlite con política de skips.
  - Verificación de migraciones en base limpia.
  - Preflight de variables de entorno.
  - Health y readiness separados.
  - Arranque Docker con espera de BD y señales.
- **UX:**
  - Sistema visual propio (8 temas retro) aplicado con disciplina: todas las páginas usan `PageShell`/`PageHeader` y todas las listas `ResourceList`.
  - Navegación por teclado completa: F1, F6, `G`+código, paleta Ctrl+K.
  - Estados loading/error/not-found por segmento.
  - Diálogos destructivos accesibles.

## 3. Fallos críticos (corregir primero)

1. **Doble contabilización de movimientos bancarios.** Tanto un movimiento bancario, manual o importado por CSV (`auto-post.ts:349-367`), como el cobro o pago del documento (`auto-post.ts:321-347`) generan 572/430 o 400/572. La conciliación (`api/treasury/reconcile/route.ts`) no revierte ninguno de los dos, así que 572, 430 y 400 quedan duplicados.
   → Al conciliar un movimiento con un cobro, revertir el asiento del movimiento. Alternativa: contabilizar el movimiento solo si no está vinculado a un cobro o pago.
2. **Asientos automáticos descuadrados.** `createEntry` (`auto-post.ts:82-136`) no valida que Σdebe = Σhaber. `postSupplierInvoice` redondea cada cuenta por separado. Ejemplo reproducido: líneas de 5,15 y 7,35 al 21 % con 33 % deducible dan debe 15,11 y haber 15,12.
   → Validar el cuadre en `createEntry` y cargar la diferencia de redondeo en la última línea.
3. **No se puede crear el ejercicio siguiente.** El único `insert(fiscalYear)` está en el alta del tenant (`lib/tenant.ts:233`). A partir del 1 de enero `assertFiscalPeriodOpen` rechaza cualquier fecha, así que no se pueden registrar facturas, cobros ni movimientos. El cierre no genera asiento de apertura.
   → Añadir la acción "Abrir ejercicio N+1" con asiento de apertura.
4. **Las facturas de proveedor anuladas siguen computando** en el IVA soportado de los modelos 303/390 y en el 347 (`server/fiscal/spain.ts:233, 332`, sin filtro `status <> 'VOID'`).

## 4. Riesgos altos

- **Facturas emitidas mutables.** `PATCH` reescribe líneas, cliente y totales de una factura SENT (`api/invoices/[id]/route.ts:129-200`). "Anular" solo cambia el estado. No existen facturas rectificativas: los totales negativos se rechazan (`lib/invoice-totals.ts:157`). El PDF se genera con los datos actuales del cliente, sin snapshot.
  → Hacer inmutables las facturas emitidas, añadir la serie rectificativa y guardar un snapshot de emisor y receptor. Es requisito previo para **VeriFactu** (obligatorio en 2026–2027), que hoy es solo un flag (`db/schema.ts:278`).
- **Retenciones.**
  - Las de ventas se cargan a 4751 (`auto-post.ts:67,200`); deberían ir a **473**.
  - El modelo 111 se calcula con retenciones de facturas *emitidas* (`spain.ts:125,526`). Debe usar las practicadas en facturas *recibidas* de profesionales.
- **La allowlist de IP se puede saltar.** Se toma el primer valor de `X-Forwarded-For` (`lib/current-user.ts:34`), que controla el cliente.
  → Usar un proxy de confianza: el valor N desde la derecha, o `x-real-ip` fijado por el proxy.
- **Rate limit opcional y evitable.** Solo actúa si hay Upstash, y si no falla en abierto (`proxy.ts:15-17`). La clave incluye User-Agent, cookie y XFF, así que es trivial de rotar. Además, el login permite enumerar usuarios por tiempo de respuesta: sin argon2 si el email no existe (`api/auth/login/route.ts:34-37`).
- **Invitaciones a un segundo tenant inservibles.** El contexto resuelve siempre la *primera* membership (`lib/tenant.ts:118-134`) y no hay selector de tenant.
- **Edición de asientos fuera de periodo.** `updateJournalEntry` solo valida la fecha *nueva* (`server/accounting/service.ts:185-192`), así que un asiento de un periodo cerrado puede moverse. También permite editar asientos ya revertidos.
- **Borrar una cuenta bancaria** elimina en cascada movimientos ya contabilizados (`db/schema.ts:784`).

## 5. Riesgos medios y bajos

- **Auditoría incompleta.** No se auditan: alta de factura, alta de clientes y proveedores, impuestos, series, configuración de empresa (régimen, prorrata, cuentas por defecto), presupuestos y pedidos, ni movimientos de stock. La auditoría de edición de factura se escribe *después* del commit. `audit_log` no tiene índices.
- **Numeración.**
  - `PATCH` de series permite fijar cualquier `nextNumber` (huecos) sin auditoría.
  - Se usa la serie del ejercicio seleccionado en la cookie, no el de la fecha de emisión.
  - Con API key se usa siempre el primer ejercicio.
  - Los pedidos aceptan un `number` enviado por el cliente.
- **Recargo de equivalencia.** Se contabiliza en 477 junto con el IVA, pero no entra en los buckets del 303, lo que genera un descuadre fiscal/contable. La prorrata se aplica en el 303 pero no en contabilidad.
- **Modelo 303 mínimo.** Faltan: tipo del 5 %, adquisiciones intracomunitarias, inversión del sujeto pasivo, exentas y exportaciones, y casilla 28. Tampoco hay SII, 349 ni 130.
- **`POST /api/inventory` heredado.** Crea un artículo en cada llamada, sin control de stock negativo ni auditoría.
- **`itemId` de otra empresa aceptado** en líneas de factura, presupuesto, pedido y compra: la FK es global y no se valida la propiedad.
- **Webhook de Stripe.** Sin deduplicación de eventos. La cancelación no resetea `tenant.plan`. Cualquier error se reporta como firma inválida.
- **API keys heredadas.** Las que no tienen `keyPrefix` hacen argon2 sobre todas las filas en cada request.
- **RBAC implementado de tres formas distintas.** `role_permission` es global, no por tenant. `inventory/alerts` no comprueba permisos.
- **Adjuntos.** `fileUrl` aceptaba `javascript:`/`data:` (mitigado en render en este PR; falta validar en la API). Varios endpoints devuelven `error.message` crudo.
- **Rendimiento.**
  - Ninguna lista está paginada en servidor (no hay `.offset()` en todo el código).
  - `resolveAccounts` lanza unas 10 consultas secuenciales por cada asiento automático; la importación CSV repite eso por fila.
  - Cada request ejecuta de 6 a 9 consultas de contexto sin `cache()`.
  - Faltan índices `(companyId, issueDate)` en `invoice` y `supplier_invoice`.
  - El dashboard carga todas las facturas y pagos de la empresa en memoria.

## 6. Calidad, CI y DevOps

- **CI rojo en `main`.** `npm run audit:release` es el segundo paso y falla (22 vulnerabilidades, 1 crítica), así que typecheck, tests, build y e2e **no se ejecutan en CI**. Las vulnerabilidades que afectan directamente al producto:
  - `next` 16.2.6: bypass de middleware/proxy en App Router, y `src/proxy.ts` hace de guardia de auth.
  - `pdfjs-dist`: ejecución de JS al abrir un PDF, y el OCR procesa PDFs subidos por usuarios.
  - `nodemailer`.
  - El override exacto `"postcss": "8.5.10"` en `package.json` *fuerza* una versión vulnerable.
- **Dos gestores de paquetes.** Conviven `package-lock.json`, `pnpm-lock.yaml` y `pnpm-workspace.yaml`; este último tiene placeholders sin resolver.
- **Sentry a medias.** Falta `onRequestError` en `instrumentation.ts`, no existe `instrumentation-client.ts` (los `captureException` de cliente no hacen nada) y no se usa `withSentryConfig`.
- **Cobertura de tests.** Sin tests: `supplier-invoices/service.ts` (1139 líneas), `documents/series.ts`, `invoices/payment-methods.ts`, las rutas de auth (login y 2FA) y las de facturas. `vitest.config.ts` solo incluye `*.test.ts`.
- **Docker.** Se ejecuta como root, sin `HEALTHCHECK` y sin salida `standalone`. `.dockerignore` no excluye `backups/`, `tests/` ni `docs/`. La versión de Node varía: 20 en CI, 22 en Docker, 24 en local, y no hay `engines`.
- **Mantenibilidad.** Varias páginas son una sola línea de miles de caracteres (`app/inventory/items/[id]/page.tsx`, `warehouses/[id]/page.tsx`, `items/page.tsx`): imposibles de revisar en un diff. La regla `.cursor/rules/04` dice "no añadir zod", pero zod se usa en todo el proyecto.

## 7. UX/UI

### 7.1 Corregido en este PR

| Problema | Cambio |
|---|---|
| Botón destructivo con texto blanco sobre rojo claro en temas oscuros (2,2–2,8:1) | Nuevo token `--destructive-foreground` por tema (≥ 6,9:1) |
| Botón primario del tema oscuro por defecto a 3,6:1 | `--primary` pasa a `#3f5ee0` (5,4:1) |
| Badges success/warning del tema clásico por debajo de AA (4,1 / 3,35:1) | Tokens oscurecidos (≥ 4,8:1). También en papel y OS/2 |
| Foco amarillo invisible en clásico (1,26:1) y OS/2 (1,02:1) | Foco oscuro en temas claros (12,5:1); texto de ayuda actualizado |
| Código del enlace activo invisible en "Monocromo negro" (`text-white` sobre primario blanco) | Pasa a `text-primary-foreground` |
| Cerrar sesión solo accesible desde el panel; pie del sidebar con `OWNER / ● ONLINE` fijo | `SessionPanel` con nombre real, rol traducido, ayuda y cierre de sesión (escritorio y móvil) |
| Textos de 8–9 px en el sidebar y enlaces de 22 px de alto | Mínimo ~10 px y enlaces de 24 px (WCAG 2.5.8) |
| "Auditoría" sin enlace en el sidebar; Recepciones e Inventario con el mismo icono | Enlace 46 · Auditoría; icono propio para Recepciones |
| Pestaña de sección sin marcar al crear un presupuesto (`/sales/new`) | La navegación contextual reutiliza `isActiveRoute` |
| El guardián de cambios sin guardar marcaba el formulario como limpio al enviar, y un guardado fallido permitía salir perdiendo datos | Tras enviar, si aparece un `role="alert"` o un toast de error, el formulario vuelve a marcarse como sucio |
| Ctrl+Enter enviaba formularios con el botón deshabilitado (doble envío) | Respeta `disabled` y `aria-busy` |
| Selector de contexto: "Aplicar" sin estado de carga ni confirmación, clicable repetidamente | Estado de carga, deshabilitado sin cambios pendientes, toast de confirmación y petición compartida con el sidebar |
| Toasts siempre claros en temas oscuros | `ThemedToaster` sigue la clase `.dark`, con botón de cierre |
| iOS hace zoom al enfocar campos (texto < 16 px); la rueda del ratón cambiaba importes | `max-sm:text-base` y alto táctil en móvil; `inputMode="decimal"` y blur con la rueda en campos numéricos |
| Lista con filtros activos y sin resultados mostraba "Todavía no hay…" | Mensaje "Sin resultados" correcto y botón "Limpiar búsqueda y filtros" |
| CSV separado por `,` sin BOM: Excel en español lo abría en una sola columna con acentos rotos; importes exportados como texto | `;` + BOM UTF-8 + números con coma decimal + protección contra inyección de fórmulas (test añadido) |
| Roles y tipos de movimiento en crudo (`OWNER`, `OUT`) | Mapas `roleLabels` y `stockMovementTypeLabels` |
| 56 colores de Tailwind fijos (`text-red-600`, `bg-green-50`…) que no respetaban los temas | Tokens semánticos `destructive`/`success`/`warning` (la vista previa del PDF mantiene el blanco a propósito, porque simula papel) |
| `toFixed(2)` y porcentajes como `21.00%` | `formatAmount` y `formatPercent` con locale es-ES (tests añadidos) |
| Sin 404 raíz ni `global-error`; error raíz sin estilo; "dashboard" mezclado en español; títulos de estado sin `<h1>`; animaciones sin reduced-motion | `not-found.tsx`, `global-error.tsx`, `RouteErrorState` en todos los segmentos, "panel", `<h1>` y `motion-safe:` |
| Panel: "Buenos días" a cualquier hora, KPI con EUR fijo, badge siempre verde, `h2` anidados, bloque "Todos los módulos" que duplica el sidebar | Saludo según la hora de Madrid, moneda de la empresa, KPI con tono (vencidas → aviso, stock → peligro), jerarquía `h3`, alertas críticas en rojo, bloque duplicado eliminado |
| Adjuntos de gasto con `href` sin validar | Solo se renderizan rutas relativas o `http(s)`; `rel="noopener noreferrer"` |

### 7.2 Pendiente (siguiente iteración)

1. **i18n inexistente.** `messages/*.json` tiene 3 claves y nadie los importa; `LanguageSwitcher` es un "ES" estático. Hay que decidir: eliminar el andamiaje o migrar a `next-intl`.
2. **Formularios heterogéneos.** Ventas, compras, gastos, tesorería, fiscal y asientos usan `<label className="text-sm">` en vez de `AccessibleField`: sin marca de obligatorio, sin `aria-invalid` y sin errores asociados al campo. Varios paneles (`masters-panel`, `fiscal-settings-form`, `pdf-settings-form`) no son un `<form>`, así que Enter no envía y el guardián no aplica.
3. **Presupuestos y pedidos de venta sin totales** (subtotal, IVA, total) mientras se editan; el de compra sí los muestra.
4. **Listas.**
   - Paginación del lado cliente con 8 filas por defecto.
   - Sin cabecera fija ni fila de totales.
   - Facturas sin columnas de vencimiento ni pendiente, y sin filtro por fechas.
   - Checkbox de fila con el UUID como etiqueta.
   - Sin estado indeterminado.
   - El roving tabindex no se actualiza.
5. **Títulos por página.** Solo el panel y la 404 tienen `metadata`; el resto de pestañas se titulan "ERP Suite".
6. **Paleta de comandos.** Input sin `<label>` y sin semántica de combobox. Alt+1–4 choca con el cambio de pestaña del navegador en Linux y Windows.
7. **Migas de pan reales**, con nombre del registro, en las vistas de detalle.
8. **Panel.** Faltan KPI financieros con periodo y tendencia: ventas del mes frente al anterior, tesorería disponible, cuentas a pagar, antigüedad de deuda e IVA estimado del trimestre. También un gráfico de 12 meses (los tokens `--chart-*` existen pero no se usan).

## 8. Hoja de ruta propuesta

| Sprint | Objetivo |
|---|---|
| 0 (1–2 días) | CI en verde: actualizar `next`, `pdfjs-dist` y `nodemailer`, quitar los pins, `npm audit fix`, mover la auditoría al final del pipeline; borrar los ficheros de pnpm; Sentry completo. |
| 1 | Críticos contables 1–4 con tests de integración (PGlite): cuadre obligatorio, doble contabilización, apertura de ejercicio, filtro VOID. |
| 2 | Inmutabilidad de factura + rectificativas + snapshot. Retenciones 473/111. Allowlist de IP con proxy de confianza. Rate limit obligatorio. Selector de tenant. |
| 3 | Extraer `server/invoices/service.ts`; partir `supplier-invoices/service.ts`; unificar el cálculo de impuestos en un único motor con céntimos enteros; auditoría completa. |
| 4 | Paginación en servidor + índices; `cache()` del contexto; `resolveAccounts` en una sola consulta. |
| 5 | UX §7.2: formularios con `AccessibleField`, totales en ventas, listas y panel financiero. |
| 6 | VeriFactu (hash encadenado, QR, registro de eventos) y ampliación de modelos (303 completo, 349, 130). |

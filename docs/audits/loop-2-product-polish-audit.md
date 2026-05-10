# Loop 2 Product Polish Audit — post Loop 1

Fecha: 2026-05-09
Workspace: `/root/projects/erpboilerplate`
Branch observado: `main` con cambios Loop 1 sin commit tratados como baseline.
Foco: onboarding/demo journey, dashboard, IA, empty states, copy y priorización de flujos que hacen que el ERP parezca producto.

## Resumen ejecutivo

Loop 1 dejó módulos funcionales y smokes, pero la experiencia post-login sigue pareciendo un scaffold técnico en varios puntos clave. Las mejoras con más retorno son: convertir el dashboard en un cockpit accionable, conectar el primer journey demo desde onboarding hasta cliente/factura/cobro, y unificar los empty states/CTAs para que el usuario sepa qué hacer después.

No recomiendo ampliar dominio en Loop 2. Recomiendo cerrar 5 cards de polish que reordenan lo existente: dashboard, onboarding demo, listas/empty states, reporting/tesorería/contabilidad básicos y copy/IA de navegación.

## Evidencia inspeccionada

- Plan base: `docs/plans/2026-05-09-loop-2-polish-plan.md`
- Plan Loop 1: `docs/plans/loop-1-implementation.md`
- Auditoría producto previa: `docs/audits/product-ux-10-10-audit.md`
- Rutas/componentes inspeccionados:
  - `/` → `src/app/page.tsx`
  - `/onboarding` → `src/app/onboarding/page.tsx`, `src/components/onboarding/onboarding-wizard.tsx`
  - `/dashboard` → `src/app/dashboard/page.tsx`
  - Shell/nav → `src/components/layout/app-shell.tsx`
  - `/customers` → `src/app/customers/page.tsx`, `src/components/customers/customers-table.tsx`
  - `/invoices` → `src/app/invoices/page.tsx`, `src/components/create-invoice-form.tsx`
  - `/sales` → `src/app/sales/page.tsx`, `src/components/sales/sales-flow-actions.tsx`
  - `/purchases` → `src/app/purchases/page.tsx`, `src/components/purchases/purchase-flow-actions.tsx`
  - `/inventory` → `src/app/inventory/page.tsx`, `src/components/inventory/inventory-operations-panel.tsx`
  - `/accounting` → `src/app/accounting/page.tsx`, `src/components/accounting/create-journal-entry-form.tsx`
  - `/treasury` → `src/app/treasury/page.tsx`
  - `/reporting` → `src/app/reporting/page.tsx`
  - `/settings/security` → `src/app/settings/security/page.tsx`
  - `/settings/api-keys` → `src/app/settings/api-keys/page.tsx`

## Hallazgos priorizados

### P0 — El dashboard no actúa como home de producto

- Archivos/ruta: `/dashboard`, `src/app/dashboard/page.tsx`
- Evidencia: la página muestra datos de sesión/tenant y una lista plana de links: usuario, email, tenant, empresa, ejercicio, rol y CTAs `Ir a ...`.
- Impacto: tras login/onboarding el usuario no ve estado del negocio, próximos pasos ni progreso. La app se percibe como menú de módulos, no como ERP usable.
- Card sugerida: `L2 Product dashboard cockpit`
  - Reemplazar la lista por KPIs básicos disponibles: clientes, facturas abiertas, total facturado, pedidos/recepciones pendientes, alertas de stock, asientos/balance, suscripción/security status si aplica.
  - Añadir panel `Siguiente mejor acción` con CTAs condicionales: crear cliente, crear factura, registrar cobro, recepcionar compra, revisar stock bajo.
  - Mantener datos de contexto en una tarjeta secundaria compacta.
- Verificación:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`
  - `npm run test:e2e -- tests/e2e/app-shell-navigation.spec.ts`
  - Añadir/actualizar test de dashboard con seed vacío y seed con datos.

### P0 — Onboarding/demo no desemboca en una experiencia guiada

- Archivos/ruta: `/onboarding`, `src/components/onboarding/onboarding-wizard.tsx`, `src/app/page.tsx`
- Evidencia: el wizard permite saltar pasos, todos los campos son opcionales salvo email válido si se informa, el submit solo muestra toast y no redirige ni muestra checklist. La home pública sigue diciendo `ERP SaaS Starter` y `Base con Next.js...`, más propia de plantilla que de producto.
- Impacto: el primer-run no explica qué datos se han creado ni cuál es el primer workflow de negocio. Para demo/venta, el usuario queda sin camino claro.
- Card sugerida: `L2 Guided demo onboarding journey`
  - Después de seed, redirigir a `/dashboard?onboarded=1` o mostrar pantalla final con checklist y CTA principal `Crear primer cliente` / `Ver demo de factura`.
  - Añadir copy de producto en home: propuesta de valor ERP, roles, módulos clave; reducir links técnicos directos.
  - Hacer visibles los resultados del seed: empresa, serie, plan contable, datos demo disponibles.
  - Considerar progress indicator real y bloquear `Finalizar` hasta el último paso o confirmar explícitamente `Aplicar configuración demo`.
- Verificación:
  - `npm run typecheck`
  - `npm run lint`
  - E2E nuevo o ampliado: registro/login → onboarding seed → dashboard con checklist → CTA a cliente/factura.

### P1 — Flujos principales existen, pero las páginas no guían el journey cliente → venta → factura → cobro

- Archivos/rutas: `/customers`, `/sales`, `/invoices`, `src/app/customers/page.tsx`, `src/app/sales/page.tsx`, `src/app/invoices/page.tsx`, `src/components/sales/sales-flow-actions.tsx`, `src/components/create-invoice-form.tsx`
- Evidencia: ventas y compras tienen pipeline cards y transiciones, pero clientes/facturas siguen separadas. En `/invoices`, si no hay cliente solo aparece `Necesitas al menos un cliente activo...` sin CTA a clientes. La lista de clientes no enlaza a crear factura/venta. Los empty states son texto plano.
- Impacto: el workflow comercial requiere saber qué módulo abrir y en qué orden. Esto reduce sensación de producto acabado y dificulta demos.
- Card sugerida: `L2 Connected customer-to-cash journey`
  - Empty state de clientes: CTA `Crear cliente demo` / `Crear primer cliente`.
  - Empty state de facturas sin cliente: CTA directo a `/customers` y explicación de secuencia.
  - En filas de cliente: acción contextual `Crear factura` o `Iniciar venta` cuando el rol lo permita.
  - En `/sales`, explicar relación presupuesto → pedido → factura → cobro y enlazar facturas/cobros resultantes.
- Verificación:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`
  - E2E business journey: cliente → factura con líneas → marcar cobro → estado visible.

### P1 — Empty states y estados de bloqueo son inconsistentes entre módulos

- Archivos/rutas: `/customers`, `/invoices`, `/inventory`, `/accounting`, `/treasury`, `/reporting`, `/settings/api-keys`
- Evidencia:
  - `/customers`: `Todavía no hay clientes registrados.` sin CTA contextual.
  - `/invoices`: mensajes correctos pero sin acción directa.
  - `/inventory`: buen nivel de detalle y formularios, pero si faltan productos/almacenes solo dice crear producto/almacén; no hay enlace a maestros.
  - `/accounting`, `/treasury`, `/reporting`, `/settings/api-keys`: varios textos mínimos (`Sin cuentas`, `Sin métricas calculadas aún`) o ausencia de empty state si no hay API keys.
- Impacto: la app se siente irregular; unos módulos parecen producto y otros CRUD interno. En first-run se multiplican callejones sin salida.
- Card sugerida: `L2 Empty state and CTA system`
  - Crear patrón reusable de empty state con título, explicación, CTA principal/secundario y estado read-only.
  - Aplicarlo a clientes, facturas, inventario, contabilidad, tesorería, reporting y API keys.
  - Mapear prerequisitos: factura necesita cliente, movimiento stock necesita producto+almacén, transacción bancaria necesita cuenta, reporting necesita datos.
- Verificación:
  - `npm run typecheck`
  - `npm run lint`
  - Tests de render/componentes para empty states críticos.
  - E2E smoke de módulos core con base vacía.

### P1 — Reporting y dashboard de negocio no aprovechan los datos operativos

- Archivos/rutas: `/reporting`, `/dashboard`, `src/app/reporting/page.tsx`, `src/app/dashboard/page.tsx`, `src/server/reporting/service.ts`
- Evidencia: `/reporting` muestra `KPIs y dashboards de negocio`, botón export Excel y lista `metricKey: metricValue`. Si no hay métricas, `Sin métricas calculadas aún.` No hay interpretación, rangos, drilldown ni CTA a generar datos.
- Impacto: reporting no ayuda a validar valor del ERP; parece endpoint técnico de métricas.
- Card sugerida: `L2 Business KPI cards and reporting overview`
  - Formatear KPIs con labels humanos, moneda/fechas y agrupación por ventas/compras/stock/finanzas.
  - Añadir placeholders accionables cuando no hay datos: `Crea una factura`, `Registra un movimiento de stock`.
  - Reusar subset de KPIs en dashboard.
- Verificación:
  - `npm run typecheck`
  - `npm run lint`
  - Unit tests de formateo KPI si se crea mapper.
  - E2E reporting smoke con y sin datos.

### P1 — IA de navegación mejora, pero prioriza módulos por taxonomía interna más que por tareas

- Archivos/ruta: shell global `src/components/layout/app-shell.tsx`
- Evidencia: navegación agrupa `Operación` con ocho links al mismo nivel: clientes, facturas, compras, inventario, contabilidad, tesorería, fiscal, informes. No hay shortcut a onboarding/demo ni agrupación por tareas de venta/compra/finanzas.
- Impacto: el usuario novel no distingue workflows primarios de administración o reporting. Los módulos críticos compiten con módulos secundarios.
- Card sugerida: `L2 Navigation IA task grouping`
  - Reordenar navegación por tareas: `Vender` (Clientes, Ventas, Facturas), `Comprar y stock` (Compras, Inventario), `Finanzas` (Tesorería, Contabilidad, Fiscal, Informes), `Admin`.
  - Añadir acceso a `Demo/onboarding` si la app mantiene esa ruta para entornos demo.
  - Mantener tests de navegación y active route.
- Verificación:
  - `npm run test:e2e -- tests/e2e/app-shell-navigation.spec.ts`
  - `npm run typecheck`
  - `npm run lint`

### P2 — Copy técnico y mezcla de idiomas reducen acabado percibido

- Archivos/rutas: `/`, `/dashboard`, `/settings/security`, `/settings/api-keys`, varios componentes.
- Evidencia: Home usa `ERP SaaS Starter`, `Base con Next.js...`; dashboard dice `Base multi-tenant inicial...`; seguridad mezcla `Settings · Security`, `Tenant security controls`, `Admin controls enabled`; API keys no tiene descripción ni etiquetas de riesgo.
- Impacto: el producto parece boilerplate para desarrolladores, no ERP listo para usuarios de negocio.
- Card sugerida: `L2 Product copy pass`
  - Unificar idioma español en superficies de negocio o definir idioma por tenant si aplica.
  - Sustituir copy de starter por mensajes de valor y seguridad comprensibles.
  - Añadir descripciones de riesgo en seguridad/API keys.
- Verificación:
  - Review textual manual sobre rutas afectadas.
  - `npm run lint`
  - E2E navegación para asegurar que labels esperados se actualizan.

### P2 — Páginas maduras y páginas CRUD básicas conviven sin jerarquía visual común

- Archivos/rutas: `/inventory` frente a `/accounting`, `/treasury`, `/reporting`, `/settings/api-keys`
- Evidencia: inventario ya tiene secciones, formularios, filtros, alertas y tabla; contabilidad/tesorería/reporting/API keys siguen como una card con formularios/listas simples.
- Impacto: inconsistencia de calidad por módulo; puede parecer que unas áreas están terminadas y otras incompletas aunque funcionen.
- Card sugerida: `L2 Module page layout consistency`
  - Definir header estándar: eyebrow, título, descripción, CTA principal, contexto/rol.
  - Aplicar mínimo a contabilidad, tesorería, reporting y API keys.
  - No reescribir dominio; solo layout/copy/empty states.
- Verificación:
  - `npm run typecheck`
  - `npm run lint`
  - Visual/manual checklist responsive en rutas afectadas.

## No-gos recomendados para Loop 2

- No crear nuevos módulos funcionales grandes.
- No cambiar modelo de datos salvo que una mejora de dashboard/KPI lo exija y sea pequeña.
- No reimplementar pipelines de ventas/compras; ya existen y deben pulirse con copy/CTAs.
- No crear implementation cards desde esta auditoría; L2-F debe sintetizar backlog con el resto de audits.

## Backlog sugerido para L2-F

Orden recomendado:

1. `L2 Product dashboard cockpit` — P0, desbloquea demo post-login.
2. `L2 Guided demo onboarding journey` — P0, mejora first-run y venta.
3. `L2 Connected customer-to-cash journey` — P1, conecta módulos más valiosos.
4. `L2 Empty state and CTA system` — P1, reduce fricción transversal.
5. `L2 Business KPI cards and reporting overview` — P1, hace visible valor.
6. `L2 Navigation IA task grouping` — P1, claridad de producto.
7. `L2 Product copy pass + module layout consistency` — P2, puede combinarse si hay poco tiempo.

## Verificación global recomendada

Baseline/gates tras implementar mejoras de producto:

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

Specs E2E a priorizar o ampliar:

- `tests/e2e/app-shell-navigation.spec.ts`
- `tests/e2e/core-modules-smoke.spec.ts`
- `tests/e2e/invoice-lines.spec.ts`
- `tests/e2e/document-pipelines.spec.ts`
- Nuevo journey recomendado: onboarding/demo → dashboard → cliente → factura → cobro.

## Notas de baseline

- `git status --short --branch` confirma `main...origin/main` con muchos cambios Loop 1 sin commit y `docs/` sin trackear; no se revirtió nada.
- La auditoría se basa en lectura estática de código y docs. El preview local `http://127.0.0.1:3001/` no estuvo disponible durante la inspección previa, por lo que la validación visual/browser debe quedar para implementation/review cards.

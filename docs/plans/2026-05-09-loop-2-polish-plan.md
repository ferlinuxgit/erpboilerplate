# Loop 2 Polish Plan — ERP Boilerplate 10/10+

> **For Hermes/Kanban:** este loop afina la app después de Loop 1. No empezar implementación directa desde PM; primero auditar el estado real post-Loop 1, sintetizar backlog L2 y pasar por revisión de arquitectura. Las cards de implementación deben trabajar en `/root/projects/erpboilerplate` y verificar gates.

## Goal

Subir la app de “funcional y cubierta por smokes” a “producto pulido”: navegación más coherente, flujos principales sin fricción, estados vacíos/loading/error profesionales, guardrails de seguridad/datos más consistentes, documentación operativa y calidad CI/E2E más robusta.

## Estado base observado

Fecha: 2026-05-09.

Repo: `/root/projects/erpboilerplate`, branch `main`.

Board `programacion` antes de Loop 2:
- 19 cards completadas.
- 0 running / 0 ready / 0 blocked.
- Loop 1 cerró build/runtime, billing/security, invoice lines, inventory ops, accounting journal editor, sales/purchases pipelines y e2e smoke core.

Baseline local ejecutado antes de sembrar Loop 2:

```bash
npm run typecheck # PASS
npm run lint      # PASS con 1 warning existente en customers-table/useReactTable
npm test          # PASS, 19 files / 90 tests
```

Estado git: workspace con muchos cambios de Loop 1 aún sin commit. Los workers deben tratar esos cambios como base actual y no revertir trabajo ajeno.

## Definition of Done para Loop 2

Loop 2 queda cerrado cuando:

1. Hay auditoría post-Loop 1 documentada con gaps reales, no supuestos antiguos.
2. Existe plan priorizado `docs/plans/loop-2-implementation.md` con 5–8 mejoras L2 concretas.
3. Arquitectura aprueba el plan o pide cambios explícitos.
4. Al menos las mejoras P0/P1 del plan están implementadas y verificadas con:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - `npm run test:e2e` o specs e2e relevantes cuando aplique.
5. Los cambios no introducen secretos, migraciones destructivas ni flakiness nueva.

## Áreas candidatas a afinar

El PM no debe asumir que todas se implementan; los auditores deben verificar y priorizar.

- **Product/UX:** onboarding demo, jerarquía de dashboard, copy de acciones, empty states, first-run experience, flujos de ventas/compras/facturas/inventario con menos saltos.
- **Frontend/UI:** design system más uniforme, responsive polish, estados loading/error/success, feedback tras submit, tablas/filtros/búsqueda/paginación, reducción de hydration warnings.
- **Backend/domain:** invariantes transversales tenant/user, validación Zod consistente en mutaciones, auditoría de acciones críticas, consistencia contable/stock/documentos.
- **QA:** pasar de smokes a journeys de negocio integrados, fixtures más robustas, reducir skips, capturar regresiones de accesibilidad.
- **DevOps/docs:** CI realista, env/docs de demo, build/deploy reproducible, healthcheck y scripts de verificación.

## Initial task graph

```text
L2-A Product polish audit        (pm)          no parents
L2-B Frontend polish audit       (frontendeng) no parents
L2-C Backend/domain hardening    (backendeng)  no parents
L2-D QA/e2e regression audit     (qa)          no parents
L2-E DevOps/docs/release audit   (devops)      no parents
        \       |       |       |       /
         \      |       |       |      /
          L2-F Synthesize Loop 2 implementation plan (pm) parents: A-E
                         |
          L2-G Architect review Loop 2 plan          (architect) parent: F
```

## Instructions for L2 audit cards

Each audit card must:

- Read this plan and relevant Loop 1 docs under `docs/plans/` and `docs/audits/`.
- Inspect the actual codebase, not only old audit docs.
- Respect current uncommitted Loop 1 changes; do not revert them.
- Produce findings with:
  - severity P0/P1/P2
  - exact files/routes affected
  - user/business impact
  - suggested implementation cards
  - verification commands/specs.
- Avoid creating implementation cards directly unless asked; L2-F owns synthesis.

## Suggested L2 implementation themes for synthesis

Prioritize work that makes the app feel finished without expanding scope wildly:

1. **Customer/invoice/sales connected journey:** from customer creation to quote/order/invoice/payment state, with coherent CTAs and success states.
2. **Dashboard and reporting usefulness:** meaningful KPIs from seeded/local data, empty state guidance, links to next actions.
3. **Table and form consistency:** shared patterns for filters, search, validation errors, destructive actions, save feedback.
4. **Security/admin clarity:** API key/session/security policy screens with clear risk labels and audit trail visibility.
5. **E2E business journeys:** one or two full workflows over isolated test data, fewer skips, less brittle setup.
6. **Release/demo readiness:** README/demo env/scripts, CI gates, artifact hygiene, deploy notes.

## Gates for L2-F synthesis

The PM synthesis card must write `docs/plans/loop-2-implementation.md` and include:

- current baseline summary
- prioritized backlog with dependencies
- exactly which cards to create next
- review strategy
- verification matrix
- explicit non-goals.

## Gates for L2-G architect review

Architect must return one of:

- `APPROVED`: implementation cards may be created.
- `REQUEST_CHANGES`: list changes needed before implementation.

Architect should check scope control, dependency order, data safety, testability and whether the plan improves real product quality rather than just adding features.

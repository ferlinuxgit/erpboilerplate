# ERP SaaS Boilerplate

Base avanzada para un ERP SaaS multi-tenant con:

- Next.js (App Router + TypeScript)
- Tailwind CSS
- shadcn/ui
- Auth email/password con cookie JWT HTTP-only
- PostgreSQL con Drizzle ORM
- RBAC por tenant, empresa activa y ejercicio fiscal
- Auditoría de mutaciones de negocio
- Módulos de clientes, ventas, facturación, compras, inventario, contabilidad, tesorería, fiscalidad, reporting, billing y settings

## Getting Started

1. Instala dependencias:

```bash
npm install
```

1. Crea tu archivo de entorno duplicando `.env.example` como `.env`.

1. Configura `DATABASE_URL`, `JWT_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` y `NEXT_PUBLIC_BETTER_AUTH_URL` en `.env`. `JWT_SECRET` firma la cookie HTTP-only `erp_auth_token`; `BETTER_AUTH_SECRET` se mantiene como fallback compatible para entornos existentes. `npm run build` ejecuta un preflight que carga `.env*` y falla de forma clara si falta alguna variable antes de que Next.js recolecte páginas o rutas que importan la DB, como `src/app/api/api-keys/route.ts`.

1. Ejecuta y verifica migraciones en una base limpia antes de desplegar:

```bash
npm run db:migrate:verify
npm run db:migrate
```

1. Arranca el entorno local:

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## E2E con Playwright

La suite por defecto se ejecuta con un servidor web y una base PGlite gestionada por `scripts/e2e-with-pglite.mjs`, así que los recorridos de negocio obligatorios no deben ocultarse con `test.skip` dependiente de `DATABASE_URL`.

```bash
npm run test:e2e
```

Variables útiles:

- `PORT`: puerto del servidor Next.js usado por Playwright; por defecto `3000`.
- `E2E_DATABASE_PORT`: puerto del servidor PostgreSQL/PGlite gestionado para E2E; por defecto `55432`.
- `PLAYWRIGHT_SKIP_WEBSERVER=1`: usa un servidor externo ya arrancado.
- `E2E_ALLOWED_SKIPS`: lista explícita de skips permitidos por la política de QA; en CI se deja vacío para hacer obligatoria la suite.

Playwright genera `playwright-report/` y `test-results/`; CI los sube siempre como artefactos para depurar fallos.

## Estructura principal

- `src/app`: páginas App Router y route handlers de los módulos ERP/SaaS.
- `src/components`: formularios, tablas, navegación, acciones de flujo y componentes UI.
- `src/server`: servicios de dominio para ventas, compras, inventario, contabilidad, tesorería, fiscalidad, billing, seguridad y reporting.
- `src/lib`: autenticación JWT, contexto activo, RBAC, i18n, formato, cálculos y helpers compartidos.
- `src/db/schema.ts`: schema Drizzle de auth, tenant, empresa, documentos, inventario, contabilidad, tesorería, fiscalidad, billing, auditoría y seguridad.
- `drizzle/0000_authoritative_schema.sql`: migración autoritativa verificada contra una base limpia.
- `tests/e2e`: recorridos Playwright de onboarding, módulos core, documentos, inventario, contabilidad, reporting y seguridad.
- `docs/audits` y `docs/plans`: evidencias de auditoría, readiness y planes de implementación.

## Gates recomendados antes de merge/deploy

```bash
npm run typecheck
npm run lint
npm test
npm run db:migrate:verify
npm run build
npm run test:e2e
```

`npm run typecheck` limpia `.next/dev` antes de ejecutar `tsc` para evitar que artefactos dev corruptos de Next bloqueen la verificación local.

## Produccion

Para un despliegue real en Coolify/Neon, usa este flujo:

```bash
npm run release:verify
```

Variables minimas de runtime:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET` con al menos 32 caracteres
- `BETTER_AUTH_URL`
- `NEXT_PUBLIC_BETTER_AUTH_URL`

El contenedor valida estas variables al arrancar, puede esperar a la base de datos y opcionalmente ejecutar migraciones si `RUN_MIGRATIONS_ON_START=true`.

Pasos recomendados de deploy:

1. Configura variables de build y runtime en Coolify.
2. Ejecuta `npm run db:migrate` contra la base real o activa `RUN_MIGRATIONS_ON_START=true` solo en despliegues de una replica.
3. Comprueba `GET /api/health` y `GET /api/readyz`.
4. Ejecuta el smoke post-deploy:

```bash
APP_URL=https://tu-dominio.example npm run deploy:smoke
```

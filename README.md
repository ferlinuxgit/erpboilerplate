# ERP SaaS Starter

Base lista para empezar un ERP SaaS con:

- Next.js (App Router + TypeScript)
- Tailwind CSS
- shadcn/ui
- JWT auth (email + password)
- PostgreSQL con Drizzle ORM

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

## Estructura inicial

- `src/app/api/auth/login/route.ts`, `src/app/api/auth/register/route.ts` y `src/app/api/auth/logout/route.ts`: endpoints de autenticación JWT con cookie HTTP-only.
- `src/app/api/customers/route.ts`: alta de clientes multi-tenant.
- `src/app/api/invoices/route.ts`: alta de facturas multi-tenant.
- `src/app/auth/login` y `src/app/auth/register`: flujo de acceso/alta.
- `src/app/dashboard`: página protegida por JWT.
- `src/app/customers`: módulo inicial de clientes.
- `src/app/invoices`: módulo inicial de facturas.
- `src/lib/auth.ts`: emisión y validación de JWT HS256.
- `src/lib/db.ts`: cliente y conexión a PostgreSQL con Drizzle.
- `src/lib/rbac.ts`: permisos por rol para operaciones de escritura.
- `src/db/schema.ts`: modelos de auth, organización, membresías, clientes y facturas.

## Siguientes pasos recomendados

- Añadir multi-tenant (`organizationId`) en los modelos de negocio.
- Crear módulos ERP (clientes, facturas, inventario, compras, contabilidad).
- Implementar control de permisos (RBAC) por rol.
- Incorporar observabilidad (logs, métricas y trazas).

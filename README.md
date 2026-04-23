# ERP SaaS Starter

Base lista para empezar un ERP SaaS con:

- Next.js (App Router + TypeScript)
- Tailwind CSS
- shadcn/ui
- better-auth (email + password)
- PostgreSQL con Drizzle ORM

## Getting Started

1. Instala dependencias:

```bash
npm install
```

1. Crea tu archivo de entorno duplicando `.env.example` como `.env`.

1. Configura `DATABASE_URL` y `BETTER_AUTH_SECRET` en `.env`.

1. Ejecuta migraciones:

```bash
npm run db:migrate
```

1. Arranca el entorno local:

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Estructura inicial

- `src/app/api/auth/[...all]/route.ts`: endpoint de better-auth.
- `src/app/api/customers/route.ts`: alta de clientes multi-tenant.
- `src/app/api/invoices/route.ts`: alta de facturas multi-tenant.
- `src/app/auth/login` y `src/app/auth/register`: flujo de acceso/alta.
- `src/app/dashboard`: página protegida por sesión.
- `src/app/customers`: módulo inicial de clientes.
- `src/app/invoices`: módulo inicial de facturas.
- `src/lib/auth.ts`: configuración del servidor de auth.
- `src/lib/db.ts`: cliente y conexión a PostgreSQL con Drizzle.
- `src/lib/rbac.ts`: permisos por rol para operaciones de escritura.
- `src/db/schema.ts`: modelos de auth, organización, membresías, clientes y facturas.

## Siguientes pasos recomendados

- Añadir multi-tenant (`organizationId`) en los modelos de negocio.
- Crear módulos ERP (clientes, facturas, inventario, compras, contabilidad).
- Implementar control de permisos (RBAC) por rol.
- Incorporar observabilidad (logs, métricas y trazas).

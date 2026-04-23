# Reglas de Cursor — ERP SaaS

Las reglas viven en este directorio como archivos `.mdc` con frontmatter YAML. Cursor las aplica automáticamente:

- **`alwaysApply: true`** → se aplican en todas las sesiones del workspace.
- **`globs: <patrón>`** → se activan cuando se editan archivos que coinciden con el patrón.

## Índice

| Archivo | Alcance | Propósito |
|---------|---------|-----------|
| `00-project-context.mdc` | global | Stack, estructura, idioma y checklist previo. |
| `01-architecture-and-flow.mdc` | global | Capas y dirección de dependencias. |
| `02-multi-tenant-rbac-audit.mdc` | global | Los tres MUST: tenant + RBAC + auditoría. |
| `03-coding-standards.mdc` | global | TypeScript, naming, imports, comentarios. |
| `04-security-and-validation.mdc` | global | Validación, secretos, errores, dependencias. |
| `05-workflow-and-quality.mdc` | global | Flujo de trabajo y criterios de "hecho". |
| `20-nextjs-app-router.mdc` | `src/app/**/*.{ts,tsx}` | Next.js 16, Server Components, `params` async. |
| `21-api-routes.mdc` | `src/app/api/**/route.ts` | Plantilla de route handlers. |
| `22-server-services.mdc` | `src/server/**/*.ts` | Patrón de servicios de dominio. |
| `23-drizzle-db.mdc` | `src/db/**`, `src/server/**`, `src/app/api/**`, `drizzle.config.ts` | Schema, consultas, migraciones. |
| `24-react-ui-components.mdc` | `src/components/**/*.tsx`, `src/app/**/*.tsx` | React, Tailwind v4, shadcn/ui. |
| `25-forms-rhf-zod.mdc` | global | Patrón de formularios con RHF + Zod. |
| `26-fiscal-provider.mdc` | global | Convenciones para providers fiscales por país. |
| `27-billing-stripe.mdc` | global | Reglas de Stripe y webhooks. |
| `28-i18n.mdc` | global | Convenciones de internacionalización. |
| `29-testing.mdc` | global | Estrategia mínima de tests y CI. |

## Cómo añadir una regla nueva

1. Una responsabilidad por archivo (≤ ~80 líneas).
2. Frontmatter: `description`, y `alwaysApply: true` **o** `globs: <patrón>`.
3. Incluye al menos un ejemplo `❌ BAD` / `✅ GOOD`.
4. Numera el prefijo para ordenar: `0X-` global, `2X-` específico por capa.
5. Actualiza este índice.

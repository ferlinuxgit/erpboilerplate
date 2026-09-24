# Deploy ERP SaaS

## Entorno mínimo

Variables obligatorias para local/CI/build/runtime:

- `DATABASE_URL`: requerida por Drizzle y por rutas/páginas App Router que importan DB. `npm run build` ejecuta `scripts/check-build-env.mjs` como preflight, carga `.env*` y falla antes de la recolección de páginas si falta. Usa una URL de base de datos real del entorno; no commits credenciales.
  Para conexiones TLS remotas con el comportamiento estricto actual de `pg`, usa `sslmode=verify-full` explícitamente en lugar de `sslmode=require`.
- `JWT_SECRET`: secreto de firma de sesión, con al menos 32 caracteres.
- `APP_URL`: URL canónica HTTPS de la app.

Plantillas versionables:

- `.env.example`: copia base para desarrollo o despliegue.
- `.env.test.example`: copia base para CI/E2E. Copia a `.env.test` o inyecta sus claves en el runner.

`.gitignore` ignora `.env*` reales y permite explícitamente estas dos plantillas sanitizadas. No commits credenciales.

## Borde de la app (Next 16)

- El borde HTTP vive en `src/proxy.ts` (sustituye al antiguo `middleware.ts`).
- Las mutaciones `POST/PATCH/DELETE` bajo `/api/*` exigen siempre una cabecera `x-csrf-token` igual a la cookie `csrf-token`, salvo autenticación Bearer y webhooks verificados.

## Integraciones opcionales

- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_DEFAULT_STRIPE_PRICE_ID`
- Upstash: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`
  `SMTP_HOST` debe coincidir con un hostname incluido en el certificado TLS del servidor. No uses un alias MX si el certificado identifica otro nombre.
  En Coolify, configura `SMTP_PASSWORD` desde la vista normal y activa `Literal` si contiene `$` u otros caracteres especiales; de lo contrario Coolify puede interpolar el valor antes de pasarlo al contenedor. Déjala solo como variable de runtime, no de build.
- Sentry servidor: `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` (runtime). Errores de request se reportan vía `onRequestError` en `instrumentation.ts`.
- Sentry navegador: `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (**build-time**, se incrustan en el bundle; en Docker pásalo como build arg `NEXT_PUBLIC_SENTRY_DSN`). Sin DSN, `instrumentation-client.ts` no inicializa nada. Su origen se añade automáticamente a `connect-src` de la CSP.
- Sentry source maps (opcional, build-time): `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`. Sin token no se generan ni suben source maps ni se crean releases.
- S3/R2: `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`

## Migraciones Drizzle

`src/db/schema.ts` es la fuente autoritativa para el esquema. `drizzle/0000_authoritative_schema.sql` y `drizzle/meta/0000_snapshot.json` son una línea base limpia generada desde ese schema para entornos nuevos.

Antes de desplegar o tocar la DB, valida que la línea base aplica en una base limpia:

```bash
npm run db:migrate:verify
```

El comando usa PGlite en memoria, aplica las migraciones registradas en `drizzle/meta/_journal.json` y comprueba que existen todas las tablas declaradas con `pgTable(...)` en `src/db/schema.ts`.

Para una base real de entorno:

```bash
npm run db:migrate
```

Rollback mínimo: restaura snapshot/backup de la base antes del deploy; las migraciones no deben revertirse manualmente en producción sin una migración inversa revisada. Ver [Rollback y backup/restore](#rollback-y-backuprestore).

## Health/readiness

La app expone endpoints JSON seguros para operaciones y balanceadores:

- `GET /api/health`: liveness del proceso. No importa la DB y debe responder `200` mientras el runtime Next esté vivo.
- `GET /api/readyz`: readiness de dependencias. Ejecuta una sonda SQL corta (`select 1 as ready`) contra `DATABASE_URL` y responde `200` si la DB está disponible o `503` con estado degradado si falta configuración o la DB no responde.

Los dos endpoints devuelven solo `service`, `status`, `checks` y `version.sha`; no incluyen DSNs, secretos, errores crudos ni stack traces.

Smoke local tras `npm run build`:

Terminal 1:

```bash
npm start -- --hostname 127.0.0.1 --port 3000
```

Terminal 2:

```bash
curl -i http://127.0.0.1:3000/api/health
curl -i http://127.0.0.1:3000/api/readyz
```

## Runbook Loop 2

El checklist completo de release/demo, evidencias por card y waivers aceptables está en `docs/runbooks/loop-2-release.md`.

## Pipeline

Checklist local/CI obligatorio:

1. `npm ci`
2. `npm run db:migrate:verify`
3. `npm run db:migrate` contra la DB del entorno cuando aplique
4. `npm run typecheck`
5. `npm run lint`
6. `npm test`
7. `npm run build`
8. `curl -i /api/health` y `curl -i /api/readyz` contra el build arrancado
9. `npm run test:e2e` sin skips obligatorios
10. Auditoría de dependencias al final: `npm run audit:prod` (bloqueante: dependencias de producción, severidad high/critical) y `npm run audit:release` (informativa en CI: árbol completo, moderate+).

Node.js 22 (`.nvmrc`, `engines.node >=22`) en local, CI y Docker. npm es el único gestor de paquetes.

## Docker

- La imagen final corre como usuario sin privilegios `node`.
- `HEALTHCHECK` consulta `GET /api/health` con `fetch` de Node (la imagen slim no trae `curl`); `start-period` de 90 s cubre la espera de DB y las migraciones de arranque.
- No se usa `output: "standalone"`: `scripts/docker-start.mjs` arranca con `npm run start`, ejecuta `drizzle-kit migrate` y el worker OCR (`tsx`), que necesitan `node_modules` completo de producción, `src/` y `drizzle/`.

## Rollback y backup/restore

Antes de cada deploy con migraciones, toma un backup de la base:

```bash
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > backup-$(date +%Y%m%d-%H%M%S).dump
```

(o un snapshot/branch del proveedor, p. ej. Neon). Guarda el fichero fuera del servidor de la app y nunca en el repositorio.

Rollback de la app (sin cambios de esquema incompatibles): en Coolify vuelve a desplegar la imagen/commit anterior ("Redeploy" de un deployment previo) o `git revert` del commit y push a `main`. Comprueba `GET /api/health` y `GET /api/readyz`.

Rollback con migraciones aplicadas:

1. Para la app (o ponla en mantenimiento) para evitar escrituras.
2. Restaura el backup previo al deploy en una base nueva y verifica:

   ```bash
   createdb erp_restore
   pg_restore --no-owner --no-acl --dbname="postgresql://.../erp_restore" backup-AAAAMMDD-HHMMSS.dump
   ```

3. Apunta `DATABASE_URL` a la base restaurada (o renómbrala) y despliega la versión anterior de la app.
4. Verifica `/api/readyz` y un smoke funcional (`npm run deploy:smoke`).

Los datos escritos entre el backup y el rollback se pierden; si no es aceptable, escribe una migración inversa revisada en lugar de restaurar. Prueba la restauración periódicamente en un entorno no productivo.

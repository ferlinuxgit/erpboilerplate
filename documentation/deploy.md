# Deploy ERP SaaS

## Entorno mínimo

Variables obligatorias para local/CI/build/runtime:

- `DATABASE_URL`: requerida por Drizzle y por rutas/páginas App Router que importan DB. `npm run build` ejecuta `scripts/check-build-env.mjs` como preflight, carga `.env*` y falla antes de la recolección de páginas si falta. Usa una URL de base de datos real del entorno; no commits credenciales.
  En producción es la URL interna del PostgreSQL del propio proyecto de Coolify (host = UUID de la base, sin TLS). Si alguna vez apuntas a un Postgres remoto con TLS, usa `sslmode=verify-full` explícitamente en lugar de `sslmode=require`.
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

- Stripe (cobro del SaaS): `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` (webhook en `/api/billing/webhook` con los eventos `customer.subscription.*`, `checkout.session.completed`, `checkout.session.async_payment_succeeded` e `invoice.paid`). `PLATFORM_INVOICE_COMPANY_ID` (id de la empresa de la plataforma en este ERP) emite la factura legal con VERI*FACTU de cada cobro. Los productos y precios se crean solos desde `src/lib/billing/catalog.ts`; activa Stripe Tax y el portal de cliente en el panel de Stripe. `BILLING_ENFORCED=false` desactiva el cobro.
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

### Nota de la migración 0031 (roles)

Desde la 0031 el rol **Miembro** puede operar (clientes, facturas, gastos, compras, stock, bancos); antes era de solo lectura, y ese comportamiento lo tiene ahora el rol **Solo lectura** (`VIEWER`). Si una instalación tiene miembros que deben seguir sin poder escribir, ejecuta **después** de aplicar la migración (en una transacción aparte, porque Postgres no permite usar un valor de enum en la misma transacción en que se crea):

```sql
UPDATE membership SET role = 'VIEWER' WHERE role = 'MEMBER';
UPDATE invitation SET role = 'VIEWER' WHERE role = 'MEMBER' AND "acceptedAt" IS NULL;
```

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

(o las copias programadas de la base en Coolify: Databases → erp-postgres → Backups, a ser posible a S3). Guarda el fichero fuera del servidor de la app y nunca en el repositorio.

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

## Recurrencias y recordatorios de cobro

Las facturas y gastos recurrentes y los recordatorios de cobro automáticos se procesan fuera de las peticiones. Ambas tareas son idempotentes (cada periodo se genera una sola vez, `recurring_run` es único por plantilla y fecha), así que puedes combinar las dos opciones o ejecutarlas en varias réplicas.

- **Worker continuo** (Docker/Coolify, VPS): `npm run recurring:worker`. Cada `RECURRING_WORKER_INTERVAL_MS` (15 min por defecto) genera los periodos vencidos y envía los recordatorios que tocan. Con `RECURRING_WORKER_ONCE=true` hace un solo ciclo y termina (para un cron del sistema, p. ej. `0 * * * *`).
- **Cron HTTP** (plataformas sin procesos permanentes): define `CRON_SECRET` (mínimo 16 caracteres) y llama a `GET /api/recurring/run` con `Authorization: Bearer $CRON_SECRET` o `x-cron-secret: $CRON_SECRET` (formato compatible con Vercel Cron). Sin `CRON_SECRET` la ruta responde 401.
  - `POST` también está disponible, pero pasa por la comprobación CSRF de `src/proxy.ts`: envía además `x-csrf-token: x` y la cookie `csrf-token=x`, o usa `GET`.
- El envío de emails usa el SMTP de «Integraciones opcionales». Sin SMTP, las recurrencias se generan igualmente (las de «emitir y enviar» quedan emitidas con un aviso) y los recordatorios automáticos no se envían.
- "Hoy" se calcula en la zona horaria de cada empresa (`company.timezone`, por defecto Europe/Madrid).

## Tesorería: conexión bancaria PSD2 y remesas SEPA

- **Conexión bancaria (GoCardless Bank Account Data, antes Nordigen)**: define `GOCARDLESS_SECRET_ID` y `GOCARDLESS_SECRET_KEY` (panel de GoCardless › *User secrets*) y un `APP_URL` público: el banco devuelve al usuario a `$APP_URL/treasury/bank-connections/callback`. Sin credenciales la pantalla *Tesorería › Conexión con el banco* se muestra desactivada con una explicación.
  - Los identificadores del proveedor (requisition, acuerdo y cuentas) se guardan cifrados con AES-256-GCM. La clave se deriva de `BANK_CONNECTIONS_ENCRYPTION_KEY` (o, si no existe, de `JWT_SECRET`): si la cambias, hay que volver a conectar los bancos. El token de acceso de GoCardless solo vive en memoria del servidor y se renueva solo.
  - La sincronización automática la hace el worker de recurrencias (`npm run recurring:worker`) cada `BANK_SYNC_INTERVAL_HOURS` (6 h por defecto; GoCardless permite 4 lecturas de movimientos al día por cuenta). Solo se importan movimientos contabilizados (*booked*), deduplicados por su `transactionId`.
  - El consentimiento PSD2 dura 90 días: la pantalla avisa 14 días antes y el usuario lo renueva desde allí.
- **Remesas de cobros (adeudos SEPA CORE, pain.008.001.02)**: cada empresa necesita su *identificador de acreedor SEPA* (Ajustes › Empresa) y un mandato firmado por cliente (ficha del cliente › Domiciliación bancaria). No requiere configuración del servidor.
- Cambios de esquema de este bloque: columna `company.sepaCreditorId`, tablas `sepa_mandate`, `sepa_direct_debit_remittance`, `sepa_direct_debit_item`, `bank_connection`, `bank_connection_account` y el valor `PSD2` en el check `bank_transaction_import_source_valid`. Genera y aplica la migración (`npm run db:generate` + `npm run db:migrate`).

## Factura electrónica (Facturae, UBL y FACe)

Desde la ficha de una factura emitida se descargan Facturae 3.2.2 (firmado XAdES-EPES con el certificado
de la empresa o sin firmar), UBL 2.1 del núcleo EN 16931 y UBL 2.5 con el perfil de la solución pública de
la AEAT (Orden HAC/1028/2026, anexo I), además del mensaje UBL de cobro (anexo II) desde el estado
«Pagada». Nada de esto necesita configuración. Cada fichero se conserva en el almacenamiento privado
(`/app/.data` en producción) con su huella y con los DIR3 e IBAN de domiciliación usados.

**Remisión a FACe (opcional, sin probar contra FACe).** Para activarla:

1. Cada empresa da de alta en face.gob.es («alta proveedores») la parte pública del certificado que
   sube en Fiscalidad › VERI*FACTU: con él se firma la petición (WS-Security X.509).
2. `FACE_TRANSPORT=face` y `FACE_ENVIRONMENT`, **obligatoria y sin valor por defecto**: `staging`
   (https://se-face-webservice.redsara.es/facturasspp2, pruebas) o `production`
   (https://webservice.face.gob.es/facturasspp2). Si falta o es otro valor, la ficha lo avisa y no se envía.
3. Cada envío guarda su entorno: las consultas de estado y las anulaciones solo se hacen desde un servidor
   configurado en ese mismo entorno. Prueba primero en `staging` con un certificado real.

Lo remitido a FACe queda congelado (no se vuelve a firmar). La aplicación no remite nada a la solución
pública de la AEAT: los ficheros UBL se suben a mano o los entrega una plataforma privada.

## VERI*FACTU (envío a la AEAT)

Sin configurar, el envío está desactivado y **ninguna empresa puede activar VERI*FACTU** (una factura no
puede anunciarse como verificable si no se remite). Para ponerlo en marcha:

1. **Productor y declaración responsable.** Define `VERIFACTU_PRODUCER_NAME`, `VERIFACTU_PRODUCER_NIF`,
   `VERIFACTU_PRODUCER_ADDRESS`, `VERIFACTU_SYSTEM_NAME`, `VERIFACTU_SYSTEM_ID` (2 caracteres),
   `VERIFACTU_DECLARATION_DATE` y `VERIFACTU_DECLARATION_PLACE`. Se muestran en
   Fiscalidad › VERI*FACTU › Declaración responsable (con descarga en PDF); sin NIF del productor el envío
   no se activa.
   - **Versión.** La versión del sistema es la del despliegue: la de `package.json` más el commit corto si
     el entorno define `SOURCE_COMMIT` (p. ej. `0.1.0+5122131`). `VERIFACTU_SYSTEM_VERSION` la sustituye si
     se quiere fijar a mano. La primera vez que se abre la declaración con una versión nueva queda guardada
     en el histórico (tabla `verifactu_declaration`) con su texto y su fecha: súbela de versión
     (`package.json`) cuando cambie algo que afecte a la facturación.
2. **Entorno.** `VERIFACTU_ENVIRONMENT` es **obligatoria con `VERIFACTU_TRANSPORT=aeat`** y no tiene valor
   por defecto: `test` remite a la preproducción de la AEAT (y el QR apunta a ella); `production`, al
   servicio real. Si falta o tiene otro valor, el envío queda desactivado y no se pueden emitir facturas
   con registro (se avisa en pantalla). Sin envío activado (`VERIFACTU_TRANSPORT` sin definir) se asume
   `test`: los registros nacen como pruebas y así se rotulan («ENTORNO DE PRUEBAS · SIN VALIDEZ FISCAL»).
   Cada registro guarda el entorno en el que nació: cambiar la variable no mueve los existentes (los del
   otro entorno dejan de enviarse desde este servidor). Prueba siempre primero en `test` con un
   certificado real.
3. **Transporte y worker.** `VERIFACTU_TRANSPORT=aeat` y `VERIFACTU_WORKER_ENABLED=true` (el worker envía
   los registros pendientes cada minuto y respeta el tiempo de espera que indica la AEAT).
4. **Certificados.** Cada empresa sube su certificado (.p12/.pfx) en Configuración › Fiscalidad; se guarda
   cifrado con `INTEGRATIONS_ENCRYPTION_KEY` (o `JWT_SECRET`): si esa clave cambia hay que volver a subirlos.
   Opcionalmente, `VERIFACTU_CERT_PATH` / `VERIFACTU_CERT_PASSWORD` definen un certificado del sistema para
   las empresas sin certificado propio; su titular debe ser colaborador social o estar apoderado por cada
   empresa ante la AEAT, o la AEAT rechazará los envíos. Su caducidad se vigila igual que la de los
   certificados de empresa: se avisa 30 días antes y, una vez caducado, los envíos de las empresas que
   dependen de él se detienen (los registros quedan pendientes) hasta que se renueve el fichero.

El sistema solo funciona como VERI*FACTU (no hay modalidad de registros firmados sin remisión). Un registro
rechazado o aceptado con errores se subsana desde Fiscalidad › VERI*FACTU tras corregir el dato en la ficha.

## SII (Suministro Inmediato de Información)

Solo afecta a las empresas que marcan el SII en Configuración › Fiscalidad (pantalla Fiscalidad › SII).

1. **Entorno.** `SII_ENVIRONMENT` (`test` | `production`) es obligatoria con `SII_TRANSPORT=aeat` y no tiene
   valor por defecto. Cada registro guarda su entorno, como en VERI*FACTU.
2. **Worker.** `npm run sii:worker` (en Docker, `SII_WORKER_ENABLED=true`; apagado por defecto). Cada
   `SII_WORKER_INTERVAL_MS` (5 min) revisa las facturas, prepara la bandeja de salida con sus plazos y, solo
   con `SII_TRANSPORT=aeat`, la envía. `SII_WORKER_ONCE=true` hace una vuelta (para un cron).
3. **Certificados.** Los de cada empresa (los mismos de VERI*FACTU) o el del sistema (`SII_CERT_PATH`,
   `SII_CERT_PASSWORD`, `SII_CERT_SEAL=S` si es de sello). `SII_EXTRA_HOLIDAYS` añade festivos nacionales al
   cómputo del plazo (los del calendario compartido `src/lib/spanish-holidays.ts` ya cuentan).
4. **Libros que se suministran.** Facturas expedidas y recibidas (alta, modificación y baja); cobros y pagos
   del criterio de caja (clave 07: empresa con régimen `cash_accounting` desde `sii_settings.cashAccountingSince`,
   que se puede cambiar en la pantalla, o factura de compra con `supplierCashAccounting`); y libro anual de
   bienes de inversión de los ejercicios con prorrata definitiva confirmada (`company_settings.vatProrataFinal`).
   Las rectificativas van siempre por diferencias (tipo I): la rectificación por sustitución no aplica. El libro
   de determinadas operaciones intracomunitarias no se suministra: la aplicación no registra esas operaciones
   (envíos de bienes para informes, obras o ventas en consigna).
5. **Sin verificar contra la AEAT.** Los mensajes se validan en los tests contra los XSD oficiales (1.1 «bis»),
   pero ningún envío se ha probado contra los servicios de la AEAT. Antes de usarlo en `production`, prueba
   en `test` con un certificado real: en especial los cobros y pagos (la respuesta identifica la factura,
   no cada cobro) y el libro de bienes de inversión.

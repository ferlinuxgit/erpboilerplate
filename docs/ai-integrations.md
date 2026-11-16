# Integración con IA (MCP + OAuth) y API completa

El ERP se conecta con **Claude, ChatGPT y cualquier asistente compatible con MCP** en un clic,
y toda su API (≈400 acciones) queda disponible con los permisos del usuario.

## Para el usuario

Configuración › **Conectar con IA** (`/settings/ai`):

- **Conectar con Claude / ChatGPT**: copia la URL del servidor MCP (`<APP_URL>/api/mcp`) y abre
  la pantalla de conectores del asistente. Al pulsar «Conectar» en el asistente, este descubre
  OAuth solo, el usuario entra en el ERP, elige **empresa** y **nivel de acceso** («Solo
  consultar» o «Consultar y gestionar») y pulsa «Permitir».
- **Claude Code / Desktop**: `claude mcp add --transport http erp <APP_URL>/api/mcp`.
- **Token personal** (clientes sin OAuth: Cursor, scripts): 90 días, mismo modelo de acceso.
- **Conexiones activas**: lista y «Desconectar» (también se revocan al cambiar la contraseña).

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Descubrimiento OAuth (RFC 8414 / 9728) | `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource[/api/mcp]` |
| Registro dinámico (RFC 7591), sin tabla | `POST /api/oauth/register` (el `client_id` es un documento firmado) |
| Consentimiento | `/oauth/authorize` + `POST /api/oauth/authorize` |
| Token (PKCE S256, refresco con rotación) / revocación | `POST /api/oauth/token`, `POST /api/oauth/revoke` |
| Servidor MCP (Streamable HTTP sin estado) | `POST /api/mcp` |
| Catálogo de la API | `src/server/mcp/api-catalog.generated.json` (`npm run api:catalog`) |
| OpenAPI 3.1 | `GET /api/openapi` |

- El **token de acceso es una sesión real del usuario** (tabla `session`, `userAgent`
  `oauth:<grant>:<scope>:<empresa>:<app>`) firmada con la empresa y el nivel de acceso
  (`AuthGrant` en `src/lib/auth.ts`). Por eso **toda la API** funciona con él, con los permisos
  de su rol, los módulos activos, los cierres de periodo y la política de seguridad (IPs,
  caducidad) del espacio de trabajo. La empresa activa sale del token, nunca de cookies
  (`src/lib/request-grant.ts`, `active-context.ts`, `tenant.ts`).
- **Solo lectura** se aplica en `src/proxy.ts`: un token `read` no puede usar POST/PUT/PATCH/DELETE
  (salvo hablar con `/api/mcp`, cuyas acciones vuelven a pasar por el proxy).
- **CSRF**: las peticiones con `Authorization: Bearer` están exentas (el navegador no las envía solo).
- Las herramientas MCP llaman a la propia API (`MCP_INTERNAL_ORIGIN`, por defecto
  `http://127.0.0.1:$PORT`) con el token y la IP del usuario.

## Herramientas MCP

- `search` / `fetch`: contrato de ChatGPT (conectores y deep research).
- Uso diario: `erp_contexto`, `erp_panel`, `erp_indicadores`, `erp_obligaciones_fiscales`,
  `erp_calculo_fiscal`, `erp_estados_financieros`, `erp_listar_*`, `erp_crear_cliente`,
  `erp_crear_proveedor`, `erp_crear_factura` (esquemas generados de los zod de la app),
  `erp_emitir_factura`.
- Cualquier acción: `erp_catalogo` → `erp_describir_accion` (ruta, permiso, consulta y esquema
  zod del cuerpo) → `erp_ejecutar_accion`.
- Bloqueadas para la IA: sesión y contraseñas (`/api/auth`), OAuth, el propio MCP, API keys,
  webhooks y formularios públicos.

Al añadir o cambiar rutas de la API: `npm run api:catalog` (un test falla si el catálogo no está al día).

## Límites

- Subida de archivos (multipart: OCR de facturas, adjuntos) no disponible por MCP.
- Las API keys (`ak_…`) siguen limitadas a sus permisos y rutas originales; para la API completa
  usa OAuth o un token personal.

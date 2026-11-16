import { authorizationServerMetadata, corsJson, corsPreflight } from "@/server/oauth/http";

/** RFC 8414: descubrimiento del servidor de autorización (también con sufijo de ruta). */
export function GET(request: Request) {
  return corsJson(authorizationServerMetadata(request));
}

export function OPTIONS() {
  return corsPreflight();
}

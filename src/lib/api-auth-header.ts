export function bearerToken(authorization: string | null) {
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
}

export function hasApiKeyBearerAuthorization(authorization: string | null) {
  return bearerToken(authorization)?.startsWith("ak_") ?? false;
}

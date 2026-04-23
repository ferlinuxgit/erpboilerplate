function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;

  const entry = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`));

  return entry ? decodeURIComponent(entry.split("=")[1]) : null;
}

export function getCsrfHeader(): Record<string, string> {
  const token = readCookie("csrf-token");
  return token ? { "x-csrf-token": token } : {};
}

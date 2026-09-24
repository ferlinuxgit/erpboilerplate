import { AuthForm } from "@/components/auth-form";
import { AuthPageShell } from "@/components/auth-page-shell";
import { safeNextPath, SESSION_EXPIRED_REASON } from "@/lib/auth-client";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; reason?: string | string[] }> }) {
  const query = await searchParams;
  const nextPath = safeNextPath(firstValue(query.next));
  const notice = firstValue(query.reason) === SESSION_EXPIRED_REASON
    ? "Tu sesión ha caducado. Inicia sesión de nuevo para continuar donde lo dejaste."
    : null;

  return (
    <AuthPageShell>
      <AuthForm mode="sign-in" nextPath={nextPath} notice={notice} />
    </AuthPageShell>
  );
}

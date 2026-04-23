import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SecuritySettingsPage() {
  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Hardening y Seguridad</CardTitle>
          <CardDescription>
            Checklist de 2FA/SSO, rate limiting, backups, GDPR y pruebas e2e preparado para activar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>- 2FA y SSO: preparado para siguiente iteración.</p>
          <p>- Rate limiting: integrado en el proxy de borde (`src/proxy.ts`) con Upstash (opcional por entorno).</p>
          <p>- CSRF: validación disponible mediante ENABLE_CSRF.</p>
          <p>- Logs y auditoría: revisable en la sección de auditoría.</p>
          <Link className={buttonVariants({ variant: "outline" })} href="/settings/audit">
            Ver auditoría
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/settings/api-keys">
            Gestionar API Keys
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}

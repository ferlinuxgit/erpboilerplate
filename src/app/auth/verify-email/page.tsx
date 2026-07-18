import { Suspense } from "react";

import { AuthPageShell } from "@/components/auth-page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { VerifyEmailForm } from "./verify-email-form";

export default function VerifyEmailPage() {
  return <AuthPageShell>
    <Card className="mx-auto w-full max-w-md">
      <CardHeader><CardTitle>Verifica tu correo</CardTitle></CardHeader>
      <CardContent><Suspense fallback={<p>Preparando verificación...</p>}><VerifyEmailForm /></Suspense></CardContent>
    </Card>
  </AuthPageShell>;
}

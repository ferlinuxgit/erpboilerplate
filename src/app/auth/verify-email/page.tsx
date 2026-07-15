import { Suspense } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { VerifyEmailForm } from "./verify-email-form";

export default function VerifyEmailPage() {
  return <main className="container mx-auto flex min-h-[80vh] items-center px-4 py-10">
    <Card className="mx-auto w-full max-w-md">
      <CardHeader><CardTitle>Verifica tu correo</CardTitle></CardHeader>
      <CardContent><Suspense fallback={<p>Preparando verificación...</p>}><VerifyEmailForm /></Suspense></CardContent>
    </Card>
  </main>;
}

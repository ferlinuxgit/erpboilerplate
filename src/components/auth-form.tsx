"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authSignInSchema, authSignUpSchema } from "@/server/schemas/forms";

type AuthMode = "sign-in" | "sign-up";

const modeContent: Record<AuthMode, { title: string; description: string; cta: string; switchLabel: string; switchHref: string }> = {
  "sign-in": {
    title: "Iniciar sesión",
    description: "Accede a tu panel ERP SaaS.",
    cta: "Entrar",
    switchLabel: "¿No tienes cuenta? Crear una cuenta",
    switchHref: "/auth/register",
  },
  "sign-up": {
    title: "Crear cuenta",
    description: "Empieza a configurar tu ERP SaaS.",
    cta: "Registrarme",
    switchLabel: "¿Ya tienes cuenta? Iniciar sesión",
    switchHref: "/auth/login",
  },
};

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [verifyingTwoFactor, setVerifyingTwoFactor] = useState(false);
  type AuthPayload = {
    name?: string;
    email: string;
    password: string;
  };
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AuthPayload>({
    resolver: zodResolver(
      authSignInSchema.extend({
        name: authSignUpSchema.shape.name.optional(),
      }),
    ),
    defaultValues: {
      email: "",
      password: "",
      ...(mode === "sign-up" ? { name: "" } : {}),
    },
  });

  const content = modeContent[mode];

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (mode === "sign-up") {
        const parsed = authSignUpSchema.parse(values);
        const { data, error: signUpError } = await authClient.signUp.email({
          email: parsed.email,
          password: parsed.password,
          name: parsed.name,
        });

        if (signUpError) {
          throw new Error(signUpError.message ?? "No se pudo completar el registro.");
        }

        const requiresVerification = Boolean((data as { requiresEmailVerification?: boolean } | null)?.requiresEmailVerification);
        toast.success(requiresVerification ? "Cuenta creada. Revisa tu correo para verificarla." : "Cuenta creada correctamente.");
        router.push("/auth/login");
        return;
      }

      const parsed = authSignInSchema.parse(values);
      const { data, error: signInError } = await authClient.signIn.email({
        email: parsed.email,
        password: parsed.password,
      });

      if (signInError) {
        throw new Error(signInError.message ?? "No se pudo iniciar sesión.");
      }
      const challenge = data as { requiresTwoFactor?: boolean; challengeId?: string } | null;
      if (challenge?.requiresTwoFactor && challenge.challengeId) {
        setTwoFactorChallenge(challenge.challengeId);
        toast.success("Te hemos enviado un código de verificación por email.");
        return;
      }

      toast.success("Sesión iniciada correctamente.");
      router.push("/dashboard");
      router.refresh();
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : "Ha ocurrido un error inesperado.";
      toast.error(message);
    }
  });

  async function verifyTwoFactor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!twoFactorChallenge) return;
    setVerifyingTwoFactor(true);
    const { error } = await authClient.verifyTwoFactor({ challengeId: twoFactorChallenge, code: twoFactorCode });
    setVerifyingTwoFactor(false);
    if (error) return toast.error(error.message ?? "No se pudo verificar el código.");
    toast.success("Sesión iniciada correctamente.");
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle aria-level={1} role="heading">
          {content.title}
        </CardTitle>
        <CardDescription>{content.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {twoFactorChallenge ? (
          <form className="space-y-4" onSubmit={(event) => void verifyTwoFactor(event)}>
            <div className="space-y-2">
              <Label htmlFor="two-factor-code">Código de verificación</Label>
              <Input id="two-factor-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value.replace(/\D/g, ""))} />
              <p className="text-sm text-muted-foreground">Introduce el código de seis dígitos enviado a tu correo.</p>
            </div>
            <Button className="w-full" disabled={verifyingTwoFactor || twoFactorCode.length !== 6} type="submit">{verifyingTwoFactor ? "Verificando..." : "Verificar y entrar"}</Button>
          </form>
        ) : (
        <form className="space-y-4" onSubmit={onSubmit}>
          {mode === "sign-up" ? (
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                autoComplete="name"
                minLength={2}
                required
                {...register("name")}
              />
              {errors.name ? <p className="text-sm text-red-600">{errors.name.message}</p> : null}
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              autoComplete="email"
              required
              type="email"
              {...register("email")}
            />
            {errors.email ? <p className="text-sm text-red-600">{errors.email.message}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              minLength={8}
              required
              type="password"
              {...register("password")}
            />
            {errors.password ? <p className="text-sm text-red-600">{errors.password.message}</p> : null}
          </div>
          <Button className="w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Procesando..." : content.cta}
          </Button>
          <Link className="block text-center text-sm text-muted-foreground underline-offset-4 hover:underline" href={content.switchHref}>
            {content.switchLabel}
          </Link>
        </form>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { authClient, safeNextPath } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authSignInSchema, authSignUpSchema } from "@/server/schemas/forms";

type AuthMode = "sign-in" | "sign-up";

const modeContent: Record<AuthMode, { title: string; description: string; cta: string; pending: string; switchLabel: string; switchHref: string }> = {
  "sign-in": {
    title: "Iniciar sesión",
    description: "Accede al espacio operativo de tu empresa.",
    cta: "Entrar",
    pending: "Entrando…",
    switchLabel: "¿No tienes cuenta? Crear una cuenta",
    switchHref: "/auth/register",
  },
  "sign-up": {
    title: "Crear cuenta",
    description: "Crea tu espacio de trabajo y configura la empresa.",
    cta: "Registrarme",
    pending: "Creando cuenta…",
    switchLabel: "¿Ya tienes cuenta? Iniciar sesión",
    switchHref: "/auth/login",
  },
};

type AuthPayload = {
  name?: string;
  email: string;
  password: string;
};

export function AuthForm({ mode, nextPath = null, notice = null }: { mode: AuthMode; nextPath?: string | null; notice?: string | null }) {
  const router = useRouter();
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [verifyingTwoFactor, setVerifyingTwoFactor] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
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
  // Revalidamos en cliente: nunca redirigimos fuera de la aplicación.
  const destination = safeNextPath(nextPath) ?? "/dashboard";
  const switchHref = mode === "sign-up" && nextPath ? `${content.switchHref}?next=${encodeURIComponent(nextPath)}` : content.switchHref;

  function goToDestination() {
    router.push(destination);
    router.refresh();
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (mode === "sign-up") {
      const parsed = authSignUpSchema.parse(values);
      const { data, error: signUpError } = await authClient.signUp.email({
        email: parsed.email,
        password: parsed.password,
        name: parsed.name,
      });

      if (signUpError) {
        setFormError(signUpError.message ?? "No se pudo completar el registro.");
        return;
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
      setFormError(signInError.message ?? "No se pudo iniciar sesión.");
      return;
    }
    const challenge = data as { requiresTwoFactor?: boolean; challengeId?: string } | null;
    if (challenge?.requiresTwoFactor && challenge.challengeId) {
      setTwoFactorChallenge(challenge.challengeId);
      toast.success("Te hemos enviado un código de verificación por email.");
      return;
    }

    toast.success("Sesión iniciada correctamente.");
    goToDestination();
  });

  async function verifyTwoFactor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!twoFactorChallenge) return;
    setFormError(null);
    setVerifyingTwoFactor(true);
    const { error } = await authClient.verifyTwoFactor({ challengeId: twoFactorChallenge, code: twoFactorCode });
    if (error) {
      setVerifyingTwoFactor(false);
      setFormError(error.message ?? "No se pudo verificar el código.");
      return;
    }
    toast.success("Sesión iniciada correctamente.");
    goToDestination();
  }

  const errorBanner = formError ? (
    <p className="border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive" id="auth-form-error" role="alert">
      {formError}
    </p>
  ) : null;

  return (
    <Card className="w-full border-0 bg-transparent shadow-none">
      <CardHeader>
        <CardTitle aria-level={1} role="heading">
          {content.title}
        </CardTitle>
        <CardDescription>{content.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice ? (
          <p className="border border-window-dark-shadow bg-window-highlight px-3 py-2 text-sm text-window-text" role="status">
            {notice}
          </p>
        ) : null}
        {twoFactorChallenge ? (
          <form aria-describedby={formError ? "auth-form-error" : undefined} className="space-y-4" onSubmit={(event) => void verifyTwoFactor(event)}>
            {errorBanner}
            <div className="space-y-2">
              <Label htmlFor="two-factor-code">Código de verificación</Label>
              <Input
                aria-describedby="two-factor-code-hint"
                autoComplete="one-time-code"
                autoFocus
                id="two-factor-code"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setTwoFactorCode(event.target.value.replace(/\D/g, ""))}
                pattern="[0-9]{6}"
                required
                value={twoFactorCode}
              />
              <p className="text-sm text-muted-foreground" id="two-factor-code-hint">Introduce el código de seis dígitos enviado a tu correo.</p>
            </div>
            <Button aria-busy={verifyingTwoFactor || undefined} className="w-full" disabled={verifyingTwoFactor || twoFactorCode.length !== 6} type="submit">
              {verifyingTwoFactor ? "Verificando…" : "Verificar y entrar"}
            </Button>
          </form>
        ) : (
          <form aria-describedby={formError ? "auth-form-error" : undefined} className="space-y-4" noValidate onSubmit={onSubmit}>
            {errorBanner}
            {mode === "sign-up" ? (
              <div className="space-y-2">
                <Label htmlFor="name">Nombre</Label>
                <Input
                  aria-describedby={errors.name ? "name-error" : undefined}
                  aria-invalid={errors.name ? true : undefined}
                  autoComplete="name"
                  autoFocus
                  id="name"
                  minLength={2}
                  required
                  {...register("name")}
                />
                {errors.name ? <p className="text-sm text-destructive" id="name-error">{errors.name.message}</p> : null}
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                aria-describedby={errors.email ? "email-error" : undefined}
                aria-invalid={errors.email ? true : undefined}
                autoCapitalize="none"
                autoComplete={mode === "sign-up" ? "email" : "username"}
                autoFocus={mode === "sign-in"}
                id="email"
                inputMode="email"
                required
                spellCheck={false}
                type="email"
                {...register("email")}
              />
              {errors.email ? <p className="text-sm text-destructive" id="email-error">{errors.email.message}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <div className="relative">
                <Input
                  aria-describedby={errors.password ? "password-error" : undefined}
                  aria-invalid={errors.password ? true : undefined}
                  autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                  className="pr-9"
                  id="password"
                  minLength={8}
                  required
                  type={showPassword ? "text" : "password"}
                  {...register("password")}
                />
                <button
                  aria-controls="password"
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 grid w-8 place-items-center text-window-muted hover:text-window-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  onClick={() => setShowPassword((value) => !value)}
                  title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  type="button"
                >
                  {showPassword ? <EyeSlash aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </div>
              {errors.password ? <p className="text-sm text-destructive" id="password-error">{errors.password.message}</p> : null}
            </div>
            <Button aria-busy={isSubmitting || undefined} className="w-full" disabled={isSubmitting} type="submit">
              {isSubmitting ? content.pending : content.cta}
            </Button>
            <Link className="block text-center text-sm text-muted-foreground underline-offset-4 hover:underline" href={switchHref}>
              {content.switchLabel}
            </Link>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

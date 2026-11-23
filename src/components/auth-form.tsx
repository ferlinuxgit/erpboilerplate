"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { authClient, EMAIL_NOT_VERIFIED_CODE, loginPathWithNext, redirectTargetFrom, registerPathWithNext, safeNextPath } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CaptchaWidget } from "@/components/captcha-widget";
import { authSignInSchema, authSignUpSchema } from "@/server/schemas/forms";

type AuthMode = "sign-in" | "sign-up";

const modeContent: Record<AuthMode, { title: string; description: string; cta: string; pending: string; switchLabel: string }> = {
  "sign-in": {
    title: "Iniciar sesión",
    description: "Accede a la gestión de tu empresa.",
    cta: "Entrar",
    pending: "Entrando…",
    switchLabel: "¿No tienes cuenta? Crear una cuenta",
  },
  "sign-up": {
    title: "Crear cuenta",
    description: "Gratis y en un minuto. Después te guiamos para dejar tu empresa lista para facturar.",
    cta: "Crear mi cuenta",
    pending: "Creando cuenta…",
    switchLabel: "¿Ya tienes cuenta? Iniciar sesión",
  },
};

type AuthPayload = {
  name?: string;
  email: string;
  password: string;
};

export function AuthForm({ captchaSiteKey = null, mode, nextPath = null, notice = null }: { captchaSiteKey?: string | null; mode: AuthMode; nextPath?: string | null; notice?: string | null }) {
  const router = useRouter();
  // Verificación anti-bots en el alta (si el servidor tiene Turnstile configurado).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const needsCaptcha = mode === "sign-up" && Boolean(captchaSiteKey);
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  // «email»: código enviado al correo; «totp»: app de autenticación (o un código de recuperación).
  const [twoFactorMethod, setTwoFactorMethod] = useState<"email" | "totp">("email");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [verifyingTwoFactor, setVerifyingTwoFactor] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Email pendiente de verificar: tras registrarse (pantalla "Revisa tu correo") o al intentar entrar.
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [checkEmailScreen, setCheckEmailScreen] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const [resendMessage, setResendMessage] = useState<string | null>(null);
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
  const safeNext = safeNextPath(nextPath);
  // La ruta de retorno (p. ej. una invitación) se conserva al cambiar entre login y registro.
  const switchHref = mode === "sign-in" ? registerPathWithNext(safeNext) : loginPathWithNext(safeNext);

  function goToDestination(data: unknown) {
    router.push(redirectTargetFrom(data, safeNext ?? "/dashboard"));
    router.refresh();
  }

  async function resendVerification() {
    if (!pendingVerificationEmail) return;
    setResendState("sending");
    setResendMessage(null);
    const { data, error } = await authClient.resendVerification({ email: pendingVerificationEmail, next: safeNext });
    if (error) {
      setResendState("idle");
      setResendMessage(error.message ?? "No se pudo reenviar el correo.");
      return;
    }
    setResendState("sent");
    setResendMessage((data as { message?: string } | null)?.message ?? "Te hemos enviado un enlace nuevo.");
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (mode === "sign-up") {
      const parsed = authSignUpSchema.parse(values);
      const { data, error: signUpError } = await authClient.signUp.email({
        email: parsed.email,
        password: parsed.password,
        name: parsed.name,
        next: safeNext,
        captchaToken,
      });

      if (signUpError) {
        setFormError(signUpError.message ?? "No se pudo completar el registro.");
        return;
      }

      const requiresVerification = Boolean((data as { requiresEmailVerification?: boolean } | null)?.requiresEmailVerification);
      if (requiresVerification) {
        setPendingVerificationEmail(parsed.email);
        setCheckEmailScreen(true);
        return;
      }
      // El servidor ya ha abierto la sesión: entramos directamente.
      toast.success("Cuenta creada. ¡Bienvenido!");
      goToDestination(data);
      return;
    }

    const parsed = authSignInSchema.parse(values);
    const { data, error: signInError } = await authClient.signIn.email({
      email: parsed.email,
      password: parsed.password,
      next: safeNext,
      remember,
    });

    if (signInError) {
      setFormError(signInError.message ?? "No se pudo iniciar sesión.");
      setPendingVerificationEmail(signInError.code === EMAIL_NOT_VERIFIED_CODE ? parsed.email : null);
      setResendState("idle");
      setResendMessage(null);
      return;
    }
    const challenge = data as { requiresTwoFactor?: boolean; challengeId?: string; method?: string } | null;
    if (challenge?.requiresTwoFactor && challenge.challengeId) {
      setTwoFactorChallenge(challenge.challengeId);
      setTwoFactorMethod(challenge.method === "totp" ? "totp" : "email");
      setUseRecoveryCode(false);
      setTwoFactorCode("");
      if (challenge.method !== "totp") toast.success("Te hemos enviado un código de verificación por email.");
      return;
    }

    toast.success("Sesión iniciada correctamente.");
    goToDestination(data);
  });

  async function verifyTwoFactor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!twoFactorChallenge) return;
    setFormError(null);
    setVerifyingTwoFactor(true);
    const { data, error } = await authClient.verifyTwoFactor({ challengeId: twoFactorChallenge, code: twoFactorCode, next: safeNext, remember });
    if (error) {
      setVerifyingTwoFactor(false);
      setFormError(error.message ?? "No se pudo verificar el código.");
      setTwoFactorCode("");
      // Reto agotado o caducado: hay que volver a iniciar sesión.
      if (twoFactorMethod === "email" || /inicia sesión de nuevo/i.test(error.message ?? "")) setTwoFactorChallenge(null);
      return;
    }
    toast.success("Sesión iniciada correctamente.");
    goToDestination(data);
  }

  const resendControls = pendingVerificationEmail ? (
    <div className="space-y-2">
      <Button
        aria-busy={resendState === "sending" || undefined}
        className="w-full"
        disabled={resendState !== "idle"}
        onClick={() => void resendVerification()}
        type="button"
        variant="outline"
      >
        {resendState === "sending" ? "Enviando…" : resendState === "sent" ? "Enlace enviado" : "Reenviar el correo de verificación"}
      </Button>
      {resendMessage ? <p className="text-sm text-muted-foreground" role="status">{resendMessage}</p> : null}
    </div>
  ) : null;

  const errorBanner = formError ? (
    <div className="space-y-2">
      <p className="border border-destructive bg-destructive/10 px-3 py-2 text-sm text-danger-text" id="auth-form-error" role="alert">
        {formError}
      </p>
      {mode === "sign-in" ? resendControls : null}
    </div>
  ) : null;

  if (checkEmailScreen && pendingVerificationEmail) {
    return (
      <Card className="w-full border-0 bg-transparent shadow-none">
        <CardHeader>
          <CardTitle aria-level={1} className="text-lg leading-tight sm:text-xl" role="heading">Revisa tu correo</CardTitle>
          <CardDescription>
            Hemos enviado un enlace de confirmación a <strong>{pendingVerificationEmail}</strong>. Ábrelo para activar la cuenta; caduca en 24 horas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">¿No lo encuentras? Revisa la carpeta de spam o pide otro enlace.</p>
          {resendControls}
          <Link className="block py-2 text-center text-sm font-bold text-link underline-offset-2 hover:underline" href={loginPathWithNext(safeNext)}>
            Ya lo he confirmado: iniciar sesión
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full border-0 bg-transparent shadow-none">
      <CardHeader>
        <CardTitle aria-level={1} className="text-lg leading-tight sm:text-xl" role="heading">
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
              <Label htmlFor="two-factor-code">{useRecoveryCode ? "Código de recuperación" : "Código de verificación"}</Label>
              {useRecoveryCode ? (
                <Input
                  aria-describedby="two-factor-code-hint"
                  autoComplete="off"
                  autoFocus
                  id="two-factor-code"
                  maxLength={11}
                  onChange={(event) => setTwoFactorCode(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
                  required
                  value={twoFactorCode}
                />
              ) : (
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
              )}
              <p className="text-sm text-muted-foreground" id="two-factor-code-hint">
                {useRecoveryCode
                  ? "Introduce uno de los códigos de recuperación que guardaste (cada uno sirve una sola vez)."
                  : twoFactorMethod === "totp"
                    ? "Introduce el código de seis dígitos de tu app de autenticación."
                    : "Introduce el código de seis dígitos enviado a tu correo."}
              </p>
            </div>
            <Button
              aria-busy={verifyingTwoFactor || undefined}
              className="w-full"
              disabled={verifyingTwoFactor || (useRecoveryCode ? twoFactorCode.replace(/-/g, "").length !== 10 : twoFactorCode.length !== 6)}
              type="submit"
            >
              {verifyingTwoFactor ? "Verificando…" : "Verificar y entrar"}
            </Button>
            {twoFactorMethod === "totp" ? (
              <Button
                className="w-full"
                onClick={() => {
                  setUseRecoveryCode((value) => !value);
                  setTwoFactorCode("");
                  setFormError(null);
                }}
                type="button"
                variant="outline"
              >
                {useRecoveryCode ? "Usar el código de la app" : "No tengo el móvil: usar un código de recuperación"}
              </Button>
            ) : null}
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
                {errors.name ? <p className="text-sm text-danger-text" id="name-error">{errors.name.message}</p> : null}
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
              {errors.email ? <p className="text-sm text-danger-text" id="email-error">{errors.email.message}</p> : null}
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="password">Contraseña</Label>
                {mode === "sign-in" ? (
                  <Link className="text-sm text-link underline underline-offset-2" href="/auth/forgot-password">
                    ¿Olvidaste tu contraseña?
                  </Link>
                ) : null}
              </div>
              <div className="relative">
                <Input
                  aria-describedby={errors.password ? "password-error" : undefined}
                  aria-invalid={errors.password ? true : undefined}
                  autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                  className="pr-9 pointer-coarse:pr-12"
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
                  className="absolute inset-y-0 right-0 grid w-8 place-items-center pointer-coarse:w-11 text-window-muted hover:text-window-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  onClick={() => setShowPassword((value) => !value)}
                  title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  type="button"
                >
                  {showPassword ? <EyeSlash aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </div>
              {errors.password ? <p className="text-sm text-danger-text" id="password-error">{errors.password.message}</p> : null}
              {mode === "sign-up" && !errors.password ? <p className="text-sm text-muted-foreground">Mínimo 8 caracteres.</p> : null}
            </div>
            {mode === "sign-in" ? (
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm" htmlFor="remember-session">
                  <input checked={remember} id="remember-session" onChange={(event) => setRemember(event.target.checked)} type="checkbox" />
                  Mantener la sesión iniciada
                </label>
                <p className="text-xs text-muted-foreground">Durante 30 días en este dispositivo. No lo marques en un ordenador compartido.</p>
              </div>
            ) : null}
            {needsCaptcha ? <CaptchaWidget onToken={setCaptchaToken} siteKey={captchaSiteKey!} /> : null}
            <Button aria-busy={isSubmitting || undefined} className="w-full" disabled={isSubmitting} type="submit">
              {isSubmitting ? content.pending : content.cta}
            </Button>
            <Link className="block py-2 text-center text-sm font-bold text-link underline-offset-2 hover:underline" href={switchHref}>
              {content.switchLabel}
            </Link>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
        const { error: signUpError } = await authClient.signUp.email({
          email: parsed.email,
          password: parsed.password,
          name: parsed.name,
        });

        if (signUpError) {
          throw new Error(signUpError.message ?? "No se pudo completar el registro.");
        }

        toast.success("Cuenta creada correctamente.");
        router.push("/auth/login");
        return;
      }

      const parsed = authSignInSchema.parse(values);
      const { error: signInError } = await authClient.signIn.email({
        email: parsed.email,
        password: parsed.password,
      });

      if (signInError) {
        throw new Error(signInError.message ?? "No se pudo iniciar sesión.");
      }

      toast.success("Sesión iniciada correctamente.");
      router.push("/dashboard");
      router.refresh();
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : "Ha ocurrido un error inesperado.";
      toast.error(message);
    }
  });

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle aria-level={1} role="heading">
          {content.title}
        </CardTitle>
        <CardDescription>{content.description}</CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

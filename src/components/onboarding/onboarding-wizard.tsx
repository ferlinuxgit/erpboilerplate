"use client";

import Link from "next/link";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { getCsrfHeader } from "@/lib/csrf-client";
import { Button, buttonVariants } from "@/components/ui/button";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const onboardingSchema = z.object({
  legalName: z.string().trim().optional().or(z.literal("")),
  vatNumber: z.string().trim().optional().or(z.literal("")),
  defaultSeriesPrefix: z.string().trim().max(20, "El prefijo no puede superar 20 caracteres.").optional().or(z.literal("")),
  inviteEmail: z.string().trim().email("Indica un email válido, por ejemplo persona@empresa.com, o deja el campo vacío.").optional().or(z.literal("")),
});

type OnboardingPayload = z.infer<typeof onboardingSchema>;

const defaultValues: OnboardingPayload = {
  legalName: "",
  vatNumber: "",
  defaultSeriesPrefix: "FA",
  inviteEmail: "",
};

const steps = [
  { title: "Empresa", optional: false, description: "Nombre legal con el que emitirás facturas." },
  { title: "Fiscalidad", optional: true, description: "Identificación fiscal de la empresa." },
  { title: "Series", optional: true, description: "Prefijo de la numeración de facturas." },
  { title: "Plan contable", optional: false, description: "Cuentas y diarios base, sin tener que configurar nada." },
  { title: "Invitar equipo", optional: true, description: "Invita a una persona para trabajar contigo." },
] as const;

/** Fields reset when the user skips an optional step. */
const stepFields: Partial<Record<number, keyof OnboardingPayload>> = {
  1: "vatNumber",
  2: "defaultSeriesPrefix",
  4: "inviteEmail",
};

export function OnboardingWizard() {
  const [stepIndex, setStepIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const isFinalStep = stepIndex === steps.length - 1;
  const currentStep = steps[stepIndex];
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingPayload>({
    resolver: zodResolver(onboardingSchema),
    defaultValues,
  });

  const goToStep = (index: number) => setStepIndex(Math.min(steps.length - 1, Math.max(0, index)));

  const finish = handleSubmit(
    async (values) => {
      setFormError(null);
      try {
        const response = await fetch("/api/onboarding/seed", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify(values),
        });

        if (!response.ok) throw new Error(await readApiError(response, "No se pudo completar el onboarding."));

        setIsComplete(true);
        toast.success("Onboarding completado. Se han aplicado los datos base.");
      } catch (error) {
        const message = errorMessage(error, "No se pudo completar el onboarding.");
        setFormError(message);
        toast.error(message);
      }
    },
    (fieldErrors) => {
      const firstInvalidStep = fieldErrors.legalName ? 0 : fieldErrors.vatNumber ? 1 : fieldErrors.defaultSeriesPrefix ? 2 : 4;
      setStepIndex(firstInvalidStep);
      toast.error("Revisa el dato marcado antes de finalizar.");
    },
  );

  const skipStep = (form: HTMLFormElement | null) => {
    const field = stepFields[stepIndex];
    if (field) setValue(field, defaultValues[field] ?? "", { shouldValidate: false });
    if (isFinalStep) form?.requestSubmit();
    else goToStep(stepIndex + 1);
  };

  if (isComplete) {
    return (
      <section className="space-y-3 border border-success bg-success/10 p-3 text-foreground shadow-[inset_1px_1px_0_var(--window-highlight)]" role="status">
        <div>
          <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.04em]">Configuración inicial lista</p>
          <h2 className="mt-1 font-mono text-lg font-bold">Onboarding completado</h2>
          <p className="mt-1 text-xs">
            Hemos aplicado la configuración base. El siguiente paso recomendado es crear tu primer cliente para empezar a facturar y ver datos en el dashboard.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className={buttonVariants()} href="/customers/new">
            Crear primer cliente
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver al dashboard
          </Link>
        </div>
      </section>
    );
  }

  return (
    <form
      aria-labelledby="onboarding-step-title"
      className="space-y-3"
      noValidate
      onSubmit={(event) => {
        // Enter on an intermediate step moves forward instead of finishing.
        if (!isFinalStep) {
          event.preventDefault();
          goToStep(stepIndex + 1);
          return;
        }
        void finish(event);
      }}
    >
      <nav aria-label="Pasos de onboarding">
        <ol className="grid gap-1 sm:grid-cols-5">
          {steps.map((step, index) => {
            const isCurrent = index === stepIndex;
            const isDone = index < stepIndex;
            return (
              <li key={step.title}>
                <button
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "flex h-full w-full flex-col items-start gap-0.5 border px-2 py-1.5 text-left font-mono text-xs shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                    isCurrent
                      ? "border-window-dark-shadow bg-primary text-primary-foreground"
                      : isDone
                        ? "border-success/70 bg-success/10 text-foreground hover:bg-window-highlight"
                        : "border-window-dark-shadow bg-window-panel text-foreground hover:bg-window-highlight",
                  )}
                  onClick={() => goToStep(index)}
                  type="button"
                >
                  <span className="font-bold">
                    {index + 1}. {step.title}
                    {isDone ? <span className="sr-only"> (revisado)</span> : null}
                  </span>
                  {step.optional ? <span className={cn("text-[0.62rem] uppercase", isCurrent ? "text-primary-foreground" : "text-muted-foreground")}>Opcional</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="space-y-3 border border-window-dark-shadow bg-window-panel p-3 shadow-[inset_1px_1px_0_var(--window-highlight)]">
        <div className="space-y-0.5 border-b border-window-shadow pb-2">
          <p className="font-mono text-xs text-muted-foreground" aria-live="polite">
            Paso {stepIndex + 1} de {steps.length}: {currentStep.title}
          </p>
          <h3 className="font-mono text-sm font-bold" id="onboarding-step-title">
            {currentStep.title}
            {currentStep.optional ? <span className="ml-1 font-normal text-muted-foreground">(opcional)</span> : null}
          </h3>
          <p className="text-xs text-muted-foreground">{currentStep.description}</p>
        </div>

        {stepIndex === 0 ? (
          <AccessibleField
            error={errors.legalName?.message}
            helperText="Aparecerá en tus facturas. Podrás cambiarla después en Ajustes > Empresa."
            id="legalName"
            label="Razón social"
          >
            <Input id="legalName" autoComplete="organization" autoFocus placeholder="Empresa Demo S.L." {...register("legalName")} />
          </AccessibleField>
        ) : null}

        {stepIndex === 1 ? (
          <AccessibleField
            error={errors.vatNumber?.message}
            helperText="CIF de la sociedad o NIF si eres autónomo. Si aún no lo tienes a mano, omite este paso."
            id="vatNumber"
            label="NIF/CIF"
          >
            <Input id="vatNumber" autoCapitalize="characters" autoFocus placeholder="B12345678" {...register("vatNumber")} />
          </AccessibleField>
        ) : null}

        {stepIndex === 2 ? (
          <AccessibleField
            error={errors.defaultSeriesPrefix?.message}
            helperText="Letras al inicio del número de factura (por ejemplo FA → FA2026-000001). Si no sabes qué poner, deja FA."
            id="defaultSeriesPrefix"
            label="Prefijo de serie principal"
          >
            <Input id="defaultSeriesPrefix" autoFocus className="font-mono" placeholder="FA" {...register("defaultSeriesPrefix")} />
          </AccessibleField>
        ) : null}

        {stepIndex === 3 ? (
          <p className="border border-dashed border-window-dark-shadow bg-card p-3 text-xs text-muted-foreground">
            Se aplicará automáticamente la plantilla contable general del país de la empresa. No tienes que hacer nada: pulsa Siguiente para continuar.
          </p>
        ) : null}

        {stepIndex === 4 ? (
          <AccessibleField
            error={errors.inviteEmail?.message}
            helperText="Opcional. Le enviaremos una invitación; puedes invitar a más personas después desde Ajustes > Equipo."
            id="inviteEmail"
            label="Email del primer miembro a invitar"
          >
            <Input id="inviteEmail" autoComplete="email" autoFocus inputMode="email" placeholder="persona@empresa.com" type="email" {...register("inviteEmail")} />
          </AccessibleField>
        ) : null}
      </div>

      <FormErrorMessage>{formError}</FormErrorMessage>

      <div className="flex flex-wrap items-center gap-2 border-t border-window-shadow pt-3">
        <Button disabled={stepIndex === 0 || isSubmitting} onClick={() => goToStep(stepIndex - 1)} type="button" variant="outline">
          Anterior
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          {currentStep.optional ? (
            <Button
              disabled={isSubmitting}
              onClick={(event) => skipStep(event.currentTarget.form)}
              type="button"
              variant="ghost"
            >
              Omitir este paso
            </Button>
          ) : null}
          {!isFinalStep ? (
            <Button onClick={() => goToStep(stepIndex + 1)} type="button">
              Siguiente
            </Button>
          ) : null}
          {isFinalStep ? (
            <SubmitButton pending={isSubmitting} pendingLabel="Aplicando configuración…">
              Finalizar onboarding
            </SubmitButton>
          ) : null}
        </div>
      </div>
    </form>
  );
}

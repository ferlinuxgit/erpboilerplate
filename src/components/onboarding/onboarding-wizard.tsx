"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { getCsrfHeader } from "@/lib/csrf-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const onboardingSchema = z.object({
  legalName: z.string().trim().optional().or(z.literal("")),
  vatNumber: z.string().trim().optional().or(z.literal("")),
  defaultSeriesPrefix: z.string().trim().optional().or(z.literal("")),
  inviteEmail: z.string().trim().email("Debes indicar un email válido.").optional().or(z.literal("")),
});

type OnboardingPayload = z.infer<typeof onboardingSchema>;

const steps = [
  "Empresa",
  "Fiscalidad",
  "Series",
  "Plan contable",
  "Invitar equipo",
] as const;

export function OnboardingWizard() {
  const [stepIndex, setStepIndex] = useState(0);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingPayload>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      legalName: "",
      vatNumber: "",
      defaultSeriesPrefix: "FAC-",
      inviteEmail: "",
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit(async (values) => {
        const response = await fetch("/api/onboarding/seed", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify(values),
        });

        if (!response.ok) {
          const payload = (await response.json()) as { message?: string };
          toast.error(payload.message ?? "No se pudo completar el onboarding.");
          return;
        }

        toast.success("Onboarding completado. Se han aplicado los seeds base.");
      })}
    >
      <div className="flex flex-wrap gap-2">
        {steps.map((step, index) => (
          <button
            className={`rounded-md border px-3 py-1 text-xs ${index === stepIndex ? "bg-primary text-primary-foreground" : "bg-background"}`}
            key={step}
            onClick={() => setStepIndex(index)}
            type="button"
          >
            {index + 1}. {step}
          </button>
        ))}
      </div>

      {stepIndex === 0 ? (
        <div className="space-y-2">
          <Label htmlFor="legalName">Razón social</Label>
          <Input id="legalName" placeholder="Empresa Demo S.L." {...register("legalName")} />
          {errors.legalName ? <p className="text-sm text-red-600">{errors.legalName.message}</p> : null}
        </div>
      ) : null}

      {stepIndex === 1 ? (
        <div className="space-y-2">
          <Label htmlFor="vatNumber">NIF/CIF</Label>
          <Input id="vatNumber" placeholder="B12345678" {...register("vatNumber")} />
          {errors.vatNumber ? <p className="text-sm text-red-600">{errors.vatNumber.message}</p> : null}
        </div>
      ) : null}

      {stepIndex === 2 ? (
        <div className="space-y-2">
          <Label htmlFor="defaultSeriesPrefix">Prefijo de serie principal</Label>
          <Input id="defaultSeriesPrefix" placeholder="FAC-" {...register("defaultSeriesPrefix")} />
        </div>
      ) : null}

      {stepIndex === 3 ? (
        <div className="rounded-md border p-3 text-sm text-muted-foreground">
          Se aplicará automáticamente el plan contable Pyme ES y diarios estándar.
        </div>
      ) : null}

      {stepIndex === 4 ? (
        <div className="space-y-2">
          <Label htmlFor="inviteEmail">Email del primer miembro a invitar (opcional)</Label>
          <Input id="inviteEmail" placeholder="persona@empresa.com" {...register("inviteEmail")} />
          {errors.inviteEmail ? <p className="text-sm text-red-600">{errors.inviteEmail.message}</p> : null}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button
          disabled={stepIndex === 0}
          onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
          type="button"
          variant="outline"
        >
          Anterior
        </Button>
        <Button
          disabled={stepIndex === steps.length - 1}
          onClick={() => setStepIndex((current) => Math.min(steps.length - 1, current + 1))}
          type="button"
          variant="outline"
        >
          Siguiente
        </Button>
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Aplicando..." : "Finalizar onboarding"}
        </Button>
      </div>
    </form>
  );
}

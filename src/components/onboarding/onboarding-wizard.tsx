"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CopyLinkButton } from "@/components/settings/copy-link-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { AccessibleField, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { invalidateActiveContext } from "@/lib/active-context-client";
import { BUSINESS_TYPES, businessTypeDescriptions, businessTypeLabels, type BusinessType } from "@/lib/company-readiness";
import { getCsrfHeader } from "@/lib/csrf-client";
import { onboardingFieldsSchema, onboardingInviteSchema, onboardingStepFields, type OnboardingFields, type OnboardingStepKey } from "@/lib/onboarding";
import { roleDescriptions, type AppRole } from "@/lib/rbac";
import { roleLabels } from "@/lib/status-labels";
import { cn } from "@/lib/utils";

export type OnboardingInitialValues = {
  legalName: string;
  vatNumber: string;
  businessType: BusinessType | "";
  fiscalAddress: string;
  postalCode: string;
  city: string;
  province: string;
  invoicePrefix: string;
  iban: string;
  bankName: string;
};

type FormValues = OnboardingInitialValues & { inviteEmail: string; inviteRole: InviteRole };
type FieldName = keyof FormValues;
type InviteRole = "ACCOUNTANT" | "MEMBER" | "ADMIN" | "VIEWER";

const inviteRoles: InviteRole[] = ["ACCOUNTANT", "MEMBER", "ADMIN", "VIEWER"];

const steps: Array<{ key: OnboardingStepKey; title: string; optional: boolean; description: string }> = [
  { key: "company", title: "Tu empresa", optional: false, description: "Nombre, NIF y qué vendes. Aparecen en tus facturas." },
  { key: "address", title: "Dirección fiscal", optional: false, description: "El domicilio fiscal es obligatorio en toda factura." },
  { key: "billing", title: "Facturación y banco", optional: false, description: "Cómo se numeran tus facturas y dónde cobras." },
  { key: "team", title: "Tu gestor o equipo", optional: true, description: "Invita a tu gestor o a quien te ayude. Puedes hacerlo después." },
];

/** Borrador por empresa: nunca se mezclan datos de dos empresas en el mismo navegador. */
const draftStorageKey = (companyId: string) => `erp-onboarding-draft:${companyId}`;

type CompletionResult = {
  invitation: { email: string; role: string; url: string; emailSent: boolean; emailProblem: string | null } | null;
  invitationError: string | null;
  bankAccountCreated: boolean;
};

function readDraft(key: string): Partial<FormValues> | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as Partial<FormValues> | null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, values: FormValues) {
  try {
    window.localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // Sin almacenamiento local (modo privado): lo guardado en el servidor en cada paso basta.
  }
}

function clearDraft(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ver writeDraft.
  }
}

/** Valida los campos de un paso; devuelve los errores por campo y los valores limpios. */
function validateStep(step: OnboardingStepKey, values: FormValues) {
  const errors: Partial<Record<FieldName, string>> = {};
  const fields = onboardingStepFields[step];
  if (step === "team") {
    if (!values.inviteEmail.trim()) return { errors, data: {} };
    const parsed = onboardingInviteSchema.safeParse({ email: values.inviteEmail, role: values.inviteRole });
    if (!parsed.success) errors.inviteEmail = parsed.error.issues[0]?.message;
    return { errors, data: {} };
  }
  const picked = Object.fromEntries(fields.map((field) => [field, values[field]]));
  const parsed = onboardingFieldsSchema.pick(Object.fromEntries(fields.map((field) => [field, true])) as Partial<Record<keyof OnboardingFields, true>>).safeParse(picked);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as FieldName | undefined;
      if (field && !errors[field]) errors[field] = issue.message;
    }
  }
  return { errors, data: parsed.success ? (parsed.data as Partial<OnboardingFields>) : {} };
}

/** Campos válidos de todos los pasos (para no perder nada al posponer). */
function validPartialValues(values: FormValues) {
  const result: Partial<OnboardingFields> = {};
  for (const [field, schema] of Object.entries(onboardingFieldsSchema.shape) as Array<[keyof OnboardingFields, (typeof onboardingFieldsSchema.shape)[keyof OnboardingFields]]>) {
    const value = values[field];
    if (typeof value !== "string" || !value.trim()) continue;
    const parsed = schema.safeParse(value);
    if (parsed.success) Object.assign(result, { [field]: parsed.data });
  }
  return result;
}

async function patchOnboarding(data: Partial<OnboardingFields>) {
  const response = await fetch("/api/onboarding", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getCsrfHeader() },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(await readApiError(response, "No se pudieron guardar los datos."));
  // El nombre y el tipo de negocio cambian la cabecera y el menú.
  invalidateActiveContext();
}

export function OnboardingWizard({ companyId, initialValues, workspaceName }: { companyId: string; initialValues: OnboardingInitialValues; workspaceName: string }) {
  const router = useRouter();
  const draftKey = draftStorageKey(companyId);
  const [values, setValues] = useState<FormValues>({ ...initialValues, inviteEmail: "", inviteRole: "ACCOUNTANT" });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [pending, setPending] = useState<"step" | "finish" | "later" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<CompletionResult | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const currentStep = steps[stepIndex];
  const isFinalStep = stepIndex === steps.length - 1;

  // Borrador local: si se recarga la página a mitad de un paso no se pierde lo escrito.
  useEffect(() => {
    const draft = readDraft(draftKey);
    if (!draft) return;
    const timer = window.setTimeout(() => setValues((current) => ({ ...current, ...draft })), 0);
    return () => window.clearTimeout(timer);
  }, [draftKey]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepIndex]);

  const setField = (field: FieldName, value: string) => {
    setValues((current) => {
      const next = { ...current, [field]: value };
      writeDraft(draftKey, next);
      return next;
    });
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const inputProps = (field: Exclude<FieldName, "businessType" | "inviteRole">) => ({
    value: values[field],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setField(field, event.target.value),
  });

  async function goNext() {
    const { errors: stepErrors, data } = validateStep(currentStep.key, values);
    setErrors(stepErrors);
    if (Object.values(stepErrors).some(Boolean)) {
      setFormError("Revisa los datos marcados para continuar.");
      return;
    }
    setFormError(null);
    setPending("step");
    try {
      if (Object.keys(data).length > 0) await patchOnboarding(data);
      setStepIndex((index) => Math.min(steps.length - 1, index + 1));
    } catch (error) {
      const message = errorMessage(error, "No se pudieron guardar los datos.");
      setFormError(message);
      toast.error(message);
    } finally {
      setPending(null);
    }
  }

  async function finish() {
    // Todos los pasos obligatorios deben estar completos antes de terminar.
    for (const [index, step] of steps.entries()) {
      const { errors: stepErrors } = validateStep(step.key, values);
      if (Object.values(stepErrors).some(Boolean)) {
        setErrors(stepErrors);
        setStepIndex(index);
        setFormError("Falta algún dato obligatorio en este paso.");
        toast.error("Revisa el dato marcado antes de finalizar.");
        return;
      }
    }
    setFormError(null);
    setPending("finish");
    try {
      const response = await fetch("/api/onboarding/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          ...validPartialValues(values),
          invite: values.inviteEmail.trim() ? { email: values.inviteEmail.trim(), role: values.inviteRole } : null,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo completar la configuración."));
      const payload = (await response.json()) as CompletionResult;
      clearDraft(draftKey);
      invalidateActiveContext();
      setResult(payload);
      toast.success("Empresa configurada. Ya puedes facturar.");
      router.refresh();
    } catch (error) {
      const message = errorMessage(error, "No se pudo completar la configuración.");
      setFormError(message);
      toast.error(message);
    } finally {
      setPending(null);
    }
  }

  async function later() {
    setPending("later");
    try {
      // Se guarda todo lo válido que se haya escrito, aunque el paso no esté completo.
      const partial = validPartialValues(values);
      if (Object.keys(partial).length > 0) await patchOnboarding(partial);
      const response = await fetch("/api/onboarding/dismiss", { method: "POST", headers: getCsrfHeader() });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo posponer la configuración."));
      // El borrador local se conserva: al volver se recupera también lo que aún no era válido.
      toast.success("Guardado. Puedes terminar la configuración desde el panel cuando quieras.");
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      const message = errorMessage(error, "No se pudo posponer la configuración.");
      setFormError(message);
      toast.error(message);
      setPending(null);
    }
  }

  if (result) {
    const invitation = result.invitation;
    return (
      <section className="space-y-3 border border-success bg-success/10 p-3 text-foreground shadow-[inset_1px_1px_0_var(--window-highlight)]" role="status">
        <div>
          <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.04em]">Configuración inicial lista</p>
          <h2 className="mt-1 font-mono text-lg font-bold">Tu empresa está lista para facturar</h2>
          <p className="mt-1 text-xs">
            Hemos guardado los datos fiscales, la serie de facturas{result.bankAccountCreated ? ", la cuenta bancaria" : ""} y el plan contable. El siguiente paso es dar de alta tu primer cliente.
          </p>
        </div>
        {invitation ? (
          <div className="space-y-2 border border-window-dark-shadow bg-card p-2 text-xs">
            <p>
              {invitation.emailSent
                ? <>Hemos enviado la invitación a <strong>{invitation.email}</strong>.</>
                : <>Invitación creada para <strong>{invitation.email}</strong>. {invitation.emailProblem}</>}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="max-w-full truncate border border-window-shadow bg-window-panel px-1.5 py-0.5 font-mono text-[0.7rem]">{invitation.url}</code>
              <CopyLinkButton url={invitation.url} />
            </div>
          </div>
        ) : null}
        {result.invitationError ? <p className="border border-warning bg-warning/10 p-2 text-xs" role="alert">{result.invitationError}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Link className={buttonVariants()} href="/customers/new">
            Crear primer cliente
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/invoices/new">
            Hacer mi primera factura
          </Link>
          <Link className={buttonVariants({ variant: "ghost" })} href="/dashboard">
            Ir al panel
          </Link>
        </div>
      </section>
    );
  }

  const roleLabel = (role: AppRole) => roleLabels[role] ?? role;

  return (
    <form
      aria-labelledby="onboarding-step-title"
      className="space-y-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        // Enter en un paso intermedio avanza (guardando) en lugar de terminar.
        if (pending) return;
        if (isFinalStep) void finish();
        else void goNext();
      }}
    >
      <div className="space-y-1">
        <p className="font-mono text-xs text-muted-foreground" aria-live="polite">
          Paso {stepIndex + 1} de {steps.length}: {currentStep.title}
        </p>
        <div aria-hidden="true" className="h-1.5 border border-window-dark-shadow bg-window-panel">
          <div className="h-full bg-primary" style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
        </div>
      </div>

      <nav aria-label="Pasos de la puesta en marcha">
        <ol className="grid gap-1 sm:grid-cols-4">
          {steps.map((step, index) => {
            const isCurrent = index === stepIndex;
            const isDone = index < stepIndex;
            return (
              <li key={step.key}>
                <button
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "flex h-full w-full flex-col items-start gap-0.5 border px-2 py-1.5 text-left font-mono text-xs shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60",
                    isCurrent
                      ? "border-window-dark-shadow bg-primary text-primary-foreground"
                      : isDone
                        ? "border-success/70 bg-success/10 text-foreground hover:bg-window-highlight"
                        : "border-window-dark-shadow bg-window-panel text-foreground",
                  )}
                  // Solo se vuelve a pasos ya guardados: avanzar exige validar el actual.
                  disabled={index > stepIndex || Boolean(pending)}
                  onClick={() => setStepIndex(index)}
                  type="button"
                >
                  <span className="font-bold">
                    {index + 1}. {step.title}
                    {isDone ? <span className="sr-only"> (guardado)</span> : null}
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
          <h3 className="font-mono text-sm font-bold focus-visible:outline-none" id="onboarding-step-title" ref={headingRef} tabIndex={-1}>
            {currentStep.title}
            {currentStep.optional ? <span className="ml-1 font-normal text-muted-foreground">(opcional)</span> : null}
          </h3>
          <p className="text-xs text-muted-foreground">{currentStep.description}</p>
        </div>
        {!currentStep.optional ? <RequiredFieldsNote /> : null}

        {currentStep.key === "company" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <AccessibleField
              className="md:col-span-2"
              error={errors.legalName}
              helperText="Tu nombre y apellidos si eres autónomo, o la razón social de la sociedad (p. ej. Talleres Pérez S.L.)."
              id="legalName"
              label="Nombre o razón social"
              required
            >
              <Input autoComplete="organization" autoFocus placeholder="Talleres Pérez S.L." {...inputProps("legalName")} />
            </AccessibleField>
            <AccessibleField
              error={errors.vatNumber}
              helperText="CIF de la sociedad, o NIF/NIE si eres autónomo."
              id="vatNumber"
              label="NIF/CIF"
              required
            >
              <Input autoCapitalize="characters" placeholder="B12345674" spellCheck={false} {...inputProps("vatNumber")} />
            </AccessibleField>
            <fieldset aria-describedby={errors.businessType ? "businessType-error" : undefined} className="space-y-1 md:col-span-2">
              <legend className="text-sm font-medium">
                ¿Vendes productos, servicios o ambos?<span aria-hidden="true" className="text-destructive"> *</span>
                <span className="sr-only"> (obligatorio)</span>
              </legend>
              <div className="grid gap-1 sm:grid-cols-3">
                {BUSINESS_TYPES.map((type) => (
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-2 border p-2 text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus",
                      values.businessType === type ? "border-primary bg-primary/10" : "border-window-dark-shadow bg-card hover:bg-window-highlight",
                    )}
                    key={type}
                  >
                    <input
                      checked={values.businessType === type}
                      className="mt-0.5"
                      name="businessType"
                      onChange={() => setField("businessType", type)}
                      type="radio"
                      value={type}
                    />
                    <span>
                      <span className="block font-mono font-bold">{businessTypeLabels[type]}</span>
                      <span className="block text-muted-foreground">{businessTypeDescriptions[type]}</span>
                    </span>
                  </label>
                ))}
              </div>
              {errors.businessType ? <p className="font-mono text-xs text-destructive" id="businessType-error" role="alert">{errors.businessType}</p> : null}
            </fieldset>
          </div>
        ) : null}

        {currentStep.key === "address" ? (
          <div className="grid gap-3 md:grid-cols-6">
            <AccessibleField className="md:col-span-6" error={errors.fiscalAddress} id="fiscalAddress" label="Dirección fiscal" required>
              <Input autoComplete="street-address" autoFocus placeholder="Calle Mayor 1, 2º B" {...inputProps("fiscalAddress")} />
            </AccessibleField>
            <AccessibleField className="md:col-span-2" error={errors.postalCode} id="postalCode" label="Código postal" required>
              <Input autoComplete="postal-code" inputMode="numeric" maxLength={5} placeholder="28013" {...inputProps("postalCode")} />
            </AccessibleField>
            <AccessibleField className="md:col-span-2" error={errors.city} id="city" label="Ciudad" required>
              <Input autoComplete="address-level2" placeholder="Madrid" {...inputProps("city")} />
            </AccessibleField>
            <AccessibleField className="md:col-span-2" error={errors.province} id="province" label="Provincia" required>
              <Input autoComplete="address-level1" placeholder="Madrid" {...inputProps("province")} />
            </AccessibleField>
          </div>
        ) : null}

        {currentStep.key === "billing" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <AccessibleField
              className="md:col-span-2"
              error={errors.invoicePrefix}
              helperText={`Letras al inicio del número de factura (FA → ${values.invoicePrefix.trim().toUpperCase() || "FA"}000001). Si no sabes qué poner, deja FA.`}
              id="invoicePrefix"
              label="Prefijo de tus facturas"
              required
            >
              <Input autoFocus className="font-mono uppercase" maxLength={10} placeholder="FA" {...inputProps("invoicePrefix")} />
            </AccessibleField>
            <AccessibleField
              error={errors.iban}
              helperText="Opcional. Aparecerá en tus facturas como forma de pago por transferencia."
              id="iban"
              label="IBAN de tu cuenta bancaria"
            >
              <Input autoComplete="off" className="font-mono" placeholder="ES91 2100 0418 4502 0005 1332" spellCheck={false} {...inputProps("iban")} />
            </AccessibleField>
            <AccessibleField error={errors.bankName} helperText="Opcional, para reconocerla (p. ej. CaixaBank)." id="bankName" label="Nombre del banco">
              <Input autoComplete="off" placeholder="Mi banco" {...inputProps("bankName")} />
            </AccessibleField>
          </div>
        ) : null}

        {currentStep.key === "team" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <AccessibleField
              error={errors.inviteEmail}
              helperText={`Recibirá un enlace para unirse a ${workspaceName}. Si no hay correo configurado, te daremos el enlace para que se lo envíes tú.`}
              id="inviteEmail"
              label="Email de tu gestor o de la persona a invitar"
            >
              <Input autoComplete="email" autoFocus inputMode="email" placeholder="gestor@asesoria.es" type="email" {...inputProps("inviteEmail")} />
            </AccessibleField>
            <AccessibleField helperText={roleDescriptions[values.inviteRole]} id="inviteRole" label="Qué podrá hacer">
              <Select onChange={(event) => setField("inviteRole", event.target.value)} value={values.inviteRole}>
                {inviteRoles.map((role) => (
                  <option key={role} value={role}>{roleLabel(role)}</option>
                ))}
              </Select>
            </AccessibleField>
          </div>
        ) : null}
      </div>

      <FormErrorMessage>{formError}</FormErrorMessage>

      <div className="flex flex-wrap items-center gap-2 border-t border-window-shadow pt-3">
        <Button disabled={stepIndex === 0 || Boolean(pending)} onClick={() => setStepIndex((index) => Math.max(0, index - 1))} type="button" variant="outline">
          Anterior
        </Button>
        <Button disabled={Boolean(pending)} onClick={() => void later()} title="Guarda lo que hayas escrito y vuelve al panel" type="button" variant="ghost">
          {pending === "later" ? "Guardando…" : "Hacerlo más tarde"}
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          {isFinalStep ? (
            <SubmitButton pending={pending === "finish"} pendingLabel="Preparando tu empresa…">
              {values.inviteEmail.trim() ? "Invitar y finalizar" : "Finalizar sin invitar"}
            </SubmitButton>
          ) : (
            <SubmitButton pending={pending === "step"} pendingLabel="Guardando…">
              Guardar y seguir
            </SubmitButton>
          )}
        </div>
      </div>
    </form>
  );
}

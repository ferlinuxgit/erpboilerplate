import * as React from "react";
import { Controller, FormProvider, useFormContext, type ControllerProps, type FieldPath, type FieldValues } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export { FormProvider as Form };

export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(props: ControllerProps<TFieldValues, TName>) {
  return <Controller {...props} />;
}

export function useFormField() {
  return useFormContext();
}

type AccessibleFieldProps = {
  id: string;
  label: React.ReactNode;
  children: React.ReactNode;
  helperText?: React.ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  /** Visually hide the label (it stays available to assistive technology). */
  hideLabel?: boolean;
};

type FieldControlProps = {
  id?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  "aria-describedby"?: string;
  "aria-required"?: React.AriaAttributes["aria-required"];
};

/** ids of the helper and error paragraphs rendered by `AccessibleField`. */
export function fieldDescriptionIds(id: string, { error, helperText }: { error?: unknown; helperText?: unknown }) {
  return [helperText ? `${id}-helper` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

/**
 * Label + control + helper + error with the ARIA wiring done for you:
 * the single child control receives `id`, `aria-invalid`, `aria-required` and
 * an `aria-describedby` that points to the helper text and the error message.
 */
export function AccessibleField({ children, className, error, helperText, hideLabel, id, label, required }: AccessibleFieldProps) {
  const describedBy = fieldDescriptionIds(id, { error, helperText });
  // The first element child is the control that receives the ARIA wiring. Extra children
  // (e.g. an inline hint or a conditional button) are rendered as-is instead of crashing.
  const nodes = React.Children.toArray(children);
  const controlIndex = nodes.findIndex((node) => React.isValidElement(node));
  const control = controlIndex >= 0 ? nodes[controlIndex] : null;
  const enhancedControl = React.isValidElement<FieldControlProps>(control)
    ? React.cloneElement(control, {
        id: control.props.id ?? id,
        "aria-invalid": control.props["aria-invalid"] ?? (error ? true : undefined),
        "aria-required": control.props["aria-required"] ?? (required ? true : undefined),
        "aria-describedby": [control.props["aria-describedby"], describedBy]
          .filter(Boolean)
          .join(" ")
          .split(" ")
          .filter((value, index, all) => value && all.indexOf(value) === index)
          .join(" ") || undefined,
      })
    : control;
  const enhanced = controlIndex >= 0 ? nodes.map((node, index) => (index === controlIndex ? enhancedControl : node)) : nodes;

  return (
    <div className={cn("min-w-0 space-y-1", className)} data-slot="field">
      <Label className={hideLabel ? "sr-only" : undefined} htmlFor={id}>
        <span>
          {label}
          {required ? (
            <>
              <span className="text-destructive" aria-hidden="true"> *</span>
              <span className="sr-only"> (obligatorio)</span>
            </>
          ) : null}
        </span>
      </Label>
      {enhanced}
      {helperText ? <p className="text-xs leading-4 text-muted-foreground" id={`${id}-helper`}>{helperText}</p> : null}
      {error ? (
        <p className="font-mono text-xs text-destructive" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Legend shown once per form to explain the required marker. */
export function RequiredFieldsNote({ className }: { className?: string }) {
  return (
    <p className={cn("text-[0.7rem] text-muted-foreground", className)}>
      Los campos marcados con <span className="text-destructive" aria-hidden="true">*</span>
      <span className="sr-only">asterisco</span> son obligatorios.
    </p>
  );
}

/** Form-level error (server or cross-field validation) announced to AT. */
export function FormErrorMessage({ children, className, id }: { children?: React.ReactNode; className?: string; id?: string }) {
  if (!children) return null;
  return (
    <p
      className={cn("border border-destructive bg-destructive/10 px-2 py-1.5 font-mono text-xs text-destructive", className)}
      id={id}
      role="alert"
    >
      {children}
    </p>
  );
}

type SubmitButtonProps = React.ComponentProps<typeof Button> & {
  pending?: boolean;
  pendingLabel?: string;
};

/** Submit button with the shared pending state ("Guardando…"). */
export function SubmitButton({ children, disabled, pending = false, pendingLabel = "Guardando…", type = "submit", ...props }: SubmitButtonProps) {
  return (
    <Button aria-busy={pending || undefined} disabled={disabled || pending} type={type} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

/** Sticky footer for long forms: hint on the left, actions on the right. */
export function FormActions({ children, className, hint = "Ctrl/Cmd + Enter para guardar", sticky = false }: { children: React.ReactNode; className?: string; hint?: React.ReactNode; sticky?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 border-t border-window-shadow pt-3",
        sticky && "sticky bottom-2 z-10 border border-window-dark-shadow bg-window-panel p-2 shadow-[3px_3px_0_var(--window-shadow)]",
        className,
      )}
    >
      {hint ? <p className="mr-auto hidden text-xs text-muted-foreground sm:block">{hint}</p> : null}
      {children}
    </div>
  );
}

/**
 * Extracts a human readable Spanish message from a failed API response.
 * Never returns a generic "Error": falls back to the provided sentence.
 */
export async function readApiError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { message?: unknown; error?: unknown; issues?: unknown } | null;
  const message = typeof payload?.message === "string" ? payload.message.trim() : typeof payload?.error === "string" ? payload.error.trim() : "";
  if (message && !/^(error|internal server error|bad request)\.?$/i.test(message)) return message;
  if (response.status === 401) return "Tu sesión ha caducado. Vuelve a iniciar sesión.";
  if (response.status === 403) return "No tienes permiso para realizar esta acción.";
  if (response.status === 404) return "El registro ya no existe o no está disponible.";
  if (response.status === 409) return `${fallback} Ya existe un registro con esos datos.`;
  if (response.status === 429) return "Demasiadas peticiones. Espera unos segundos y vuelve a intentarlo.";
  if (response.status >= 500) return `${fallback} El servidor no ha respondido correctamente; inténtalo de nuevo.`;
  return fallback;
}

/** Message for unexpected exceptions (network errors, etc.). */
export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError) return "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.";
  if (error instanceof Error && error.message && !/^error\.?$/i.test(error.message)) return error.message;
  return fallback;
}

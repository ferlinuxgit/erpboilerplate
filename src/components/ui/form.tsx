import { Controller, FormProvider, useFormContext, type ControllerProps, type FieldPath, type FieldValues } from "react-hook-form";

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
  label: string;
  children: React.ReactNode;
  helperText?: string;
  error?: string;
  required?: boolean;
  className?: string;
};

export function AccessibleField({ children, className, error, helperText, id, label, required }: AccessibleFieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-destructive" aria-hidden="true"> *</span> : null}
      </Label>
      {children}
      {helperText ? <p className="text-sm text-muted-foreground" id={`${id}-helper`}>{helperText}</p> : null}
      {error ? (
        <p className="text-sm text-red-600" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

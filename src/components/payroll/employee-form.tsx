"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, FormActions, readApiError, RequiredFieldsNote, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PercentInput } from "@/components/ui/number-input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { parseDecimalInput } from "@/lib/format";
import { MODELO_190_E_SUBKEYS } from "@/server/fiscal/withholdings";
import { DIRECTOR_WITHHOLDING_RATES, RECIPIENT_KIND_LABELS, type RecipientKind } from "@/server/payroll/model";

export type EmployeeFormValues = {
  name: string;
  taxId: string;
  socialSecurityNumber: string;
  startDate: string;
  endDate: string;
  recipientKind: RecipientKind;
  subkey190: string;
  withholdingRate: string;
  birthYear: string;
  familySituation: string;
  disability: string;
  contractType: string;
  spouseTaxId: string;
  notes: string;
  isActive: boolean;
};

export const EMPTY_EMPLOYEE: EmployeeFormValues = {
  name: "",
  taxId: "",
  socialSecurityNumber: "",
  startDate: "",
  endDate: "",
  recipientKind: "employee",
  subkey190: "04",
  withholdingRate: "",
  birthYear: "",
  familySituation: "",
  disability: "",
  contractType: "",
  spouseTaxId: "",
  notes: "",
  isActive: true,
};

const optionalInt = (value: string) => (value === "" ? null : Number(value));

/** Ficha de un trabajador (clave A del 190) o de un administrador (clave E). */
export function EmployeeForm({ employeeId, initialValues }: { employeeId?: string; initialValues: EmployeeFormValues }) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<EmployeeFormValues>) => setValues((current) => ({ ...current, ...patch }));
  const isDirector = values.recipientKind === "director";

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const body = {
        name: values.name,
        taxId: values.taxId || null,
        socialSecurityNumber: values.socialSecurityNumber || null,
        startDate: values.startDate || null,
        endDate: values.endDate || null,
        recipientKind: values.recipientKind,
        subkey190: isDirector ? values.subkey190 || "04" : null,
        withholdingRate: parseDecimalInput(values.withholdingRate) ?? 0,
        birthYear: isDirector ? null : optionalInt(values.birthYear),
        familySituation: isDirector ? null : optionalInt(values.familySituation),
        disability: isDirector ? null : optionalInt(values.disability),
        contractType: isDirector ? null : optionalInt(values.contractType),
        spouseTaxId: isDirector ? null : values.spouseTaxId || null,
        notes: values.notes || null,
        isActive: values.isActive,
      };
      const response = await fetch(employeeId ? `/api/payroll/employees/${employeeId}` : "/api/payroll/employees", {
        method: employeeId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar el trabajador."));
      toast.success(employeeId ? "Ficha guardada." : "Trabajador dado de alta.");
      router.push("/payroll/employees");
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "No se pudo guardar el trabajador."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="grid gap-3 md:grid-cols-6"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") event.currentTarget.requestSubmit();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <AccessibleField className="md:col-span-3" id="employee-name" label="Nombre y apellidos" required>
        <Input maxLength={200} onChange={(event) => set({ name: event.target.value })} required value={values.name} />
      </AccessibleField>
      <AccessibleField className="md:col-span-1" helperText="Imprescindible para el 190." id="employee-tax-id" label="NIF">
        <Input maxLength={20} onChange={(event) => set({ taxId: event.target.value })} placeholder="12345678Z" value={values.taxId} />
      </AccessibleField>
      <AccessibleField className="md:col-span-2" helperText="Número de afiliación a la Seguridad Social." id="employee-naf" label="NAF">
        <Input maxLength={20} onChange={(event) => set({ socialSecurityNumber: event.target.value })} placeholder="28/12345678/90" value={values.socialSecurityNumber} />
      </AccessibleField>

      <AccessibleField className="md:col-span-3" helperText="Los profesionales que te facturan no se dan de alta aquí: salen de sus facturas con retención." id="employee-kind" label="Tipo de perceptor" required>
        <Select
          onChange={(event) => {
            const kind = event.target.value as RecipientKind;
            // Al pasar a administrador se propone su tipo general del 35 % si aún no hay ninguno.
            set({ recipientKind: kind, withholdingRate: kind === "director" && !values.withholdingRate ? String(DIRECTOR_WITHHOLDING_RATES.general) : values.withholdingRate });
          }}
          value={values.recipientKind}
        >
          {(Object.keys(RECIPIENT_KIND_LABELS) as RecipientKind[]).map((kind) => (
            <option key={kind} value={kind}>{RECIPIENT_KIND_LABELS[kind]}</option>
          ))}
        </Select>
      </AccessibleField>
      <AccessibleField
        className="md:col-span-1"
        helperText={isDirector ? `${DIRECTOR_WITHHOLDING_RATES.general} % general; ${DIRECTOR_WITHHOLDING_RATES.smallEntity} % si la empresa facturó menos de 100.000 €.` : "El que indica la gestoría en la nómina."}
        id="employee-rate"
        label="Retención de IRPF"
      >
        <PercentInput onChange={(event) => set({ withholdingRate: event.target.value })} placeholder="0" value={values.withholdingRate} />
      </AccessibleField>
      <AccessibleField className="md:col-span-1" id="employee-start" label="Fecha de alta">
        <Input onChange={(event) => set({ startDate: event.target.value })} type="date" value={values.startDate} />
      </AccessibleField>
      <AccessibleField className="md:col-span-1" id="employee-end" label="Fecha de baja">
        <Input min={values.startDate || undefined} onChange={(event) => set({ endDate: event.target.value })} type="date" value={values.endDate} />
      </AccessibleField>

      {isDirector ? (
        <AccessibleField className="md:col-span-6" helperText="Subclave de la clave E en el modelo 190." id="employee-subkey" label="Situación del administrador" required>
          <Select onChange={(event) => set({ subkey190: event.target.value })} value={values.subkey190}>
            {Object.entries(MODELO_190_E_SUBKEYS).map(([code, label]) => (
              <option key={code} value={code}>{code} · {label}</option>
            ))}
          </Select>
        </AccessibleField>
      ) : (
        <>
          <p className="font-mono text-xs text-muted-foreground md:col-span-6">Datos del modelo 190 (opcionales: si faltan, el modelo avisa).</p>
          <AccessibleField className="md:col-span-1" id="employee-birth" label="Año de nacimiento">
            <Input inputMode="numeric" max={2100} min={1900} onChange={(event) => set({ birthYear: event.target.value })} placeholder="1985" type="number" value={values.birthYear} />
          </AccessibleField>
          <AccessibleField className="md:col-span-2" id="employee-family" label="Situación familiar">
            <Select onChange={(event) => set({ familySituation: event.target.value })} value={values.familySituation}>
              <option value="">Sin indicar</option>
              <option value="1">1 · Soltero, viudo, divorciado o separado con hijos a su cargo en exclusiva</option>
              <option value="2">2 · Casado y el cónyuge no supera el límite de rentas</option>
              <option value="3">3 · Otra situación (o no la ha comunicado)</option>
            </Select>
          </AccessibleField>
          <AccessibleField className="md:col-span-1" helperText="Solo en la situación 2." id="employee-spouse" label="NIF del cónyuge">
            <Input disabled={values.familySituation !== "2"} maxLength={20} onChange={(event) => set({ spouseTaxId: event.target.value })} value={values.spouseTaxId} />
          </AccessibleField>
          <AccessibleField className="md:col-span-1" id="employee-contract" label="Contrato">
            <Select onChange={(event) => set({ contractType: event.target.value })} value={values.contractType}>
              <option value="">Sin indicar</option>
              <option value="1">1 · General</option>
              <option value="2">2 · Inferior al año</option>
              <option value="3">3 · Relación laboral especial</option>
              <option value="4">4 · Peonadas o jornales</option>
            </Select>
          </AccessibleField>
          <AccessibleField className="md:col-span-1" id="employee-disability" label="Discapacidad">
            <Select onChange={(event) => set({ disability: event.target.value })} value={values.disability}>
              <option value="">Sin indicar</option>
              <option value="0">0 · No o inferior al 33 %</option>
              <option value="1">1 · Del 33 % al 65 %</option>
              <option value="2">2 · Ídem con movilidad reducida</option>
              <option value="3">3 · 65 % o más</option>
            </Select>
          </AccessibleField>
        </>
      )}

      <AccessibleField className="md:col-span-6" id="employee-notes" label="Notas">
        <Textarea maxLength={2000} onChange={(event) => set({ notes: event.target.value })} value={values.notes} />
      </AccessibleField>
      {employeeId ? (
        <label className="flex w-fit items-center gap-2 text-sm md:col-span-6">
          <input checked={values.isActive} onChange={(event) => set({ isActive: event.target.checked })} type="checkbox" />
          Activo (aparece al crear nóminas)
        </label>
      ) : null}

      <RequiredFieldsNote className="md:col-span-6" />
      {error ? <InlineAlert className="md:col-span-6" role="alert" tone="danger">{error}</InlineAlert> : null}
      <FormActions className="md:col-span-6">
        <Button onClick={() => router.push("/payroll/employees")} type="button" variant="outline">Cancelar</Button>
        <SubmitButton pending={pending}>{employeeId ? "Guardar cambios" : "Dar de alta"}</SubmitButton>
      </FormActions>
    </form>
  );
}

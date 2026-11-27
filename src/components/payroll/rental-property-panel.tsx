"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, readApiError, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { RENTAL_PROPERTY_SITUATIONS } from "@/server/fiscal/withholdings";

type RentalPropertyFormProps = {
  landlords: Array<{ id: string; name: string; taxId: string | null }>;
};

const EMPTY = { supplierPartnerId: "", situation: "1", cadastralReference: "", address: "", postalCode: "", city: "", province: "" };

/** Alta del inmueble alquilado a un proveedor: lo que pide el modelo 180 de cada arrendador. */
export function RentalPropertyForm({ landlords }: RentalPropertyFormProps) {
  const router = useRouter();
  const [values, setValues] = useState(EMPTY);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof EMPTY>) => setValues((current) => ({ ...current, ...patch }));
  const needsReference = values.situation !== "4";

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/payroll/rental-properties", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          supplierPartnerId: values.supplierPartnerId,
          situation: values.situation,
          cadastralReference: needsReference ? values.cadastralReference.replace(/\s/g, "").toUpperCase() : null,
          address: values.address || null,
          postalCode: values.postalCode || null,
          city: values.city || null,
          province: values.province || null,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar el inmueble."));
      toast.success("Inmueble guardado.");
      setValues(EMPTY);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "No se pudo guardar el inmueble."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="grid gap-3 md:grid-cols-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <AccessibleField className="md:col-span-3" helperText="El proveedor que te factura el alquiler." id="rental-landlord" label="Arrendador" required>
        <Select onChange={(event) => set({ supplierPartnerId: event.target.value })} required value={values.supplierPartnerId}>
          <option value="">Elige un proveedor</option>
          {landlords.map((landlord) => (
            <option key={landlord.id} value={landlord.id}>{landlord.name}{landlord.taxId ? ` · ${landlord.taxId}` : ""}</option>
          ))}
        </Select>
      </AccessibleField>
      <AccessibleField className="md:col-span-3" id="rental-situation" label="Situación del inmueble" required>
        <Select onChange={(event) => set({ situation: event.target.value })} value={values.situation}>
          {Object.entries(RENTAL_PROPERTY_SITUATIONS).map(([code, label]) => (
            <option key={code} value={code}>{code} · {label}</option>
          ))}
        </Select>
      </AccessibleField>
      <AccessibleField className="md:col-span-2" helperText="20 letras y números; está en el recibo del IBI o en la Sede del Catastro." id="rental-reference" label="Referencia catastral" required={needsReference}>
        <Input className="font-mono" disabled={!needsReference} maxLength={24} onChange={(event) => set({ cadastralReference: event.target.value })} placeholder="9872023VH5797S0001WX" required={needsReference} value={values.cadastralReference} />
      </AccessibleField>
      <AccessibleField className="md:col-span-4" id="rental-address" label="Dirección">
        <Input maxLength={300} onChange={(event) => set({ address: event.target.value })} placeholder="Calle Mayor 1, local 2" value={values.address} />
      </AccessibleField>
      <AccessibleField className="md:col-span-1" id="rental-postal-code" label="Código postal">
        <Input maxLength={10} onChange={(event) => set({ postalCode: event.target.value })} value={values.postalCode} />
      </AccessibleField>
      <AccessibleField className="md:col-span-3" id="rental-city" label="Municipio">
        <Input maxLength={120} onChange={(event) => set({ city: event.target.value })} value={values.city} />
      </AccessibleField>
      <AccessibleField className="md:col-span-2" id="rental-province" label="Provincia">
        <Input maxLength={120} onChange={(event) => set({ province: event.target.value })} value={values.province} />
      </AccessibleField>
      {error ? <InlineAlert className="md:col-span-6" role="alert" tone="danger">{error}</InlineAlert> : null}
      <div className="md:col-span-6">
        <SubmitButton pending={pending}>Guardar inmueble</SubmitButton>
      </div>
    </form>
  );
}

export function DeleteRentalPropertyButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const response = await fetch(`/api/payroll/rental-properties/${id}`, { method: "DELETE", headers: getCsrfHeader() });
          if (!response.ok) throw new Error(await readApiError(response, "No se pudo eliminar el inmueble."));
          toast.success("Inmueble eliminado.");
          router.refresh();
        } catch (caught) {
          toast.error(errorMessage(caught, "No se pudo eliminar el inmueble."));
        } finally {
          setBusy(false);
        }
      }}
      size="xs"
      type="button"
      variant="outline"
    >
      {busy ? "Eliminando…" : "Eliminar"}
    </Button>
  );
}

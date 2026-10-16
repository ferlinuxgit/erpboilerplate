"use client";

import { UserPlus } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";

/** Da de alta como cliente al contacto de una oportunidad (con los datos fiscales que pide la factura). */
export function ConvertContactDialog({ contact, opportunityId }: { contact: { name: string; email: string | null; phone: string | null }; opportunityId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ name: contact.name, taxId: "", address: "", postalCode: "", city: "", province: "", countryCode: "ES", email: contact.email ?? "", phone: contact.phone ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => setValues((current) => ({ ...current, [key]: event.target.value }));

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/crm/opportunities/${opportunityId}/convert-customer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo dar de alta el cliente."));
      toast.success(`${values.name} ya es cliente.`);
      setOpen(false);
      router.refresh();
    } catch (reason) {
      setError(errorMessage(reason, "No se pudo dar de alta el cliente."));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button data-testid="crm-convert-contact" onClick={() => setOpen(true)} size="sm" type="button" variant="outline">
        <UserPlus aria-hidden="true" /> Dar de alta como cliente
      </Button>
      <Dialog description="Con estos datos ya se le podrá facturar." initialFocusId="convert-tax-id" onClose={() => setOpen(false)} open={open} size="lg" title="Nuevo cliente">
        <div className="grid gap-2 sm:grid-cols-2">
          <AccessibleField className="sm:col-span-2" id="convert-name" label="Nombre o razón social" required><Input onChange={set("name")} value={values.name} /></AccessibleField>
          <AccessibleField id="convert-tax-id" label="CIF/NIF" required><Input onChange={set("taxId")} value={values.taxId} /></AccessibleField>
          <AccessibleField id="convert-country" label="País (código)" required><Input maxLength={2} onChange={set("countryCode")} value={values.countryCode} /></AccessibleField>
          <AccessibleField className="sm:col-span-2" id="convert-address" label="Dirección" required><Input onChange={set("address")} value={values.address} /></AccessibleField>
          <AccessibleField id="convert-postal-code" label="Código postal" required><Input onChange={set("postalCode")} value={values.postalCode} /></AccessibleField>
          <AccessibleField id="convert-city" label="Ciudad" required><Input onChange={set("city")} value={values.city} /></AccessibleField>
          <AccessibleField id="convert-province" label="Provincia" required><Input onChange={set("province")} value={values.province} /></AccessibleField>
          <AccessibleField id="convert-email" label="Email"><Input onChange={set("email")} type="email" value={values.email} /></AccessibleField>
          <AccessibleField id="convert-phone" label="Teléfono"><Input onChange={set("phone")} type="tel" value={values.phone} /></AccessibleField>
        </div>
        {error ? <FormErrorMessage className="mt-2">{error}</FormErrorMessage> : null}
        <DialogFooter>
          <Button onClick={() => setOpen(false)} type="button" variant="ghost">Cancelar</Button>
          <Button data-testid="crm-convert-save" disabled={pending} onClick={() => void submit()} type="button">{pending ? "Guardando…" : "Crear cliente"}</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

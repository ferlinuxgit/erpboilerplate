"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, FileText, Globe2, Landmark, Mail, MapPin, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { companyProfileSchema } from "@/server/schemas/forms";

export type CompanyProfileFormValues = z.infer<typeof companyProfileSchema>;

type CompanyProfileFormProps = {
  initialValues: CompanyProfileFormValues;
};

const requiredForInvoice = [
  ["legalName", "Razón social"],
  ["vatNumber", "CIF/NIF"],
  ["fiscalAddress", "Dirección fiscal"],
  ["postalCode", "Código postal"],
  ["city", "Ciudad"],
  ["province", "Provincia"],
] as const;

const countries = [
  { code: "ES", label: "España" },
  { code: "PT", label: "Portugal" },
  { code: "FR", label: "Francia" },
];

const currencies = ["EUR", "USD", "GBP"] as const;

const timezones = [
  "Europe/Madrid",
  "Europe/Lisbon",
  "Europe/Paris",
  "Atlantic/Canary",
  "UTC",
] as const;

function completion(values: Partial<CompanyProfileFormValues>) {
  const missing = requiredForInvoice.filter(([key]) => !values[key]?.trim()).map(([, label]) => label);
  return {
    missing,
    ready: missing.length === 0,
  };
}

export function CompanyProfileForm({ initialValues }: CompanyProfileFormProps) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CompanyProfileFormValues>({
    resolver: zodResolver(companyProfileSchema),
    defaultValues: initialValues,
  });
  const watchedValues = useWatch({ control });
  const invoiceReadiness = useMemo(() => completion(watchedValues), [watchedValues]);

  const submit = handleSubmit(async (values) => {
    try {
      const response = await fetch("/api/company/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "No se pudo guardar el perfil de empresa.");
      }

      toast.success("Perfil de empresa guardado.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error inesperado.");
    }
  });

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="size-5 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-base font-medium">Perfil legal y operativo</h2>
            <StatusBadge tone={invoiceReadiness.ready ? "success" : "warning"}>
              {invoiceReadiness.ready ? "Listo para factura" : `${invoiceReadiness.missing.length} datos pendientes`}
            </StatusBadge>
          </div>
          {invoiceReadiness.missing.length > 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Pendiente: {invoiceReadiness.missing.join(", ")}.
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Los datos principales del emisor están completos para documentos comerciales y fiscales.
            </p>
          )}
        </div>
        <Button disabled={isSubmitting} type="submit">
          <Save aria-hidden="true" />
          {isSubmitting ? "Guardando" : "Guardar perfil"}
        </Button>
      </div>

      <section className="rounded-lg border p-4">
        <div className="mb-4 flex items-center gap-2">
          <Landmark className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-medium">Identidad fiscal</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-6">
          <AccessibleField id="company-name" label="Nombre comercial" required error={errors.name?.message} className="md:col-span-3">
            <Input id="company-name" required autoComplete="organization" {...register("name")} />
          </AccessibleField>
          <AccessibleField id="company-legal-name" label="Razón social" error={errors.legalName?.message} className="md:col-span-3">
            <Input id="company-legal-name" autoComplete="organization" placeholder="Empresa Demo S.L." {...register("legalName")} />
          </AccessibleField>
          <AccessibleField id="company-vat-number" label="CIF/NIF/VAT" error={errors.vatNumber?.message} helperText="Para España se valida y normaliza sin espacios ni guiones." className="md:col-span-2">
            <Input id="company-vat-number" autoCapitalize="characters" placeholder="B12345678" {...register("vatNumber")} />
          </AccessibleField>
          <AccessibleField id="company-country" label="País" required error={errors.countryCode?.message} className="md:col-span-2">
            <Select id="company-country" required {...register("countryCode")}>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>{country.label}</option>
              ))}
            </Select>
          </AccessibleField>
          <AccessibleField id="company-currency" label="Moneda base" required error={errors.baseCurrencyCode?.message} className="md:col-span-2">
            <Select id="company-currency" required {...register("baseCurrencyCode")}>
              {currencies.map((currency) => (
                <option key={currency} value={currency}>{currency}</option>
              ))}
            </Select>
          </AccessibleField>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <div className="mb-4 flex items-center gap-2">
          <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-medium">Domicilio fiscal</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-6">
          <AccessibleField id="company-fiscal-address" label="Dirección fiscal" error={errors.fiscalAddress?.message} className="md:col-span-4">
            <Input id="company-fiscal-address" autoComplete="street-address" placeholder="Calle Mayor 1" {...register("fiscalAddress")} />
          </AccessibleField>
          <AccessibleField id="company-postal-code" label="Código postal" error={errors.postalCode?.message} className="md:col-span-2">
            <Input id="company-postal-code" autoComplete="postal-code" {...register("postalCode")} />
          </AccessibleField>
          <AccessibleField id="company-fiscal-address-line-2" label="Dirección 2" error={errors.fiscalAddressLine2?.message} className="md:col-span-3">
            <Input id="company-fiscal-address-line-2" placeholder="Planta, oficina, edificio" {...register("fiscalAddressLine2")} />
          </AccessibleField>
          <AccessibleField id="company-city" label="Ciudad" error={errors.city?.message} className="md:col-span-1">
            <Input id="company-city" autoComplete="address-level2" {...register("city")} />
          </AccessibleField>
          <AccessibleField id="company-province" label="Provincia" error={errors.province?.message} className="md:col-span-2">
            <Input id="company-province" autoComplete="address-level1" {...register("province")} />
          </AccessibleField>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <div className="mb-4 flex items-center gap-2">
          <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-medium">Contacto y localización</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-6">
          <AccessibleField id="company-email" label="Email público" error={errors.email?.message} className="md:col-span-2">
            <Input id="company-email" type="email" autoComplete="email" placeholder="administracion@empresa.com" {...register("email")} />
          </AccessibleField>
          <AccessibleField id="company-phone" label="Teléfono" error={errors.phone?.message} className="md:col-span-2">
            <Input id="company-phone" type="tel" autoComplete="tel" {...register("phone")} />
          </AccessibleField>
          <AccessibleField id="company-website" label="Web" error={errors.website?.message} className="md:col-span-2">
            <Input id="company-website" type="url" placeholder="https://empresa.com" {...register("website")} />
          </AccessibleField>
          <AccessibleField id="company-timezone" label="Zona horaria" required error={errors.timezone?.message} className="md:col-span-2">
            <Select id="company-timezone" required {...register("timezone")}>
              {timezones.map((timezone) => (
                <option key={timezone} value={timezone}>{timezone}</option>
              ))}
            </Select>
          </AccessibleField>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <div className="mb-4 flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-medium">Documentos emitidos</h3>
        </div>
        <AccessibleField id="company-invoice-footer" label="Pie de factura" error={errors.invoiceFooter?.message} helperText="Se imprime al final del PDF de factura.">
          <Textarea id="company-invoice-footer" maxLength={500} placeholder="Registro mercantil, datos bancarios o condiciones de pago." {...register("invoiceFooter")} />
        </AccessibleField>
      </section>

      <div className="flex justify-end">
        <Button disabled={isSubmitting} type="submit">
          <Globe2 aria-hidden="true" />
          {isSubmitting ? "Guardando" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}

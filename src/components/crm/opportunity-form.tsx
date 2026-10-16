"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AccessibleField, FormActions, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { parseDecimalInput } from "@/lib/format";
import { CRM_SOURCES, crmSourceLabels } from "@/modules/crm/model";

import { dateInputToIso, dateInputValue, type CrmOpportunityView, type CrmOption, type CrmStageView } from "./types";

const NEW_CONTACT = "";

/** Alta y edición de una oportunidad: cliente (o contacto aún sin ficha), importe, etapa y responsable. */
export function OpportunityForm({
  currencySymbol = "€",
  currentUserId,
  customers,
  initial,
  initialCustomerId,
  stages,
  team,
}: {
  currencySymbol?: string;
  currentUserId: string;
  customers: CrmOption[];
  initial?: CrmOpportunityView;
  initialCustomerId?: string;
  stages: CrmStageView[];
  team: CrmOption[];
}) {
  const router = useRouter();
  const openStages = stages.filter((stage) => stage.kind === "OPEN");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? initialCustomerId ?? NEW_CONTACT);
  const [contactName, setContactName] = useState(initial?.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amount).replace(".", ",") : "");
  const [stageId, setStageId] = useState(initial?.stageId ?? openStages[0]?.id ?? stages[0]?.id ?? "");
  const [expectedCloseDate, setExpectedCloseDate] = useState(dateInputValue(initial?.expectedCloseDate));
  const [ownerUserId, setOwnerUserId] = useState(initial?.ownerUserId ?? currentUserId);
  const [source, setSource] = useState(initial?.source ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (title.trim().length < 2) nextErrors.title = "Pon un título (p. ej. «Web corporativa para Pérez S.L.»).";
    if (!customerId && !contactName.trim()) nextErrors.contactName = "Elige un cliente o escribe el nombre del contacto.";
    const parsedAmount = amount.trim() ? parseDecimalInput(amount, { maximumFractionDigits: 2 }) : 0;
    if (parsedAmount === null || parsedAmount < 0) nextErrors.amount = "Importe no válido.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setPending(true);
    setFormError(null);
    try {
      const body = {
        title,
        customerId: customerId || null,
        contactName: contactName || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        amount: parsedAmount ?? 0,
        expectedCloseDate: dateInputToIso(expectedCloseDate),
        ownerUserId: ownerUserId || null,
        source: source || null,
        notes: notes || null,
        ...(initial ? {} : { stageId }),
      };
      const response = await fetch(initial ? `/api/crm/opportunities/${initial.id}` : "/api/crm/opportunities", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la oportunidad."));
      const saved = await response.json() as { id: string };
      toast.success(initial ? "Oportunidad guardada." : "Oportunidad creada.");
      router.push(`/crm/opportunities/${saved.id}`);
      router.refresh();
    } catch (error) {
      setFormError(errorMessage(error, "No se pudo guardar la oportunidad."));
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" data-testid="opportunity-form" noValidate onSubmit={submit}>
      <div className="grid gap-3 md:grid-cols-2">
        <AccessibleField className="md:col-span-2" error={errors.title} id="opportunity-title" label="Título" required>
          <Input autoFocus={!initial} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="Qué quiere el cliente" value={title} />
        </AccessibleField>
        <AccessibleField helperText="Si aún no es cliente, deja «Contacto nuevo» y escribe sus datos: podrás darlo de alta después." id="opportunity-customer" label="Cliente">
          <Select onChange={(event) => setCustomerId(event.target.value)} value={customerId}>
            <option value={NEW_CONTACT}>Contacto nuevo (aún sin ficha)</option>
            {customers.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField error={errors.amount} helperText="Lo que esperas facturar (sin IVA)." id="opportunity-amount" label="Importe estimado">
          <MoneyInput currencySymbol={currencySymbol} onChange={(event) => setAmount(event.target.value)} value={amount} />
        </AccessibleField>
        <AccessibleField error={errors.contactName} id="opportunity-contact-name" label="Persona de contacto" required={!customerId}>
          <Input maxLength={200} onChange={(event) => setContactName(event.target.value)} value={contactName} />
        </AccessibleField>
        <div className="grid gap-3 sm:grid-cols-2">
          <AccessibleField id="opportunity-contact-email" label="Email">
            <Input inputMode="email" onChange={(event) => setContactEmail(event.target.value)} type="email" value={contactEmail} />
          </AccessibleField>
          <AccessibleField id="opportunity-contact-phone" label="Teléfono">
            <Input inputMode="tel" onChange={(event) => setContactPhone(event.target.value)} type="tel" value={contactPhone} />
          </AccessibleField>
        </div>
        {!initial ? (
          <AccessibleField id="opportunity-stage" label="Etapa">
            <Select onChange={(event) => setStageId(event.target.value)} value={stageId}>
              {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name} ({stage.probability} %)</option>)}
            </Select>
          </AccessibleField>
        ) : null}
        <AccessibleField id="opportunity-close-date" label="Cierre previsto">
          <Input onChange={(event) => setExpectedCloseDate(event.target.value)} type="date" value={expectedCloseDate} />
        </AccessibleField>
        <AccessibleField id="opportunity-owner" label="Responsable">
          <Select onChange={(event) => setOwnerUserId(event.target.value)} value={ownerUserId}>
            {team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField id="opportunity-source" label="Origen">
          <Select onChange={(event) => setSource(event.target.value)} value={source}>
            <option value="">Sin indicar</option>
            {CRM_SOURCES.map((entry) => <option key={entry} value={entry}>{crmSourceLabels[entry]}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField className="md:col-span-2" id="opportunity-notes" label="Notas">
          <Textarea maxLength={5000} onChange={(event) => setNotes(event.target.value)} rows={3} value={notes} />
        </AccessibleField>
      </div>
      {formError ? <FormErrorMessage>{formError}</FormErrorMessage> : null}
      <FormActions>
        <SubmitButton data-testid="opportunity-save" pending={pending}>{initial ? "Guardar cambios" : "Crear oportunidad"}</SubmitButton>
      </FormActions>
    </form>
  );
}

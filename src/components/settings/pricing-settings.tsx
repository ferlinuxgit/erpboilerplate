"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatPercent, parseDecimalInput } from "@/lib/format";

export type PriceListRow = { id: string; code: string; name: string; adjustmentPct: number; isActive: boolean; itemCount: number };
export type CustomerGroupRow = { id: string; code: string; name: string; priceListId: string | null; priceListName: string | null; discountPct: number; customerCount: number };

const panelClass = "space-y-2 border border-window-dark-shadow bg-window-panel p-2.5 shadow-bevel-top";
const listClass = "divide-y divide-window-shadow border border-window-shadow bg-card px-2.5";

async function send(url: string, method: string, payload: unknown, fallback: string) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...getCsrfHeader() },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  if (!response.ok) throw new Error(await readApiError(response, fallback));
  return response.json().catch(() => null);
}

/** "−10" / "-10,5" / "" → número (vacío = 0). null si no es un número. */
function percentValue(text: string) {
  if (!text.trim()) return 0;
  return parseDecimalInput(text.replace("−", "-"));
}

function adjustmentLabel(value: number) {
  if (value === 0) return "Precio de venta";
  return `${value > 0 ? "+" : "−"}${formatPercent(Math.abs(value))} sobre el precio de venta`;
}

/* --------------------------------------------------------------------------- Tarifas */

export function PriceListsPanel({ lists }: { lists: PriceListRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState({ code: "", name: "", adjustment: "" });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const adjustmentPct = percentValue(draft.adjustment);
    const nextErrors = {
      code: /^[A-Za-z0-9-]{1,12}$/.test(draft.code.trim()) ? undefined : "Usa de 1 a 12 letras, números o guiones (p. ej. MAY).",
      name: draft.name.trim() ? undefined : "Indica el nombre de la tarifa.",
      adjustment: adjustmentPct === null || adjustmentPct < -100 || adjustmentPct > 1000 ? "Indica un porcentaje entre −100 y 1000." : undefined,
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;
    setSaving(true);
    setFormError(null);
    try {
      const created = (await send("/api/price-lists", "POST", { code: draft.code.trim(), name: draft.name.trim(), adjustmentPct }, "No se pudo crear la tarifa.")) as { id: string } | null;
      toast.success(`Tarifa «${draft.name.trim()}» creada. Ahora pon los precios de los artículos.`);
      setDraft({ code: "", name: "", adjustment: "" });
      if (created?.id) router.push(`/settings/pricing/${created.id}`);
      else router.refresh();
    } catch (error) {
      setFormError(errorMessage(error, "No se pudo crear la tarifa."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Tarifas de precios" className={panelClass}>
      {lists.length ? (
        <ul className={listClass} data-testid="price-lists">
          {lists.map((list) => (
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" key={list.id}>
              <span className="font-mono text-xs font-bold">{list.code}</span>
              <span className="min-w-0 flex-1 font-bold">{list.name}{list.isActive ? "" : " (desactivada)"}</span>
              <span className="text-xs text-muted-foreground">
                {list.itemCount === 1 ? "1 precio propio" : `${list.itemCount} precios propios`} · resto: {adjustmentLabel(list.adjustmentPct).toLowerCase()}
              </span>
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/settings/pricing/${list.id}`}>Editar precios</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Todavía no hay tarifas: todos los clientes pagan el precio de venta de cada artículo.</p>
      )}
      <form className="grid gap-2 md:grid-cols-[8rem_1fr_12rem_auto] md:items-start" noValidate onSubmit={create}>
        <AccessibleField error={errors.code} id="price-list-new-code" label="Código" required>
          <Input className="font-mono uppercase" id="price-list-new-code" maxLength={12} onChange={(event) => setDraft({ ...draft, code: event.target.value })} placeholder="MAY" value={draft.code} />
        </AccessibleField>
        <AccessibleField error={errors.name} id="price-list-new-name" label="Nombre" required>
          <Input id="price-list-new-name" maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Mayoristas" value={draft.name} />
        </AccessibleField>
        <AccessibleField error={errors.adjustment} helperText="Para los artículos sin precio propio. −10 = 10 % más barato." id="price-list-new-adjustment" label="Ajuste general (%)">
          <Input id="price-list-new-adjustment" inputMode="decimal" onChange={(event) => setDraft({ ...draft, adjustment: event.target.value })} placeholder="0" value={draft.adjustment} />
        </AccessibleField>
        <div className="md:pt-5"><SubmitButton pending={saving} pendingLabel="Creando…">Crear tarifa</SubmitButton></div>
      </form>
      <FormErrorMessage>{formError}</FormErrorMessage>
    </section>
  );
}

/* ----------------------------------------------------------------- Grupos de clientes */

type GroupDraft = { name: string; priceListId: string; discount: string };

function GroupRow({ group, lists }: { group: CustomerGroupRow; lists: PriceListRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<GroupDraft>({ name: group.name, priceListId: group.priceListId ?? "", discount: group.discountPct ? String(group.discountPct).replace(".", ",") : "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = draft.name !== group.name || draft.priceListId !== (group.priceListId ?? "") || percentValue(draft.discount) !== group.discountPct;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const discountPct = percentValue(draft.discount);
    if (!draft.name.trim()) return setError("Indica el nombre del grupo.");
    if (discountPct === null || discountPct < 0 || discountPct > 100) return setError("El descuento debe estar entre 0 y 100 %.");
    setSaving(true);
    setError(null);
    try {
      await send(`/api/customer-groups/${group.id}`, "PATCH", { name: draft.name.trim(), priceListId: draft.priceListId || null, discountPct }, "No se pudo guardar el grupo.");
      toast.success(`Grupo «${draft.name.trim()}» guardado.`);
      router.refresh();
    } catch (saveError) {
      setError(errorMessage(saveError, "No se pudo guardar el grupo."));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await send(`/api/customer-groups/${group.id}`, "DELETE", undefined, "No se pudo borrar el grupo.");
      toast.success(`Grupo «${group.name}» borrado.`);
      setConfirmDelete(false);
      router.refresh();
    } catch (deleteError) {
      setError(errorMessage(deleteError, "No se pudo borrar el grupo."));
    } finally {
      setSaving(false);
    }
  }

  const prefix = `group-${group.code}`;
  return (
    <li className="py-2" data-testid={`customer-group-${group.code}`}>
      <form className="grid gap-2 md:grid-cols-[5rem_1fr_1fr_9rem_auto] md:items-end" noValidate onSubmit={save}>
        <div className="space-y-1">
          <p className="font-mono text-xs font-bold">{group.code}</p>
          <p className="text-xs text-muted-foreground">{group.customerCount === 1 ? "1 cliente" : `${group.customerCount} clientes`}</p>
        </div>
        <AccessibleField id={`${prefix}-name`} label="Nombre">
          <Input id={`${prefix}-name`} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name} />
        </AccessibleField>
        <AccessibleField id={`${prefix}-list`} label="Tarifa">
          <Select id={`${prefix}-list`} onChange={(event) => setDraft({ ...draft, priceListId: event.target.value })} value={draft.priceListId}>
            <option value="">Precio de venta</option>
            {lists.map((list) => <option key={list.id} value={list.id}>{list.name}{list.isActive ? "" : " (desactivada)"}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField id={`${prefix}-discount`} label="Descuento (%)">
          <Input id={`${prefix}-discount`} inputMode="decimal" onChange={(event) => setDraft({ ...draft, discount: event.target.value })} placeholder="0" value={draft.discount} />
        </AccessibleField>
        <div className="flex gap-2">
          <SubmitButton disabled={!dirty} pending={saving} pendingLabel="Guardando…" size="sm">Guardar</SubmitButton>
          <Button onClick={() => setConfirmDelete(true)} size="sm" type="button" variant="ghost">Borrar</Button>
        </div>
      </form>
      <FormErrorMessage>{error}</FormErrorMessage>
      <DestructiveActionDialog
        confirmLabel="Borrar grupo"
        description={group.customerCount ? `Sus ${group.customerCount} cliente(s) se quedarán sin grupo: dejarán de tener su tarifa y su descuento. Las facturas ya hechas no cambian.` : "No tiene clientes. Las facturas ya hechas no cambian."}
        isSubmitting={saving}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
        open={confirmDelete}
        title={`¿Borrar el grupo «${group.name}»?`}
      />
    </li>
  );
}

export function CustomerGroupsPanel({ groups, lists }: { groups: CustomerGroupRow[]; lists: PriceListRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState({ code: "", name: "", priceListId: "", discount: "" });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const discountPct = percentValue(draft.discount);
    const nextErrors = {
      code: /^[A-Za-z0-9-]{1,12}$/.test(draft.code.trim()) ? undefined : "Usa de 1 a 12 letras, números o guiones (p. ej. DIST).",
      name: draft.name.trim() ? undefined : "Indica el nombre del grupo.",
      discount: discountPct === null || discountPct < 0 || discountPct > 100 ? "El descuento debe estar entre 0 y 100 %." : undefined,
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;
    setSaving(true);
    setFormError(null);
    try {
      await send("/api/customer-groups", "POST", { code: draft.code.trim(), name: draft.name.trim(), priceListId: draft.priceListId || null, discountPct }, "No se pudo crear el grupo.");
      toast.success(`Grupo «${draft.name.trim()}» creado. Asígnalo en la ficha de cada cliente.`);
      setDraft({ code: "", name: "", priceListId: "", discount: "" });
      router.refresh();
    } catch (error) {
      setFormError(errorMessage(error, "No se pudo crear el grupo."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Grupos de clientes" className={panelClass}>
      {groups.length ? (
        <ul className={listClass} data-testid="customer-groups">
          {groups.map((group) => <GroupRow group={group} key={`${group.id}-${group.name}-${group.priceListId}-${group.discountPct}`} lists={lists} />)}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Todavía no hay grupos. Crea uno (p. ej. «Distribuidores») y asígnalo en la ficha de cada cliente.</p>
      )}
      <form className="grid gap-2 md:grid-cols-[8rem_1fr_1fr_9rem_auto] md:items-start" noValidate onSubmit={create}>
        <AccessibleField error={errors.code} id="group-new-code" label="Código" required>
          <Input className="font-mono uppercase" id="group-new-code" maxLength={12} onChange={(event) => setDraft({ ...draft, code: event.target.value })} placeholder="DIST" value={draft.code} />
        </AccessibleField>
        <AccessibleField error={errors.name} id="group-new-name" label="Nombre" required>
          <Input id="group-new-name" maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Distribuidores" value={draft.name} />
        </AccessibleField>
        <AccessibleField id="group-new-list" label="Tarifa">
          <Select id="group-new-list" onChange={(event) => setDraft({ ...draft, priceListId: event.target.value })} value={draft.priceListId}>
            <option value="">Precio de venta</option>
            {lists.filter((list) => list.isActive).map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField error={errors.discount} id="group-new-discount" label="Descuento (%)">
          <Input id="group-new-discount" inputMode="decimal" onChange={(event) => setDraft({ ...draft, discount: event.target.value })} placeholder="0" value={draft.discount} />
        </AccessibleField>
        <div className="md:pt-5"><SubmitButton pending={saving} pendingLabel="Creando…">Crear grupo</SubmitButton></div>
      </form>
      <FormErrorMessage>{formError}</FormErrorMessage>
    </section>
  );
}

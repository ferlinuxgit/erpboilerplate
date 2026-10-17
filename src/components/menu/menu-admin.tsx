"use client";

import { ArrowDown, ArrowUp, Camera, Copy, NotePencil, Plus, Prohibit, Trash, Warning } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { postJson } from "@/components/hospitality/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { slugify, WEEKDAY_LABELS } from "@/modules/hospitality/bookings";
import { ALLERGENS, dietConflicts, MENU_TAGS, scheduleLabel } from "@/modules/hospitality/menu";
import type { MenuAdmin as MenuAdminData } from "@/server/pos/menu";

import { AllergenIcon, TagBadge } from "./allergen-icons";

type Section = MenuAdminData["sections"][number];
type Dish = MenuAdminData["items"][number];
type Filter = "ALL" | "IN" | "OUT" | "SOLD_OUT" | "UNREVIEWED";
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function useRun() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function run(work: () => Promise<unknown>, success: string | null) {
    setPending(true);
    try {
      await work();
      if (success) toast.success(success);
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar.");
      return false;
    } finally {
      setPending(false);
    }
  }
  return { run, pending };
}

/** Publicación de la carta: dirección, textos, enlace a reservas, QR general y código para la web. */
export function MenuPublishing({ baseUrl, canManage, qrDataUrl, settings }: { baseUrl: string; canManage: boolean; qrDataUrl: string | null; settings: MenuAdminData["settings"] }) {
  const { run, pending } = useRun();
  const [data, setData] = useState(settings);
  const disabled = !canManage || pending;
  const url = `${baseUrl}/carta/${slugify(data.slug) || "…"}`;
  const embed = `<iframe src="${url}?embed=1" title="Carta" style="width:100%;max-width:820px;height:1200px;border:0" loading="lazy"></iframe>`;
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado.`);
    } catch {
      toast.error("No se pudo copiar: selecciónalo y cópialo a mano.");
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]" data-testid="menu-publishing">
      <div className="space-y-3">
        <label className={cn("flex items-start gap-2 border-2 p-3 text-sm", data.enabled ? "border-success bg-success/10" : "border-window-shadow bg-window-panel")}>
          <input checked={data.enabled} className="mt-0.5 size-4" data-testid="menu-enabled" disabled={disabled} onChange={(event) => setData({ ...data, enabled: event.target.checked })} type="checkbox" />
          <span><span className="font-medium">Publicar la carta</span><span className="block text-xs text-muted-foreground">Cualquiera con el enlace o el QR la ve, sin registrarse.</span></span>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Dirección
          <span className="flex flex-wrap items-center gap-1">
            <span className="font-mono text-xs text-muted-foreground">{baseUrl}/carta/</span>
            <Input aria-label="Dirección de la carta" className="h-11 w-56" data-testid="menu-slug" disabled={disabled} maxLength={48} onBlur={() => setData({ ...data, slug: slugify(data.slug) })} onChange={(event) => setData({ ...data, slug: event.target.value })} value={data.slug} />
          </span>
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">Bienvenida<Textarea disabled={disabled} maxLength={600} onChange={(event) => setData({ ...data, intro: event.target.value })} placeholder="Cocina abierta de 13:00 a 16:00 y de 20:00 a 23:30." rows={3} value={data.intro ?? ""} /></label>
          <label className="grid gap-1 text-sm font-medium">En inglés (opcional)<Textarea disabled={disabled} maxLength={600} onChange={(event) => setData({ ...data, introEn: event.target.value })} placeholder="Kitchen open 1–4 pm and 8–11:30 pm." rows={3} value={data.introEn ?? ""} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input checked={data.showBookingLink} disabled={disabled} onChange={(event) => setData({ ...data, showBookingLink: event.target.checked })} type="checkbox" /> Botón «Reservar mesa» (si las reservas online están activas)</label>
        <div className="flex flex-wrap gap-2">
          {canManage ? <Button className="h-11" data-testid="menu-settings-save" disabled={pending} onClick={() => void run(() => postJson("/api/pos/menu/settings", { ...data, slug: slugify(data.slug) }, "PUT"), data.enabled ? "Carta publicada." : "Carta guardada.")} type="button">Guardar</Button> : null}
          <Button className="h-11" onClick={() => void copy(url, "Enlace")} type="button" variant="outline"><Copy aria-hidden="true" /> Copiar enlace</Button>
          <Button className="h-11" onClick={() => void copy(embed, "Código")} type="button" variant="outline"><Copy aria-hidden="true" /> Código para tu web</Button>
          {settings.enabled ? <a className="inline-flex h-11 items-center px-2 font-mono text-sm font-bold text-link underline" href={url} rel="noreferrer" target="_blank">Ver la carta</a> : null}
        </div>
      </div>
      {qrDataUrl ? (
        <figure className="justify-self-start text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- QR generado en el servidor */}
          <img alt={`Código QR de la carta: ${url}`} className="size-36 border border-window-dark-shadow bg-white p-1" src={qrDataUrl} />
          <figcaption className="mt-1 space-x-2 text-xs"><a className="text-link underline" download="carta-qr.png" href={qrDataUrl}>Descargar</a><a className="text-link underline" href="/pos/menu/qr" target="_blank">QR por mesa</a><a className="text-link underline" href="/pos/menu/alergenos" target="_blank">Tabla de alérgenos</a></figcaption>
        </figure>
      ) : null}
    </div>
  );
}

/** Secciones con horario (desayunos, menú del día…) y precio cerrado opcional. */
export function MenuSections({ canManage, sections }: { canManage: boolean; sections: Section[] }) {
  const { run, pending } = useRun();
  const [editing, setEditing] = useState<Section | "new" | null>(null);
  return (
    <div className="space-y-3" data-testid="menu-sections">
      {sections.length === 0 ? (
        <div className="space-y-2 border border-dashed border-window-shadow p-3 text-sm">
          <p>Aún no hay secciones. Lo más rápido: crear una por cada categoría de artículos y añadir todos sus artículos a la carta.</p>
          {canManage ? <Button className="h-11" data-testid="menu-import" disabled={pending} onClick={() => void run(async () => { const result = await postJson<{ sections: number; dishes: number }>("/api/pos/menu/import", {}); toast.success(`${result.sections} secciones y ${result.dishes} platos añadidos.`); }, null)} type="button">Crear desde las categorías</Button> : null}
        </div>
      ) : (
        <ul className="divide-y divide-window-shadow border border-window-shadow">
          {sections.map((section, index) => {
            const schedule = scheduleLabel(section, "es");
            return (
              <li className={cn("flex flex-wrap items-center gap-2 p-2", !section.isActive && "opacity-60")} data-testid={`menu-section-${section.name}`} key={section.id}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{section.name}{section.nameEn ? <span className="font-normal text-muted-foreground"> · {section.nameEn}</span> : null}</p>
                  <p className="text-xs text-muted-foreground">{[schedule ?? "Siempre", section.fixedPrice !== null ? `Precio cerrado ${formatMoney(section.fixedPrice)}` : null, section.isActive ? null : "Oculta"].filter(Boolean).join(" · ")}</p>
                </div>
                {canManage ? (
                  <span className="flex gap-1">
                    <Button aria-label={`Subir ${section.name}`} disabled={pending || index === 0} onClick={() => void run(() => postJson(`/api/pos/menu/sections/${section.id}/move`, { direction: "up" }), null)} size="icon-sm" type="button" variant="ghost"><ArrowUp aria-hidden="true" /></Button>
                    <Button aria-label={`Bajar ${section.name}`} disabled={pending || index === sections.length - 1} onClick={() => void run(() => postJson(`/api/pos/menu/sections/${section.id}/move`, { direction: "down" }), null)} size="icon-sm" type="button" variant="ghost"><ArrowDown aria-hidden="true" /></Button>
                    <Button aria-label={`Editar ${section.name}`} disabled={pending} onClick={() => setEditing(section)} size="icon-sm" type="button" variant="ghost"><NotePencil aria-hidden="true" /></Button>
                    <Button aria-label={`Borrar ${section.name}`} disabled={pending} onClick={() => { if (window.confirm(`¿Borrar la sección «${section.name}»? Sus platos quedan sin sección.`)) void run(() => postJson(`/api/pos/menu/sections/${section.id}`, {}, "DELETE"), "Sección borrada."); }} size="icon-sm" type="button" variant="ghost"><Trash aria-hidden="true" /></Button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {canManage ? <Button className="h-11" data-testid="menu-section-new" onClick={() => setEditing("new")} type="button" variant="outline"><Plus aria-hidden="true" /> Nueva sección</Button> : null}
      {editing ? <SectionDialog onClose={() => setEditing(null)} section={editing === "new" ? null : editing} /> : null}
    </div>
  );
}

function SectionDialog({ onClose, section }: { onClose: () => void; section: Section | null }) {
  const { run, pending } = useRun();
  const [form, setForm] = useState({
    name: section?.name ?? "",
    nameEn: section?.nameEn ?? "",
    description: section?.description ?? "",
    descriptionEn: section?.descriptionEn ?? "",
    weekdays: section?.weekdays ?? [],
    fromTime: section?.fromTime ?? "",
    toTime: section?.toTime ?? "",
    fixedPrice: section?.fixedPrice === null || section?.fixedPrice === undefined ? "" : String(section.fixedPrice).replace(".", ","),
    isActive: section?.isActive ?? true,
  });
  const price = form.fixedPrice.trim() ? Number(form.fixedPrice.replace(",", ".")) : null;
  async function save() {
    const body = { ...form, fixedPrice: price };
    const ok = await run(() => (section ? postJson(`/api/pos/menu/sections/${section.id}`, body, "PATCH") : postJson("/api/pos/menu/sections", body)), section ? "Sección guardada." : "Sección creada.");
    if (ok) onClose();
  }
  return (
    <Dialog onClose={onClose} open title={section ? `Sección ${section.name}` : "Nueva sección"}>
      <div className="max-h-[75dvh] space-y-3 overflow-y-auto pr-1" data-testid="menu-section-dialog">
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-sm font-medium">Nombre<Input className="h-11" maxLength={60} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Entrantes, Menú del día…" value={form.name} /></label>
          <label className="grid gap-1 text-sm font-medium">En inglés<Input className="h-11" maxLength={60} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} placeholder="Starters" value={form.nameEn} /></label>
        </div>
        <label className="grid gap-1 text-sm font-medium">Descripción<Textarea maxLength={300} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Primero, segundo, postre, pan y bebida." rows={2} value={form.description} /></label>
        <label className="grid gap-1 text-sm font-medium">Descripción en inglés<Textarea maxLength={300} onChange={(event) => setForm({ ...form, descriptionEn: event.target.value })} rows={2} value={form.descriptionEn} /></label>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Se sirve <span className="font-normal text-muted-foreground">(sin días ni horas = siempre)</span></legend>
          <div className="flex flex-wrap gap-1">
            {WEEK_ORDER.map((day) => {
              const active = form.weekdays.includes(day);
              return <button aria-pressed={active} className={cn("h-10 w-12 border-2 font-mono text-xs font-bold", active ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} key={day} onClick={() => setForm({ ...form, weekdays: active ? form.weekdays.filter((value) => value !== day) : [...form.weekdays, day] })} type="button">{WEEKDAY_LABELS[day].slice(0, 3)}</button>;
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            de <Input aria-label="Desde" className="h-11 w-32" onChange={(event) => setForm({ ...form, fromTime: event.target.value })} type="time" value={form.fromTime} />
            a <Input aria-label="Hasta" className="h-11 w-32" onChange={(event) => setForm({ ...form, toTime: event.target.value })} type="time" value={form.toTime} />
          </div>
        </fieldset>
        <label className="grid gap-1 text-sm font-medium">
          Precio cerrado (opcional)
          <Input className="h-11 w-36" inputMode="decimal" onChange={(event) => setForm({ ...form, fixedPrice: event.target.value.replace(/[^\d,.]/g, "") })} placeholder="14,50" value={form.fixedPrice} />
          <span className="text-xs font-normal text-muted-foreground">Para menús: la sección muestra este precio por persona y los platos, sin precio.</span>
        </label>
        <label className="flex items-center gap-2 text-sm"><input checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} type="checkbox" /> Visible en la carta</label>
        <Button className="h-12 w-full" data-testid="menu-section-save" disabled={pending || !form.name.trim() || (price !== null && Number.isNaN(price))} onClick={() => void save()} type="button">Guardar</Button>
      </div>
    </Dialog>
  );
}

/** Platos: qué sale en la carta, en qué sección, alérgenos, foto y agotados del día. */
export function MenuDishes({ canManage, items, sections }: { canManage: boolean; items: Dish[]; sections: Section[] }) {
  const { run, pending } = useRun();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Dish | null>(null);
  const normalized = query.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const visible = items.filter((dish) => {
    if (filter === "IN" && !dish.visible) return false;
    if (filter === "OUT" && dish.visible) return false;
    if (filter === "SOLD_OUT" && !dish.soldOut) return false;
    if (filter === "UNREVIEWED" && (!dish.visible || dish.reviewed)) return false;
    return !normalized || `${dish.name} ${dish.displayName ?? ""} ${dish.sku}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(normalized);
  });
  const groups = [
    ...sections.map((section) => ({ id: section.id, title: section.name, dishes: visible.filter((dish) => dish.visible && dish.sectionId === section.id) })),
    { id: "none", title: "En la carta, sin sección", dishes: visible.filter((dish) => dish.visible && (!dish.sectionId || !sections.some((section) => section.id === dish.sectionId))) },
    { id: "out", title: "No salen en la carta", dishes: visible.filter((dish) => !dish.visible) },
  ].filter((group) => group.dishes.length > 0);
  const counts = { ALL: items.length, IN: items.filter((dish) => dish.visible).length, OUT: items.filter((dish) => !dish.visible).length, SOLD_OUT: items.filter((dish) => dish.soldOut).length, UNREVIEWED: items.filter((dish) => dish.visible && !dish.reviewed).length };
  const conflicted = items.filter((dish) => dish.visible && dish.conflicts.length > 0).length;

  return (
    <div className="space-y-3" data-testid="menu-dishes">
      <div className="flex flex-wrap items-center gap-2">
        <div aria-label="Filtro" className="flex flex-wrap gap-1" role="radiogroup">
          {([["ALL", "Todos"], ["IN", "En la carta"], ["OUT", "Fuera"], ["SOLD_OUT", "Agotados hoy"], ["UNREVIEWED", "Sin revisar alérgenos"]] as const).map(([value, label]) => (
            <button aria-checked={filter === value} className={cn("h-10 border-2 px-3 font-mono text-xs font-bold", filter === value ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} key={value} onClick={() => setFilter(value)} role="radio" type="button">{label} ({counts[value]})</button>
          ))}
        </div>
        <Input aria-label="Buscar artículo" className="h-10 w-full sm:w-56" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar…" type="search" value={query} />
      </div>
      {counts.UNREVIEWED > 0 || conflicted > 0 ? (
        <p className="flex flex-wrap items-center gap-2 border-2 border-warning bg-warning/10 p-2 text-sm" data-testid="menu-allergen-alert" role="status">
          <Warning aria-hidden="true" className="size-5 shrink-0 text-warning-text" weight="fill" />
          {counts.UNREVIEWED > 0 ? <span><strong>{counts.UNREVIEWED}</strong> {counts.UNREVIEWED === 1 ? "plato de la carta sin revisar alérgenos" : "platos de la carta sin revisar alérgenos"}: el cliente verá «Pregunta por sus alérgenos». Abre su ficha y guárdala.</span> : null}
          {conflicted > 0 ? <span><strong>{conflicted}</strong> con la dieta incoherente (p. ej. vegano con huevo).</span> : null}
        </p>
      ) : null}
      {items.length === 0 ? <p className="text-sm text-muted-foreground">Crea artículos (Inventario → Artículos) con su precio para poder ponerlos en la carta.</p> : null}
      {groups.map((group) => (
        <section className="space-y-1" key={group.id}>
          <h3 className="font-mono text-xs font-bold uppercase text-muted-foreground">{group.title} · {group.dishes.length}</h3>
          <ul className="divide-y divide-window-shadow border border-window-shadow">
            {group.dishes.map((dish) => (
              <li className={cn("flex flex-wrap items-center gap-2 p-2", dish.soldOut && "bg-destructive/5")} data-testid={`menu-dish-${dish.name}`} key={dish.itemId}>
                {dish.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- miniatura de la foto propia
                  <img alt="" className="size-12 border border-window-shadow object-cover" height={48} loading="lazy" src={dish.imageUrl} width={48} />
                ) : <span aria-hidden="true" className="grid size-12 place-items-center border border-dashed border-window-shadow text-muted-foreground"><Camera className="size-5" /></span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{dish.displayName ?? dish.name} <span className="font-mono text-sm font-normal tabular-nums">{formatMoney(dish.price)}</span></p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {dish.tags.map((id) => <TagBadge compact id={id} key={id} />)}
                    {dish.allergens.map((id) => <AllergenIcon id={id} key={id} size="sm" />)}
                    {dish.traces.map((id) => <AllergenIcon id={id} key={`t-${id}`} size="sm" variant="traces" />)}
                    {dish.visible && !dish.reviewed ? <span className="rounded-full border border-warning px-1.5 font-semibold text-warning-text" data-testid="menu-dish-unreviewed">Sin revisar</span> : dish.reviewed && dish.allergens.length === 0 && dish.traces.length === 0 ? <span>Sin alérgenos</span> : null}
                    {dish.conflicts.length > 0 ? <span className="rounded-full bg-destructive px-1.5 font-semibold text-destructive-foreground" title={dish.conflicts.join(" ")}>Dieta incoherente</span> : null}
                    {dish.nameEn ? <span className="font-mono">EN</span> : null}
                  </p>
                </div>
                <span className="flex flex-wrap items-center gap-1">
                  {canManage ? <label className="flex h-10 items-center gap-1.5 px-1 text-sm"><input checked={dish.visible} data-testid="menu-dish-visible" disabled={pending} onChange={(event) => void run(() => postJson(`/api/pos/menu/items/${dish.itemId}/visible`, { visible: event.target.checked }), null)} type="checkbox" /> En carta</label> : null}
                  <Button className="h-10" data-testid="menu-dish-sold-out" disabled={pending} onClick={() => void run(() => postJson(`/api/pos/menu/items/${dish.itemId}/sold-out`, { soldOut: !dish.soldOut }), dish.soldOut ? `${dish.name}: disponible de nuevo.` : `${dish.name}: agotado hoy.`)} type="button" variant={dish.soldOut ? "destructive" : "outline"}><Prohibit aria-hidden="true" /> {dish.soldOut ? "Agotado" : "Agotar"}</Button>
                  {canManage ? <Button aria-label={`Editar ${dish.name}`} className="h-10" data-testid="menu-dish-edit" disabled={pending} onClick={() => setEditing(dish)} type="button" variant="ghost"><NotePencil aria-hidden="true" /> Ficha</Button> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {editing ? <DishDialog dish={editing} onClose={() => setEditing(null)} sections={sections} /> : null}
    </div>
  );
}

/** Reduce la foto en el navegador (lado mayor 900 px, JPEG) para que la carta cargue rápido. */
async function compressImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const data = canvas.toDataURL("image/jpeg", quality);
    if (data.length * 0.75 < 420_000) return data;
  }
  throw new Error("La foto es demasiado grande incluso comprimida.");
}

function DishDialog({ dish, onClose, sections }: { dish: Dish; onClose: () => void; sections: Section[] }) {
  const { run, pending } = useRun();
  const [form, setForm] = useState({
    sectionId: dish.sectionId ?? "",
    visible: dish.visible || !dish.sectionId,
    displayName: dish.displayName ?? "",
    nameEn: dish.nameEn ?? "",
    description: dish.description ?? "",
    descriptionEn: dish.descriptionEn ?? "",
    allergens: dish.allergens,
    traces: dish.traces,
    tags: dish.tags,
  });
  const toggleTag = (id: string) => setForm((current) => ({ ...current, tags: current.tags.includes(id) ? current.tags.filter((value) => value !== id) : [...current.tags, id] }));
  // Cada toque: no lo lleva → lo lleva → puede contener trazas → no lo lleva.
  const cycleAllergen = (id: string) => setForm((current) => {
    if (current.allergens.includes(id)) return { ...current, allergens: current.allergens.filter((value) => value !== id), traces: [...current.traces, id] };
    if (current.traces.includes(id)) return { ...current, traces: current.traces.filter((value) => value !== id) };
    return { ...current, allergens: [...current.allergens, id] };
  });
  const conflicts = dietConflicts(form.allergens, form.tags, form.traces);

  async function upload(file: File | undefined) {
    if (!file) return;
    await run(async () => postJson(`/api/pos/menu/items/${dish.itemId}/image`, { image: await compressImage(file) }, "PUT"), "Foto guardada.");
  }

  return (
    <Dialog onClose={onClose} open title={dish.name}>
      <div className="max-h-[75dvh] space-y-3 overflow-y-auto pr-1" data-testid="menu-dish-dialog">
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-sm font-medium">Nombre en la carta<Input className="h-11" maxLength={80} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder={dish.name} value={form.displayName} /></label>
          <label className="grid gap-1 text-sm font-medium">En inglés<Input className="h-11" maxLength={80} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} value={form.nameEn} /></label>
        </div>
        <label className="grid gap-1 text-sm font-medium">Descripción<Textarea maxLength={400} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Ingredientes, punto, ración…" rows={2} value={form.description} /></label>
        <label className="grid gap-1 text-sm font-medium">Descripción en inglés<Textarea maxLength={400} onChange={(event) => setForm({ ...form, descriptionEn: event.target.value })} rows={2} value={form.descriptionEn} /></label>
        <label className="grid gap-1 text-sm font-medium">
          Sección
          <select className="h-11 border border-input bg-window-surface px-2 text-sm" onChange={(event) => setForm({ ...form, sectionId: event.target.value })} value={form.sectionId}>
            <option value="">Sin sección («Otros»)</option>
            {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
          </select>
        </label>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Alérgenos</legend>
          <p className="text-xs text-muted-foreground">Toca una vez si lo lleva, otra si solo puede contener trazas y otra para quitarlo.</p>
          <div className="grid grid-cols-4 gap-1 sm:grid-cols-7">
            {ALLERGENS.map((allergen) => {
              const state = form.allergens.includes(allergen.id) ? "contains" : form.traces.includes(allergen.id) ? "traces" : "off";
              return (
                <button aria-label={`${allergen.es}: ${state === "contains" ? "lo lleva" : state === "traces" ? "trazas" : "no lo lleva"}`} aria-pressed={state !== "off"} className={cn("flex flex-col items-center gap-0.5 rounded-md border-2 px-0.5 py-1 text-[11px] font-semibold leading-tight", state === "contains" ? "bg-window-highlight" : state === "traces" ? "border-dashed" : "border-transparent text-muted-foreground")} data-state={state} data-testid={`menu-allergen-${allergen.id}`} key={allergen.id} onClick={() => cycleAllergen(allergen.id)} style={state !== "off" ? { borderColor: allergen.color } : undefined} type="button">
                  <AllergenIcon decorative id={allergen.id} size="md" variant={state} />
                  {allergen.es}
                  <span className="font-normal">{state === "contains" ? "Lo lleva" : state === "traces" ? "Trazas" : "—"}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Dieta y destacados</legend>
          <div className="flex flex-wrap gap-1.5">
            {MENU_TAGS.map((tag) => {
              const active = form.tags.includes(tag.id);
              return (
                <button aria-pressed={active} className={cn("flex h-10 items-center gap-1.5 rounded-full border-2 py-1 pl-1 pr-3 text-sm font-semibold", active ? "text-white" : "border-window-dark-shadow bg-window-panel")} data-testid={`menu-tag-${tag.id}`} key={tag.id} onClick={() => toggleTag(tag.id)} style={active ? { backgroundColor: tag.color, borderColor: tag.color } : undefined} type="button">
                  <TagBadge compact id={tag.id} />{tag.es}
                </button>
              );
            })}
          </div>
        </fieldset>
        {conflicts.length > 0 ? (
          <ul className="space-y-1 border-2 border-destructive bg-destructive/10 p-2 text-sm font-semibold text-destructive" data-testid="menu-dish-conflicts" role="alert">
            {conflicts.map((conflict) => <li className="flex items-start gap-1" key={conflict}><Warning aria-hidden="true" className="mt-0.5 size-4 shrink-0" weight="fill" />{conflict}</li>)}
          </ul>
        ) : null}
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Foto</legend>
          <div className="flex flex-wrap items-center gap-2">
            {dish.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- vista previa de la foto propia
              <img alt="" className="size-20 border border-window-shadow object-cover" src={dish.imageUrl} />
            ) : null}
            <label className="inline-flex h-11 cursor-pointer items-center gap-1.5 border-2 border-window-dark-shadow bg-window-panel px-3 font-mono text-sm font-bold">
              <Camera aria-hidden="true" className="size-4" /> {dish.imageUrl ? "Cambiar foto" : "Subir foto"}
              <input accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={pending} onChange={(event) => void upload(event.target.files?.[0])} type="file" />
            </label>
            {dish.imageUrl ? <Button className="h-11" disabled={pending} onClick={() => void run(() => postJson(`/api/pos/menu/items/${dish.itemId}/image`, { image: null }, "PUT"), "Foto quitada.")} type="button" variant="ghost"><Trash aria-hidden="true" /> Quitar</Button> : null}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm"><input checked={form.visible} onChange={(event) => setForm({ ...form, visible: event.target.checked })} type="checkbox" /> Mostrar en la carta</label>
        <p className="text-xs text-muted-foreground">El precio es el del TPV con IVA: {formatMoney(dish.price)}. Se cambia en el artículo.</p>
        <Button className="h-12 w-full" data-testid="menu-dish-save" disabled={pending} onClick={() => void run(() => postJson(`/api/pos/menu/items/${dish.itemId}`, { ...form, sectionId: form.sectionId || null }, "PUT"), "Ficha guardada.").then((ok) => ok && onClose())} type="button">Guardar ficha</Button>
      </div>
    </Dialog>
  );
}

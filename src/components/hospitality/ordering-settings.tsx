"use client";

import { NotePencil, Plus, Trash, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { courseLabels } from "@/modules/hospitality/ordering";

import { postJson } from "./types";

export type CatalogEntry = { id: string; name: string; price: number; categoryName: string | null };
type Group = { id: string; name: string; minSelect: number; maxSelect: number; options: Array<{ id: string; name: string; price: number }>; itemIds: string[] };
type SetMenu = { itemId: string; name: string; courses: Array<{ id: string; name: string; course: number; choices: Array<{ itemId: string; name: string; supplement: number }> }> };

const parseAmount = (value: string) => {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const amountText = (value: number) => (value ? String(value).replace(".", ",") : "");

function useRun() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function run(work: () => Promise<unknown>, success: string) {
    setPending(true);
    try {
      await work();
      toast.success(success);
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

/** Selector de artículos con buscador (para asignar modificadores o platos de un menú). */
function ItemPicker({ catalog, exclude = [], label, onChange, selected }: { catalog: CatalogEntry[]; exclude?: string[]; label: string; onChange: (ids: string[]) => void; selected: string[] }) {
  const [query, setQuery] = useState("");
  const normalized = query.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const matches = catalog.filter((entry) => !exclude.includes(entry.id) && !selected.includes(entry.id) && (!normalized || `${entry.name} ${entry.categoryName ?? ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(normalized))).slice(0, 8);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {selected.map((id) => {
          const entry = catalog.find((candidate) => candidate.id === id);
          return <span className="inline-flex items-center gap-1 border border-window-dark-shadow bg-window-panel py-0.5 pl-2 pr-0.5 text-sm" key={id}>{entry?.name ?? "?"}<button aria-label={`Quitar ${entry?.name ?? ""}`} className="grid size-7 place-items-center hover:bg-window-highlight" onClick={() => onChange(selected.filter((value) => value !== id))} type="button"><X aria-hidden="true" className="size-3.5" /></button></span>;
        })}
      </div>
      <Input aria-label={label} className="h-10" onChange={(event) => setQuery(event.target.value)} placeholder={`${label}…`} type="search" value={query} />
      {normalized ? (
        <ul className="divide-y divide-window-shadow border border-window-shadow">
          {matches.length === 0 ? <li className="p-2 text-sm text-muted-foreground">Sin resultados.</li> : matches.map((entry) => (
            <li key={entry.id}><button className="flex w-full items-center justify-between gap-2 p-2 text-left text-sm hover:bg-window-highlight" onClick={() => { onChange([...selected, entry.id]); setQuery(""); }} type="button"><span>{entry.name}{entry.categoryName ? <span className="text-muted-foreground"> · {entry.categoryName}</span> : null}</span><Plus aria-hidden="true" className="size-4" /></button></li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Grupos de modificadores: punto de la carne, guarnición, extras… y qué productos los piden. */
export function ModifierGroupsEditor({ canManage, catalog, groups }: { canManage: boolean; catalog: CatalogEntry[]; groups: Group[] }) {
  const { run, pending } = useRun();
  const [editing, setEditing] = useState<Group | "new" | null>(null);
  const names = new Map(catalog.map((entry) => [entry.id, entry.name]));
  return (
    <div className="space-y-3" data-testid="pos-modifier-groups">
      {groups.length === 0 ? <p className="text-sm text-muted-foreground">Sin modificadores. Ejemplos: «Punto de la carne» (obligatorio: poco hecho, al punto, muy hecho), «Extras» (hasta 3: queso +1 €, bacon +1,50 €).</p> : (
        <ul className="divide-y divide-window-shadow border border-window-shadow">
          {groups.map((group) => (
            <li className="flex flex-wrap items-center gap-2 p-2" data-testid={`pos-modifier-group-${group.name}`} key={group.id}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{group.name} <span className="text-xs font-normal text-muted-foreground">· {group.minSelect > 0 ? "obligatorio" : "opcional"}{group.maxSelect > 1 ? `, hasta ${group.maxSelect}` : ""}</span></p>
                <p className="truncate text-xs text-muted-foreground">{group.options.map((option) => `${option.name}${option.price ? ` (+${formatMoney(option.price)})` : ""}`).join(" · ")}</p>
                <p className="truncate text-xs">{group.itemIds.length > 0 ? `En: ${group.itemIds.map((id) => names.get(id) ?? "?").join(", ")}` : <span className="text-warning-text">Sin productos asignados</span>}</p>
              </div>
              {canManage ? (
                <span className="flex gap-1">
                  <Button aria-label={`Editar ${group.name}`} disabled={pending} onClick={() => setEditing(group)} size="icon-sm" type="button" variant="ghost"><NotePencil aria-hidden="true" /></Button>
                  <Button aria-label={`Borrar ${group.name}`} disabled={pending} onClick={() => { if (window.confirm(`¿Borrar «${group.name}»?`)) void run(() => postJson(`/api/pos/hospitality/modifiers/${group.id}`, {}, "DELETE"), "Grupo borrado."); }} size="icon-sm" type="button" variant="ghost"><Trash aria-hidden="true" /></Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? <Button className="h-11" data-testid="pos-modifier-group-new" onClick={() => setEditing("new")} type="button" variant="outline"><Plus aria-hidden="true" /> Nuevo grupo</Button> : null}
      {editing ? <GroupDialog catalog={catalog} group={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function GroupDialog({ catalog, group, onClose }: { catalog: CatalogEntry[]; group: Group | null; onClose: () => void }) {
  const { run, pending } = useRun();
  const [name, setName] = useState(group?.name ?? "");
  const [required, setRequired] = useState((group?.minSelect ?? 0) > 0);
  const [maxSelect, setMaxSelect] = useState(group?.maxSelect ?? 1);
  const [options, setOptions] = useState<Array<{ name: string; price: string }>>(group?.options.map((option) => ({ name: option.name, price: amountText(option.price) })) ?? [{ name: "", price: "" }, { name: "", price: "" }]);
  const [itemIds, setItemIds] = useState<string[]>(group?.itemIds ?? []);
  const filled = options.filter((option) => option.name.trim());

  async function save() {
    const body = { name, minSelect: required ? 1 : 0, maxSelect: Math.max(1, Math.min(maxSelect, filled.length || 1)), options: filled.map((option) => ({ name: option.name.trim(), price: parseAmount(option.price) })), itemIds };
    if (await run(() => (group ? postJson(`/api/pos/hospitality/modifiers/${group.id}`, body, "PUT") : postJson("/api/pos/hospitality/modifiers", body)), "Modificadores guardados.")) onClose();
  }

  return (
    <Dialog onClose={onClose} open title={group ? group.name : "Nuevo grupo de modificadores"}>
      <div className="max-h-[75dvh] space-y-3 overflow-y-auto pr-1" data-testid="pos-modifier-dialog">
        <label className="grid gap-1 text-sm font-medium">Nombre<Input className="h-11" maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="Punto de la carne, Guarnición, Extras…" value={name} /></label>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm"><input checked={required} className="size-4" onChange={(event) => setRequired(event.target.checked)} type="checkbox" /> Obligatorio</label>
          <label className="flex items-center gap-2 text-sm">Se eligen hasta
            <Input aria-label="Máximo de opciones" className="h-10 w-16 text-center" inputMode="numeric" onChange={(event) => setMaxSelect(Math.max(1, Number(event.target.value.replace(/\D/g, "")) || 1))} value={String(maxSelect)} />
          </label>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Opciones <span className="font-normal text-muted-foreground">(suplemento con IVA, vacío = sin coste)</span></legend>
          {options.map((option, index) => (
            <div className="flex items-center gap-1.5" key={index}>
              <Input aria-label={`Opción ${index + 1}`} className="h-10 flex-1" maxLength={60} onChange={(event) => setOptions(options.map((entry, position) => (position === index ? { ...entry, name: event.target.value } : entry)))} placeholder={index === 0 ? "Al punto" : "Otra opción"} value={option.name} />
              <Input aria-label={`Suplemento de la opción ${index + 1}`} className="h-10 w-24 text-right" inputMode="decimal" onChange={(event) => setOptions(options.map((entry, position) => (position === index ? { ...entry, price: event.target.value.replace(/[^\d,.]/g, "") } : entry)))} placeholder="+0,00" value={option.price} />
              <Button aria-label={`Quitar la opción ${index + 1}`} disabled={options.length <= 1} onClick={() => setOptions(options.filter((_, position) => position !== index))} size="icon-sm" type="button" variant="ghost"><Trash aria-hidden="true" /></Button>
            </div>
          ))}
          <Button className="h-10" onClick={() => setOptions([...options, { name: "", price: "" }])} size="sm" type="button" variant="outline"><Plus aria-hidden="true" /> Opción</Button>
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Productos que lo piden</legend>
          <ItemPicker catalog={catalog} label="Buscar producto" onChange={setItemIds} selected={itemIds} />
        </fieldset>
        <Button className="h-12 w-full" data-testid="pos-modifier-save" disabled={pending || !name.trim() || filled.length === 0} onClick={() => void save()} type="button">Guardar</Button>
      </div>
    </Dialog>
  );
}

/** Menús de precio cerrado: el cliente elige un plato de cada tiempo (con suplementos opcionales). */
export function SetMenusEditor({ canManage, catalog, menus }: { canManage: boolean; catalog: CatalogEntry[]; menus: SetMenu[] }) {
  const { run, pending } = useRun();
  const [editing, setEditing] = useState<{ itemId: string; menu: SetMenu | null } | null>(null);
  const [newItem, setNewItem] = useState("");
  const free = catalog.filter((entry) => !menus.some((menu) => menu.itemId === entry.id));
  return (
    <div className="space-y-3" data-testid="pos-set-menus">
      {menus.length === 0 ? <p className="text-sm text-muted-foreground">Crea primero el artículo del menú con su precio (p. ej. «Menú del día», 14,50 €) y aquí elige qué platos entran en cada tiempo.</p> : (
        <ul className="divide-y divide-window-shadow border border-window-shadow">
          {menus.map((menu) => (
            <li className="flex flex-wrap items-start gap-2 p-2" data-testid={`pos-set-menu-${menu.name}`} key={menu.itemId}>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="font-semibold">{menu.name} <span className="font-mono text-sm font-normal">{formatMoney(catalog.find((entry) => entry.id === menu.itemId)?.price ?? 0)}</span></p>
                {menu.courses.map((course) => <p className="truncate text-xs text-muted-foreground" key={course.id}><span className="font-semibold text-window-text">{course.name}</span>{course.course > 0 ? ` (${courseLabels[course.course]})` : ""}: {course.choices.map((choice) => `${choice.name}${choice.supplement ? ` +${formatMoney(choice.supplement)}` : ""}`).join(", ")}</p>)}
              </div>
              {canManage ? (
                <span className="flex gap-1">
                  <Button aria-label={`Editar ${menu.name}`} disabled={pending} onClick={() => setEditing({ itemId: menu.itemId, menu })} size="icon-sm" type="button" variant="ghost"><NotePencil aria-hidden="true" /></Button>
                  <Button aria-label={`Quitar el menú ${menu.name}`} disabled={pending} onClick={() => { if (window.confirm(`¿Quitar los platos de «${menu.name}»? El artículo se seguirá vendiendo como producto normal.`)) void run(() => postJson(`/api/pos/hospitality/set-menus/${menu.itemId}`, {}, "DELETE"), "Menú quitado."); }} size="icon-sm" type="button" variant="ghost"><Trash aria-hidden="true" /></Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm font-medium">Artículo del menú
            <select className="h-11 w-64 border border-input bg-window-surface px-2 text-sm" data-testid="pos-set-menu-item" onChange={(event) => setNewItem(event.target.value)} value={newItem}>
              <option value="">Elige el artículo…</option>
              {free.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {formatMoney(entry.price)}</option>)}
            </select>
          </label>
          <Button className="h-11" data-testid="pos-set-menu-new" disabled={!newItem} onClick={() => setEditing({ itemId: newItem, menu: null })} type="button" variant="outline"><Plus aria-hidden="true" /> Configurar menú</Button>
        </div>
      ) : null}
      {editing ? <SetMenuDialog catalog={catalog} itemId={editing.itemId} menu={editing.menu} onClose={() => { setEditing(null); setNewItem(""); }} /> : null}
    </div>
  );
}

function SetMenuDialog({ catalog, itemId, menu, onClose }: { catalog: CatalogEntry[]; itemId: string; menu: SetMenu | null; onClose: () => void }) {
  const { run, pending } = useRun();
  const [courses, setCourses] = useState(menu?.courses.map((course) => ({ name: course.name, course: course.course, choices: course.choices.map((choice) => ({ itemId: choice.itemId, supplement: amountText(choice.supplement) })) })) ?? [
    { name: "Primero", course: 1, choices: [] as Array<{ itemId: string; supplement: string }> },
    { name: "Segundo", course: 2, choices: [] as Array<{ itemId: string; supplement: string }> },
    { name: "Postre", course: 4, choices: [] as Array<{ itemId: string; supplement: string }> },
  ]);
  const name = catalog.find((entry) => entry.id === itemId)?.name ?? "Menú";
  const patch = (index: number, change: Partial<(typeof courses)[number]>) => setCourses(courses.map((course, position) => (position === index ? { ...course, ...change } : course)));

  async function save() {
    const body = { courses: courses.filter((course) => course.choices.length > 0).map((course) => ({ name: course.name, course: course.course, choices: course.choices.map((choice) => ({ itemId: choice.itemId, supplement: parseAmount(choice.supplement) })) })) };
    if (await run(() => postJson(`/api/pos/hospitality/set-menus/${itemId}`, body, "PUT"), "Menú guardado.")) onClose();
  }

  return (
    <Dialog onClose={onClose} open title={name}>
      <div className="max-h-[75dvh] space-y-4 overflow-y-auto pr-1" data-testid="pos-set-menu-dialog">
        <p className="text-xs text-muted-foreground">El precio es el del artículo. Cada tiempo con platos se pide al añadir el menú; los tiempos vacíos no se guardan.</p>
        {courses.map((course, index) => (
          <fieldset className="space-y-2 border border-window-shadow p-2" key={index}>
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label={`Nombre del tiempo ${index + 1}`} className="h-10 w-40" maxLength={40} onChange={(event) => patch(index, { name: event.target.value })} value={course.name} />
              <div aria-label="Tiempo en cocina" className="flex gap-1" role="radiogroup">
                {[0, 1, 2, 3, 4].map((value) => <button aria-checked={course.course === value} className={cn("h-10 min-w-10 border-2 px-1.5 font-mono text-xs font-bold", course.course === value ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} key={value} onClick={() => patch(index, { course: value })} role="radio" type="button">{value === 0 ? "Bebida" : courseLabels[value]}</button>)}
              </div>
              <Button aria-label={`Quitar ${course.name}`} className="ml-auto" onClick={() => setCourses(courses.filter((_, position) => position !== index))} size="icon-sm" type="button" variant="ghost"><Trash aria-hidden="true" /></Button>
            </div>
            {course.choices.map((choice, choiceIndex) => (
              <div className="flex items-center gap-1.5 text-sm" key={choice.itemId}>
                <span className="min-w-0 flex-1 truncate">{catalog.find((entry) => entry.id === choice.itemId)?.name ?? "?"}</span>
                <Input aria-label={`Suplemento de ${catalog.find((entry) => entry.id === choice.itemId)?.name ?? ""}`} className="h-9 w-24 text-right" inputMode="decimal" onChange={(event) => patch(index, { choices: course.choices.map((entry, position) => (position === choiceIndex ? { ...entry, supplement: event.target.value.replace(/[^\d,.]/g, "") } : entry)) })} placeholder="+0,00" value={choice.supplement} />
                <Button aria-label="Quitar plato" onClick={() => patch(index, { choices: course.choices.filter((_, position) => position !== choiceIndex) })} size="icon-sm" type="button" variant="ghost"><X aria-hidden="true" /></Button>
              </div>
            ))}
            <ItemPicker catalog={catalog} exclude={[itemId]} label={`Añadir plato a ${course.name || "este tiempo"}`} onChange={(ids) => patch(index, { choices: ids.map((id) => course.choices.find((choice) => choice.itemId === id) ?? { itemId: id, supplement: "" }) })} selected={course.choices.map((choice) => choice.itemId)} />
          </fieldset>
        ))}
        <Button className="h-10" onClick={() => setCourses([...courses, { name: "Bebida", course: 0, choices: [] }])} size="sm" type="button" variant="outline"><Plus aria-hidden="true" /> Tiempo</Button>
        <Button className="h-12 w-full" data-testid="pos-set-menu-save" disabled={pending || !courses.some((course) => course.choices.length > 0)} onClick={() => void save()} type="button">Guardar menú</Button>
      </div>
    </Dialog>
  );
}

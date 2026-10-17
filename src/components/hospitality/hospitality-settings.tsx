"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { stationLabels, STATIONS, type Station } from "@/modules/hospitality/model";

import { postJson } from "./types";

type Table = { id: string; name: string; seats: number; isActive: boolean };
type Area = { id: string; name: string; tables: Table[] };

function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function act(work: () => Promise<unknown>, success: string) {
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
  return { act, pending };
}

/** Salas (Salón, Terraza…) y sus mesas: alta rápida numerada, renombrar, plazas y bajas. */
export function AreasTablesManager({ areas, canManage }: { areas: Area[]; canManage: boolean }) {
  const { act, pending } = useAction();
  const [areaName, setAreaName] = useState("");
  const [editing, setEditing] = useState<Table | null>(null);

  return (
    <div className="space-y-4" data-testid="pos-areas-manager">
      {areas.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay salas. Crea la primera (p. ej. «Salón») y añade sus mesas.</p> : null}
      {areas.map((area) => <AreaBlock area={area} canManage={canManage} key={area.id} onEditTable={setEditing} />)}
      {canManage ? (
        <form className="flex flex-wrap items-end gap-2 border-t border-window-shadow pt-3" onSubmit={async (event) => { event.preventDefault(); if (areaName.trim() && (await act(() => postJson("/api/pos/hospitality/areas", { name: areaName }), "Sala creada."))) setAreaName(""); }}>
          <label className="grid gap-1 text-sm font-medium">Nueva sala<Input aria-label="Nombre de la nueva sala" className="h-11 w-56" maxLength={40} onChange={(event) => setAreaName(event.target.value)} placeholder="Salón, Terraza, Barra…" value={areaName} /></label>
          <Button className="h-11" data-testid="pos-area-create" disabled={pending || !areaName.trim()} type="submit"><Plus aria-hidden="true" /> Crear sala</Button>
        </form>
      ) : null}
      {editing ? <TableDialog onClose={() => setEditing(null)} table={editing} /> : null}
    </div>
  );
}

function AreaBlock({ area, canManage, onEditTable }: { area: Area; canManage: boolean; onEditTable: (table: Table) => void }) {
  const { act, pending } = useAction();
  const next = area.tables.length + 1;
  const [range, setRange] = useState({ prefix: "Mesa", from: String(next), to: String(next + 9), seats: "4" });
  return (
    <section className="space-y-2 border border-window-shadow p-3" data-testid={`pos-area-${area.name}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-mono text-sm font-bold">{area.name} <span className="font-normal text-muted-foreground">· {area.tables.length} mesas</span></h3>
        {canManage ? <Button aria-label={`Borrar la sala ${area.name}`} disabled={pending} onClick={() => { if (window.confirm(`¿Borrar «${area.name}» y sus mesas?`)) void act(() => postJson(`/api/pos/hospitality/areas/${area.id}`, {}, "DELETE"), "Sala borrada."); }} size="icon-sm" type="button" variant="ghost"><Trash aria-hidden="true" /></Button> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {area.tables.map((table) => (
          <button className={cn("min-h-11 border px-3 font-mono text-sm", table.isActive ? "border-window-dark-shadow bg-window-panel" : "border-dashed text-muted-foreground line-through")} disabled={!canManage} key={table.id} onClick={() => onEditTable(table)} type="button">{table.name} <span className="text-xs text-muted-foreground">· {table.seats}</span></button>
        ))}
      </div>
      {canManage ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void act(() => postJson("/api/pos/hospitality/tables", { areaId: area.id, prefix: range.prefix, from: Number(range.from), to: Number(range.to), seats: Number(range.seats) || 4 }), "Mesas añadidas."); }}>
          <label className="grid gap-1 text-xs font-medium">Nombre<Input className="h-11 w-24" onChange={(event) => setRange({ ...range, prefix: event.target.value })} value={range.prefix} /></label>
          <label className="grid gap-1 text-xs font-medium">Desde<Input className="h-11 w-16" inputMode="numeric" onChange={(event) => setRange({ ...range, from: event.target.value.replace(/\D/g, "") })} value={range.from} /></label>
          <label className="grid gap-1 text-xs font-medium">Hasta<Input className="h-11 w-16" inputMode="numeric" onChange={(event) => setRange({ ...range, to: event.target.value.replace(/\D/g, "") })} value={range.to} /></label>
          <label className="grid gap-1 text-xs font-medium">Plazas<Input className="h-11 w-16" inputMode="numeric" onChange={(event) => setRange({ ...range, seats: event.target.value.replace(/\D/g, "") })} value={range.seats} /></label>
          <Button className="h-11" data-testid={`pos-tables-create-${area.name}`} disabled={pending} type="submit" variant="outline"><Plus aria-hidden="true" /> Añadir mesas</Button>
        </form>
      ) : null}
    </section>
  );
}

function TableDialog({ onClose, table }: { onClose: () => void; table: Table }) {
  const { act, pending } = useAction();
  const [name, setName] = useState(table.name);
  const [seats, setSeats] = useState(String(table.seats));
  const [active, setActive] = useState(table.isActive);
  return (
    <Dialog onClose={onClose} open title={`Mesa ${table.name}`}>
      <div className="space-y-3">
        <label className="grid gap-1 text-sm font-medium">Nombre<Input className="h-11" onChange={(event) => setName(event.target.value)} value={name} /></label>
        <label className="grid gap-1 text-sm font-medium">Plazas<Input className="h-11" inputMode="numeric" onChange={(event) => setSeats(event.target.value.replace(/\D/g, ""))} value={seats} /></label>
        <label className="flex items-center gap-2 text-sm"><input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" /> En uso (desmárcala para ocultarla del plano)</label>
        <div className="grid grid-cols-2 gap-2">
          <Button className="h-12" disabled={pending} onClick={() => void act(() => postJson(`/api/pos/hospitality/tables/${table.id}`, {}, "DELETE"), "Mesa borrada.").then((ok) => ok && onClose())} type="button" variant="outline"><Trash aria-hidden="true" /> Borrar</Button>
          <Button className="h-12" disabled={pending || !name.trim()} onClick={() => void act(() => postJson(`/api/pos/hospitality/tables/${table.id}`, { name, seats: Number(seats) || 1, isActive: active }, "PATCH"), "Mesa guardada.").then((ok) => ok && onClose())} type="button">Guardar</Button>
        </div>
      </div>
    </Dialog>
  );
}

/** A qué estación va cada categoría: cocina (platos), barra (bebidas) o ninguna (no genera comanda). */
export function StationsEditor({ canManage, initial }: { canManage: boolean; initial: Array<{ categoryId: string; name: string; station: Station }> }) {
  const { act, pending } = useAction();
  const [entries, setEntries] = useState(initial);
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Crea categorías de artículos (Configuración → Inventario: Categorías) para enviar cada producto a cocina o barra. Sin categoría, los productos no generan comanda.</p>;
  return (
    <div className="space-y-2" data-testid="pos-stations-editor">
      <ul className="divide-y divide-window-shadow border border-window-shadow">
        {entries.map((entry) => (
          <li className="flex flex-wrap items-center justify-between gap-2 p-2" key={entry.categoryId}>
            <span className="text-sm font-semibold">{entry.name}</span>
            <div aria-label={`Estación de ${entry.name}`} className="flex gap-1" role="radiogroup">
              {STATIONS.map((station) => (
                <button aria-checked={entry.station === station} className={cn("h-10 border-2 px-3 font-mono text-xs font-bold", entry.station === station ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} data-testid={`pos-station-${entry.name}-${station}`} disabled={!canManage} key={station} onClick={() => setEntries((current) => current.map((candidate) => (candidate.categoryId === entry.categoryId ? { ...candidate, station } : candidate)))} role="radio" type="button">{stationLabels[station]}</button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {canManage ? <Button className="h-11" data-testid="pos-stations-save" disabled={pending} onClick={() => void act(() => postJson("/api/pos/hospitality/stations", { entries: entries.map(({ categoryId, station }) => ({ categoryId, station })) }, "PUT"), "Estaciones guardadas.")} type="button">Guardar estaciones</Button> : null}
    </div>
  );
}

/** PIN de 4 a 6 cifras por camarero: se identifican al instante en una tablet compartida. */
export function StaffPins({ canManage, staff }: { canManage: boolean; staff: Array<{ userId: string; name: string; hasPin: boolean }> }) {
  const { act, pending } = useAction();
  const [pins, setPins] = useState<Record<string, string>>({});
  return (
    <ul className="divide-y divide-window-shadow border border-window-shadow" data-testid="pos-staff-pins">
      {staff.map((member) => (
        <li className="flex flex-wrap items-center justify-between gap-2 p-2" key={member.userId}>
          <span className="flex items-center gap-2 text-sm font-semibold">{member.name} <StatusBadge tone={member.hasPin ? "success" : "neutral"}>{member.hasPin ? "Con PIN" : "Sin PIN"}</StatusBadge></span>
          {canManage ? (
            <span className="flex items-center gap-1">
              <Input aria-label={`PIN de ${member.name}`} className="h-11 w-28 text-center font-mono text-base tracking-widest" inputMode="numeric" maxLength={6} onChange={(event) => setPins((current) => ({ ...current, [member.userId]: event.target.value.replace(/\D/g, "") }))} placeholder="••••" type="password" value={pins[member.userId] ?? ""} />
              <Button className="h-11" data-testid={`pos-pin-save-${member.name}`} disabled={pending || (pins[member.userId] ?? "").length < 4} onClick={() => void act(() => postJson(`/api/pos/hospitality/staff/${member.userId}`, { pin: pins[member.userId] }, "PUT"), "PIN guardado.").then((ok) => ok && setPins((current) => ({ ...current, [member.userId]: "" })))} type="button">Guardar</Button>
              {member.hasPin ? <Button className="h-11" disabled={pending} onClick={() => void act(() => postJson(`/api/pos/hospitality/staff/${member.userId}`, { pin: null }, "PUT"), "PIN quitado.")} type="button" variant="ghost">Quitar</Button> : null}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

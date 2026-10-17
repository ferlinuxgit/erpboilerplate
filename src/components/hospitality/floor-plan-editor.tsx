"use client";

import { ArrowsOutCardinal, FloppyDisk, Plus, Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { autoLayout, clampToPlan, overlaps, PLAN_COLS, PLAN_ROWS, TABLE_SHAPES, tableShapeLabels, type TableShape } from "@/modules/hospitality/floor-plan";

import { postJson } from "./types";

export type EditorTable = { id: string; name: string; seats: number; isActive: boolean; bookable: boolean; shape: TableShape; posX: number | null; posY: number | null; width: number; height: number };
type Placed = EditorTable & { posX: number; posY: number };

const SIZE_FOR_SHAPE: Record<TableShape, { width: number; height: number }> = { SQUARE: { width: 2, height: 2 }, ROUND: { width: 2, height: 2 }, RECT: { width: 4, height: 2 } };

/**
 * Plano de una sala en una cuadrícula: arrastra las mesas (ratón o dedo) o muévelas con las flechas,
 * cambia su forma y tamaño y guarda. Las mesas que se solapan se marcan en rojo y no dejan guardar.
 */
export function FloorPlanEditor({ areaId, areaName, canManage, tables }: { areaId: string; areaName: string; canManage: boolean; tables: EditorTable[] }) {
  const router = useRouter();
  const [layout, setLayout] = useState<Placed[]>(() => autoLayout(tables));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const planRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; offsetX: number; offsetY: number; moved: boolean } | null>(null);

  const selected = layout.find((table) => table.id === selectedId) ?? null;
  const clashes = new Set(layout.flatMap((table) => (layout.some((other) => other.id !== table.id && overlaps(table, other)) ? [table.id] : [])));

  function patch(id: string, change: Partial<Placed>) {
    setLayout((current) => current.map((table) => (table.id === id ? { ...table, ...change, ...clampToPlan({ ...table, ...change }) } : table)));
    setDirty(true);
  }

  function cellFromPointer(event: PointerEvent) {
    const rect = planRef.current!.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * PLAN_COLS, y: ((event.clientY - rect.top) / rect.height) * PLAN_ROWS };
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, table: Placed) {
    setSelectedId(table.id);
    if (!canManage) return;
    const cell = cellFromPointer(event);
    drag.current = { id: table.id, offsetX: cell.x - table.posX, offsetY: cell.y - table.posY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current) return;
    const cell = cellFromPointer(event);
    const table = layout.find((entry) => entry.id === current.id)!;
    const posX = Math.round(cell.x - current.offsetX);
    const posY = Math.round(cell.y - current.offsetY);
    if (posX === table.posX && posY === table.posY) return;
    current.moved = true;
    patch(current.id, { posX, posY });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, table: Placed) {
    if (!canManage) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!step) return;
    event.preventDefault();
    patch(table.id, { posX: table.posX + step[0], posY: table.posY + step[1] });
  }

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

  async function saveLayout() {
    if (await run(() => postJson(`/api/pos/hospitality/areas/${areaId}/layout`, { tables: layout.map(({ id, posX, posY, width, height, shape }) => ({ id, posX, posY, width, height, shape })) }, "PUT"), "Plano guardado.")) setDirty(false);
  }

  async function addTable() {
    const used = new Set(layout.map((table) => table.name));
    let number = layout.length + 1;
    while (used.has(`Mesa ${number}`)) number += 1;
    await run(async () => {
      if (dirty) await postJson(`/api/pos/hospitality/areas/${areaId}/layout`, { tables: layout.map(({ id, posX, posY, width, height, shape }) => ({ id, posX, posY, width, height, shape })) }, "PUT");
      await postJson("/api/pos/hospitality/tables", { areaId, prefix: "Mesa", from: number, to: number, seats: 4 });
    }, `Mesa ${number} añadida.`);
  }

  return (
    <div className="space-y-2" data-testid={`pos-plan-${areaName}`}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div
          aria-label={`Plano de ${areaName}`}
          className="relative w-full max-w-3xl touch-none select-none border-2 border-window-dark-shadow bg-[length:calc(100%/24)_calc(100%/16)] [background-image:linear-gradient(to_right,var(--color-window-shadow)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-window-shadow)_1px,transparent_1px)]"
          onPointerDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}
          ref={planRef}
          role="group"
          style={{ aspectRatio: `${PLAN_COLS} / ${PLAN_ROWS}` }}
        >
          {layout.map((table) => (
            <button
              aria-label={`${table.name}, ${table.seats} plazas${canManage ? ". Arrastra o usa las flechas para moverla" : ""}`}
              aria-pressed={table.id === selectedId}
              className={cn(
                "absolute flex flex-col items-center justify-center overflow-hidden border-2 font-mono text-xs font-bold leading-tight shadow-raised",
                canManage && "cursor-grab active:cursor-grabbing",
                table.shape === "ROUND" && "rounded-full",
                clashes.has(table.id) ? "border-destructive bg-destructive/20" : table.id === selectedId ? "border-primary bg-primary/20" : "border-window-dark-shadow bg-window-panel",
                !table.isActive && "border-dashed opacity-50",
              )}
              data-testid={`pos-plan-table-${table.name}`}
              key={table.id}
              onKeyDown={(event) => onKeyDown(event, table)}
              onPointerCancel={() => { drag.current = null; }}
              onPointerDown={(event) => onPointerDown(event, table)}
              onPointerMove={onPointerMove}
              onPointerUp={() => { drag.current = null; }}
              style={{ left: `${(table.posX / PLAN_COLS) * 100}%`, top: `${(table.posY / PLAN_ROWS) * 100}%`, width: `${(table.width / PLAN_COLS) * 100}%`, height: `${(table.height / PLAN_ROWS) * 100}%` }}
              type="button"
            >
              <span className="truncate px-0.5">{table.name}</span>
              <span className="font-normal text-muted-foreground">{table.seats} pax</span>
            </button>
          ))}
          {layout.length === 0 ? <p className="absolute inset-0 m-auto h-fit text-center text-sm text-muted-foreground">Sala vacía: añade mesas.</p> : null}
        </div>

        {selected ? (
          <TablePanel canManage={canManage} key={selected.id} onChange={(change) => patch(selected.id, change)} onClose={() => setSelectedId(null)} pending={pending} run={run} table={selected} />
        ) : (
          <p className="flex items-start gap-2 text-sm text-muted-foreground"><ArrowsOutCardinal aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{canManage ? "Arrastra las mesas para colocarlas como en tu local. Toca una para cambiar su nombre, plazas, forma o tamaño." : "Toca una mesa para ver sus datos."}</p>
        )}
      </div>
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button className="h-11" data-testid={`pos-plan-save-${areaName}`} disabled={pending || !dirty || clashes.size > 0} onClick={() => void saveLayout()} type="button"><FloppyDisk aria-hidden="true" /> Guardar plano</Button>
          <Button className="h-11" data-testid={`pos-plan-add-${areaName}`} disabled={pending || clashes.size > 0} onClick={() => void addTable()} type="button" variant="outline"><Plus aria-hidden="true" /> Añadir mesa</Button>
          {clashes.size > 0 ? <span className="text-sm font-semibold text-destructive" role="status">Hay mesas encima de otras: sepáralas.</span> : dirty ? <span className="text-sm text-warning-text" role="status">Cambios sin guardar</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function TablePanel({ canManage, onChange, onClose, pending, run, table }: { canManage: boolean; onChange: (change: Partial<Placed>) => void; onClose: () => void; pending: boolean; run: (work: () => Promise<unknown>, success: string) => Promise<boolean>; table: Placed }) {
  const [name, setName] = useState(table.name);
  const [seats, setSeats] = useState(String(table.seats));
  const [active, setActive] = useState(table.isActive);
  const [bookable, setBookable] = useState(table.bookable);
  const disabled = !canManage || pending;

  function setShape(shape: TableShape) {
    onChange({ shape, ...(shape === "RECT" && table.width === table.height ? SIZE_FOR_SHAPE.RECT : shape !== "RECT" && table.width !== table.height ? { width: Math.min(table.width, table.height), height: Math.min(table.width, table.height) } : {}) });
  }

  return (
    <div className="space-y-3 border border-window-shadow p-3" data-testid="pos-plan-panel">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-mono text-sm font-bold">{table.name}</h4>
        <Button onClick={onClose} size="sm" type="button" variant="ghost">Cerrar</Button>
      </div>
      <label className="grid gap-1 text-sm font-medium">Nombre<Input className="h-11" disabled={disabled} maxLength={30} onChange={(event) => setName(event.target.value)} value={name} /></label>
      <label className="grid gap-1 text-sm font-medium">Plazas<Input className="h-11" disabled={disabled} inputMode="numeric" onChange={(event) => setSeats(event.target.value.replace(/\D/g, ""))} value={seats} /></label>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Forma</legend>
        <div className="grid grid-cols-3 gap-1">
          {TABLE_SHAPES.map((shape) => (
            <button aria-pressed={table.shape === shape} className={cn("h-10 border-2 font-mono text-xs font-bold", table.shape === shape ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} disabled={disabled} key={shape} onClick={() => setShape(shape)} type="button">{tableShapeLabels[shape]}</button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <SizeStepper disabled={disabled} label="Ancho" max={8} onChange={(width) => onChange(table.shape === "RECT" ? { width } : { width, height: width })} value={table.width} />
        <SizeStepper disabled={disabled} label="Fondo" max={8} onChange={(height) => onChange(table.shape === "RECT" ? { height } : { width: height, height })} value={table.height} />
      </div>
      <label className="flex items-center gap-2 text-sm"><input checked={bookable} disabled={disabled} onChange={(event) => setBookable(event.target.checked)} type="checkbox" /> Se puede reservar online</label>
      <label className="flex items-center gap-2 text-sm"><input checked={active} disabled={disabled} onChange={(event) => setActive(event.target.checked)} type="checkbox" /> En uso (desmárcala para ocultarla)</label>
      {canManage ? (
        <div className="grid grid-cols-2 gap-2">
          <Button className="h-11" disabled={pending} onClick={() => { if (window.confirm(`¿Borrar ${table.name}?`)) void run(() => postJson(`/api/pos/hospitality/tables/${table.id}`, {}, "DELETE"), "Mesa borrada.").then((ok) => ok && onClose()); }} type="button" variant="outline"><Trash aria-hidden="true" /> Borrar</Button>
          <Button className="h-11" data-testid="pos-plan-table-save" disabled={pending || !name.trim()} onClick={() => void run(() => postJson(`/api/pos/hospitality/tables/${table.id}`, { name, seats: Number(seats) || 1, isActive: active, bookable, shape: table.shape }, "PATCH"), "Mesa guardada.")} type="button">Guardar mesa</Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">La posición, la forma y el tamaño se guardan con «Guardar plano».</p>
    </div>
  );
}

function SizeStepper({ disabled, label, max, onChange, value }: { disabled: boolean; label: string; max: number; onChange: (value: number) => void; value: number }) {
  return (
    <div className="space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center">
        <button aria-label={`Menos ${label.toLowerCase()}`} className="h-10 w-10 border-2 border-window-dark-shadow bg-window-panel font-mono font-bold" disabled={disabled || value <= 1} onClick={() => onChange(value - 1)} type="button">−</button>
        <span className="w-10 text-center font-mono font-bold tabular-nums">{value}</span>
        <button aria-label={`Más ${label.toLowerCase()}`} className="h-10 w-10 border-2 border-window-dark-shadow bg-window-panel font-mono font-bold" disabled={disabled || value >= max} onClick={() => onChange(value + 1)} type="button">+</button>
      </div>
    </div>
  );
}


"use client";

import { ArrowLeft, ArrowRight, CheckCircle, Minus, Plus, Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { postJson } from "./types";

type Area = { name: string; tables: number; seats: number };
type RegisterOption = { id: string; name: string; mode: "COUNTER" | "TABLES" };

const PRESETS: Array<{ label: string; detail: string; areas: Area[] }> = [
  { label: "Bar", detail: "8 mesas", areas: [{ name: "Salón", tables: 8, seats: 4 }] },
  { label: "Bar con terraza", detail: "8 + 6 mesas", areas: [{ name: "Salón", tables: 8, seats: 4 }, { name: "Terraza", tables: 6, seats: 4 }] },
  { label: "Restaurante", detail: "12 + 8 mesas", areas: [{ name: "Comedor", tables: 12, seats: 4 }, { name: "Terraza", tables: 8, seats: 4 }] },
];

const STEPS = ["Caja", "Salas y mesas", "Listo"] as const;

/**
 * Puesta en marcha de la sala en tres pasos: qué caja usan los camareros (pasa a modo «Mesas»),
 * cuántas salas y mesas hay y confirmar. Después se puede retocar el plano en la configuración.
 */
export function SetupWizard({ existingTables = 0, registers }: { existingTables?: number; registers: RegisterOption[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [registerId, setRegisterId] = useState<string | null>(registers[0]?.id ?? null);
  const [registerName, setRegisterName] = useState("Sala");
  const [areas, setAreas] = useState<Area[]>(PRESETS[1].areas);
  const [pending, setPending] = useState(false);
  const validAreas = areas.filter((area) => area.name.trim() && area.tables > 0);
  const totalTables = validAreas.reduce((sum, area) => sum + area.tables, 0);
  const chosen = registers.find((register) => register.id === registerId);

  function updateArea(index: number, patch: Partial<Area>) {
    setAreas((current) => current.map((area, position) => (position === index ? { ...area, ...patch } : area)));
  }

  async function finish() {
    setPending(true);
    try {
      const result = await postJson<{ registerId: string; tables: number }>("/api/pos/setup-hospitality", { registerId, registerName: registerId ? null : registerName, areas: validAreas });
      toast.success(`Sala lista: ${result.tables} mesas creadas.`);
      router.push(`/pos/${result.registerId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo poner en marcha la sala.");
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4" data-testid="pos-setup-wizard">
      <ol className="grid grid-cols-3 gap-1" aria-label="Pasos">
        {STEPS.map((label, index) => (
          <li className={cn("border-2 px-2 py-1.5 text-center font-mono text-xs font-bold uppercase", index === step ? "border-primary bg-primary text-primary-foreground" : index < step ? "border-success text-success-text" : "border-window-shadow text-muted-foreground")} key={label} aria-current={index === step ? "step" : undefined}>
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section className="space-y-3">
          <h2 className="font-mono text-lg font-bold">¿Qué caja usarán los camareros?</h2>
          <p className="text-sm text-muted-foreground">Pasará a modo «Mesas»: al entrar se verá el plano y cada mesa llevará su cuenta abierta hasta cobrarla.</p>
          <div className="grid gap-2" role="radiogroup">
            {registers.map((register) => (
              <button aria-checked={registerId === register.id} className={cn("flex min-h-14 items-center justify-between border-2 px-4 text-left", registerId === register.id ? "border-primary bg-primary/10" : "border-window-dark-shadow bg-window-panel")} data-testid={`pos-setup-register-${register.name}`} key={register.id} onClick={() => setRegisterId(register.id)} role="radio" type="button">
                <span className="font-mono text-base font-bold">{register.name}</span>
                <span className="text-xs text-muted-foreground">{register.mode === "TABLES" ? "Ya en modo Mesas" : "Ahora: mostrador"}</span>
              </button>
            ))}
            <button aria-checked={registerId === null} className={cn("flex min-h-14 items-center gap-3 border-2 px-4 text-left", registerId === null ? "border-primary bg-primary/10" : "border-dashed border-window-dark-shadow bg-window-panel")} data-testid="pos-setup-register-new" onClick={() => setRegisterId(null)} role="radio" type="button">
              <Plus aria-hidden="true" className="size-5" /><span className="font-mono text-base font-bold">Crear una caja nueva</span>
            </button>
          </div>
          {registerId === null ? (
            <label className="grid gap-1 text-sm font-medium">Nombre de la caja<Input className="h-12 text-base" maxLength={60} onChange={(event) => setRegisterName(event.target.value)} value={registerName} /></label>
          ) : null}
        </section>
      ) : null}

      {step === 1 ? (
        <section className="space-y-3">
          <h2 className="font-mono text-lg font-bold">¿Cuántas salas y mesas tienes?</h2>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button className="flex flex-col border-2 border-window-dark-shadow bg-window-panel px-3 py-2 text-left active:translate-y-px" key={preset.label} onClick={() => setAreas(preset.areas)} type="button">
                <span className="font-mono text-sm font-bold">{preset.label}</span><span className="text-xs text-muted-foreground">{preset.detail}</span>
              </button>
            ))}
          </div>
          <ul className="space-y-2">
            {areas.map((area, index) => (
              <li className="grid gap-2 border-2 border-window-shadow p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end" data-testid={`pos-setup-area-${index}`} key={index}>
                <label className="grid gap-1 text-xs font-medium">Sala<Input aria-label={`Nombre de la sala ${index + 1}`} className="h-12 text-base" maxLength={40} onChange={(event) => updateArea(index, { name: event.target.value })} placeholder="Salón, Terraza…" value={area.name} /></label>
                <Stepper label="Mesas" max={100} min={0} onChange={(tables) => updateArea(index, { tables })} testId={`pos-setup-tables-${index}`} value={area.tables} />
                <Stepper label="Plazas" max={20} min={1} onChange={(seats) => updateArea(index, { seats })} value={area.seats} />
                <Button aria-label={`Quitar ${area.name || "la sala"}`} className="h-12" disabled={areas.length === 1} onClick={() => setAreas((current) => current.filter((_, position) => position !== index))} type="button" variant="ghost"><Trash aria-hidden="true" /></Button>
              </li>
            ))}
          </ul>
          <Button className="h-12" disabled={areas.length >= 10} onClick={() => setAreas((current) => [...current, { name: "", tables: 4, seats: 4 }])} type="button" variant="outline"><Plus aria-hidden="true" /> Otra sala</Button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-3" data-testid="pos-setup-summary">
          <h2 className="font-mono text-lg font-bold">Todo listo para crear</h2>
          <ul className="space-y-1 border-2 border-window-shadow p-3 text-sm">
            <li><CheckCircle aria-hidden="true" className="mr-1 inline size-4 text-success" weight="fill" />Caja <strong>{chosen?.name ?? registerName}</strong> en modo Mesas{chosen ? "" : " (nueva)"}</li>
            {(() => {
              let next = existingTables + 1;
              return validAreas.map((area) => {
                const from = next;
                next += area.tables;
                return <li key={area.name}><CheckCircle aria-hidden="true" className="mr-1 inline size-4 text-success" weight="fill" /><strong>{area.name}</strong>: {area.tables} mesas de {area.seats} plazas (Mesa {from}–{from + area.tables - 1})</li>;
              });
            })()}
          </ul>
          <p className="text-xs text-muted-foreground">{existingTables > 0 ? `Ya tenías ${existingTables} mesas: las nuevas siguen su numeración. ` : ""}Luego puedes dibujar el plano, cambiar nombres y plazas en «Salas y mesas».</p>
        </section>
      ) : null}

      <div className="flex justify-between gap-2 border-t border-window-shadow pt-3">
        <Button className="h-14 px-5" disabled={step === 0 || pending} onClick={() => setStep(step - 1)} type="button" variant="outline"><ArrowLeft aria-hidden="true" /> Atrás</Button>
        {step < 2 ? (
          <Button className="h-14 px-6 text-base" data-testid="pos-setup-next" disabled={step === 1 && totalTables === 0 || step === 0 && registerId === null && !registerName.trim()} onClick={() => setStep(step + 1)} type="button">Siguiente <ArrowRight aria-hidden="true" /></Button>
        ) : (
          <Button className="h-14 px-6 text-base" data-testid="pos-setup-finish" disabled={pending || totalTables === 0} onClick={() => void finish()} type="button"><CheckCircle aria-hidden="true" /> Crear {totalTables} mesas y empezar</Button>
        )}
      </div>
    </div>
  );
}

function Stepper({ label, max, min, onChange, testId, value }: { label: string; max: number; min: number; onChange: (value: number) => void; testId?: string; value: number }) {
  return (
    <div className="grid gap-1 text-xs font-medium">
      {label}
      <div className="flex items-center">
        <Button aria-label={`${label}: uno menos`} className="size-12" disabled={value <= min} onClick={() => onChange(value - 1)} type="button" variant="outline"><Minus aria-hidden="true" /></Button>
        <span className="w-12 text-center font-mono text-xl font-black tabular-nums" data-testid={testId}>{value}</span>
        <Button aria-label={`${label}: uno más`} className="size-12" disabled={value >= max} onClick={() => onChange(value + 1)} type="button" variant="outline"><Plus aria-hidden="true" /></Button>
      </div>
    </div>
  );
}

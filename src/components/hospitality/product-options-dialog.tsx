"use client";

import { Check } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { courseLabels, resolveModifiers, resolveSetMenu, type ModifierGroup, type SetMenuCourse } from "@/modules/hospitality/ordering";

export type ProductChoice = { modifierOptionIds?: string[]; setMenuPicks?: Array<{ courseId: string; itemId: string }> };

/**
 * Al tocar un producto con opciones: elegir punto, guarnición o extras (con su suplemento), o los platos
 * de cada tiempo de un menú. Botones grandes para el dedo y total al momento.
 */
export function ProductOptionsDialog({ basePrice, currencyCode, groups, menu, name, onClose, onConfirm, soldOut }: { basePrice: number; currencyCode: string; groups: ModifierGroup[]; menu: SetMenuCourse[] | null; name: string; onClose: () => void; onConfirm: (choice: ProductChoice) => void; soldOut?: ReadonlySet<string> }) {
  const [selected, setSelected] = useState<string[]>(() => groups.flatMap((group) => (group.minSelect === 1 && group.maxSelect === 1 && group.options.length === 1 ? [group.options[0].id] : [])));
  const [picks, setPicks] = useState<Record<string, string>>(() => Object.fromEntries((menu ?? []).filter((course) => course.choices.length === 1).map((course) => [course.id, course.choices[0].itemId])));

  const modifierResult = menu ? null : resolveModifiers(groups, selected);
  const menuResult = menu ? resolveSetMenu(menu, Object.entries(picks).map(([courseId, itemId]) => ({ courseId, itemId }))) : null;
  const extra = menu
    ? (menuResult && !("error" in menuResult) ? menuResult.supplement : Object.entries(picks).reduce((sum, [courseId, itemId]) => sum + (menu.find((course) => course.id === courseId)?.choices.find((choice) => choice.itemId === itemId)?.supplement ?? 0), 0))
    : groups.flatMap((group) => group.options).filter((option) => selected.includes(option.id)).reduce((sum, option) => sum + option.price, 0);
  const error = menu ? (menuResult && "error" in menuResult ? menuResult.error : null) : modifierResult && "error" in modifierResult ? modifierResult.error : null;

  function toggle(group: ModifierGroup, optionId: string) {
    setSelected((current) => {
      const inGroup = group.options.map((option) => option.id);
      if (current.includes(optionId)) return current.filter((id) => id !== optionId);
      // Una sola opción: tocar otra la cambia. Varias: se añade si no se ha llegado al máximo.
      if (group.maxSelect === 1) return [...current.filter((id) => !inGroup.includes(id)), optionId];
      if (current.filter((id) => inGroup.includes(id)).length >= group.maxSelect) return current;
      return [...current, optionId];
    });
  }

  return (
    <Dialog onClose={onClose} open title={name}>
      <div className="max-h-[75dvh] space-y-4 overflow-y-auto pr-1" data-testid="pos-product-options">
        {menu
          ? menu.map((course) => (
              <fieldset className="space-y-1.5" key={course.id}>
                <legend className="flex items-center gap-2 font-mono text-sm font-bold">{course.name}{course.course > 0 ? <span className="border border-window-dark-shadow px-1 text-xs">{courseLabels[course.course]}</span> : null}</legend>
                <div className="grid grid-cols-2 gap-1.5">
                  {course.choices.map((choice) => {
                    const active = picks[course.id] === choice.itemId;
                    const out = soldOut?.has(choice.itemId) ?? false;
                    return (
                      <button aria-pressed={active} className={cn("flex min-h-14 items-center justify-between gap-2 border-2 px-3 py-2 text-left text-sm font-semibold disabled:border-dashed disabled:opacity-50", active ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} data-testid={`pos-menu-choice-${choice.name}`} disabled={out && !active} key={choice.itemId} onClick={() => setPicks((current) => ({ ...current, [course.id]: choice.itemId }))} type="button">
                        <span>{choice.name}{out ? <span className="block font-mono text-[11px] font-black uppercase text-destructive">Agotado</span> : null}</span>
                        {choice.supplement > 0 ? <span className="shrink-0 font-mono text-xs">+{formatMoney(choice.supplement, currencyCode)}</span> : active ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))
          : groups.map((group) => (
              <fieldset className="space-y-1.5" key={group.id}>
                <legend className="flex items-center gap-2 font-mono text-sm font-bold">
                  {group.name}
                  <span className={cn("px-1 text-xs font-normal", group.minSelect > 0 ? "bg-destructive text-destructive-foreground" : "text-muted-foreground")}>{group.minSelect > 0 ? "Obligatorio" : group.maxSelect > 1 ? `Hasta ${group.maxSelect}` : "Opcional"}</span>
                </legend>
                <div className="grid grid-cols-2 gap-1.5">
                  {group.options.map((option) => {
                    const active = selected.includes(option.id);
                    return (
                      <button aria-pressed={active} className={cn("flex min-h-14 items-center justify-between gap-2 border-2 px-3 py-2 text-left text-sm font-semibold", active ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} data-testid={`pos-modifier-${option.name}`} key={option.id} onClick={() => toggle(group, option.id)} type="button">
                        <span>{option.name}</span>
                        {option.price > 0 ? <span className="shrink-0 font-mono text-xs">+{formatMoney(option.price, currencyCode)}</span> : active ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
        {error ? <p className="text-sm font-semibold text-destructive" role="status">{error}</p> : null}
        <Button className="h-14 w-full text-lg" data-testid="pos-product-options-add" disabled={Boolean(error)} onClick={() => onConfirm(menu ? { setMenuPicks: Object.entries(picks).map(([courseId, itemId]) => ({ courseId, itemId })) } : { modifierOptionIds: selected })} type="button">
          Añadir · {formatMoney(Math.round((basePrice + extra) * 100) / 100, currencyCode)}
        </Button>
      </div>
    </Dialog>
  );
}

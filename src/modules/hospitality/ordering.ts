/**
 * Pedir en sala: modificadores (punto, extras), menús de precio cerrado con platos a elegir y tiempos
 * del servicio (primeros, segundos…). Puro, sin base de datos.
 */
import { grossPrice, netFromGross } from "@/modules/pos/model";

export const COURSES = [0, 1, 2, 3, 4] as const;
export type Course = (typeof COURSES)[number];
export const courseLabels: Record<number, string> = { 0: "Sin tiempo", 1: "1º", 2: "2º", 3: "3º", 4: "Postre" };
export const courseLongLabels: Record<number, string> = { 0: "Sin tiempo", 1: "Primeros", 2: "Segundos", 3: "Terceros", 4: "Postres" };

export type ModifierGroup = { id: string; name: string; minSelect: number; maxSelect: number; options: Array<{ id: string; name: string; price: number }> };
export type ChosenModifier = { group: string; name: string; price: number };

/** Comprueba la elección (obligatorios y máximos) y devuelve las opciones en orden. */
export function resolveModifiers(groups: readonly ModifierGroup[], selectedIds: readonly string[]): { modifiers: ChosenModifier[] } | { error: string } {
  const selected = new Set(selectedIds);
  const known = new Set(groups.flatMap((group) => group.options.map((option) => option.id)));
  if ([...selected].some((id) => !known.has(id))) return { error: "Alguna opción ya no existe: vuelve a abrir el producto." };
  const modifiers: ChosenModifier[] = [];
  for (const group of groups) {
    const chosen = group.options.filter((option) => selected.has(option.id));
    if (chosen.length < group.minSelect) return { error: group.minSelect === 1 ? `Elige ${group.name.toLowerCase()}.` : `Elige al menos ${group.minSelect} en «${group.name}».` };
    if (chosen.length > group.maxSelect) return { error: `En «${group.name}» se pueden elegir ${group.maxSelect} como mucho.` };
    for (const option of chosen) modifiers.push({ group: group.name, name: option.name, price: option.price });
  }
  return { modifiers };
}

/** Descripción y precio sin IVA de un producto con sus modificadores (los suplementos son PVP con IVA). */
export function applyModifiers(base: { description: string; unitPrice: number; taxRate: number }, modifiers: readonly ChosenModifier[]) {
  const extraGross = Math.round(modifiers.reduce((sum, modifier) => sum + modifier.price, 0) * 100) / 100;
  // Base sin IVA del PVP total (precio + suplementos): nunca se cobra más de lo anunciado.
  const unitPrice = extraGross > 0 ? netFromGross(grossPrice(base.unitPrice, base.taxRate) + extraGross, base.taxRate).net : base.unitPrice;
  return {
    description: modifiers.length > 0 ? `${base.description} · ${modifiers.map((modifier) => modifier.name).join(", ")}` : base.description,
    unitPrice,
  };
}

export type SetMenuCourse = { id: string; name: string; course: number; choices: Array<{ itemId: string; name: string; supplement: number }> };

/** Un plato por tiempo del menú; devuelve los elegidos y el total de suplementos (PVP). */
export function resolveSetMenu(courses: readonly SetMenuCourse[], picks: ReadonlyArray<{ courseId: string; itemId: string }>): { dishes: Array<{ courseId: string; itemId: string; name: string; course: number; supplement: number }>; supplement: number } | { error: string } {
  if (courses.length === 0) return { error: "Este menú no tiene platos configurados." };
  const dishes: Array<{ courseId: string; itemId: string; name: string; course: number; supplement: number }> = [];
  for (const course of courses) {
    const pick = picks.filter((entry) => entry.courseId === course.id);
    if (pick.length !== 1) return { error: `Elige el ${course.name.toLowerCase()}.` };
    const choice = course.choices.find((entry) => entry.itemId === pick[0].itemId);
    if (!choice) return { error: `Ese plato no está en «${course.name}».` };
    dishes.push({ courseId: course.id, itemId: choice.itemId, name: choice.name, course: course.course, supplement: choice.supplement });
  }
  if (picks.some((entry) => !courses.some((course) => course.id === entry.courseId))) return { error: "Algún plato no es de este menú." };
  return { dishes, supplement: Math.round(dishes.reduce((sum, dish) => sum + dish.supplement, 0) * 100) / 100 };
}

type CourseLine = { station: string; course: number; status: string; firedAt?: Date | string | null };
const isKitchenActive = (line: CourseLine) => line.station === "KITCHEN" && line.course > 0 && line.status !== "SERVED" && line.status !== "CANCELLED";

/**
 * Hasta qué tiempo sale ya al enviar: el último marchado o, si de ese no queda nada en la mesa, el
 * primero que haya (una mesa que solo pide segundos no se queda esperando).
 */
export function fireThreshold(firedCourse: number, lines: readonly CourseLine[]) {
  const courses = lines.filter(isKitchenActive).map((line) => line.course);
  if (courses.length === 0) return firedCourse;
  return Math.max(firedCourse, Math.min(...courses));
}

/** ¿Sale ya este plato o espera a que se marche su tiempo? La barra y lo «sin tiempo» salen siempre. */
export function firesNow(line: { station: string; course: number }, threshold: number) {
  return line.station !== "KITCHEN" || line.course === 0 || line.course <= threshold;
}

/** Siguiente tiempo en espera (enviado y sin marchar), o null. */
export function nextHeldCourse(lines: readonly CourseLine[]) {
  const held = lines.filter((line) => line.station === "KITCHEN" && line.status === "SENT" && !line.firedAt).map((line) => line.course);
  return held.length > 0 ? Math.min(...held) : null;
}

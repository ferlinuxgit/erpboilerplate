import { and, asc, eq, inArray } from "drizzle-orm";

import { item, posItemModifierGroup, posModifierGroup, posModifierOption, posSetMenuChoice, posSetMenuCourse } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { ModifierGroup, SetMenuCourse } from "@/modules/hospitality/ordering";
import { recordAudit } from "@/server/audit";
import type { PosActor } from "@/server/pos/service";

const num = (value: string | number | null | undefined) => Number(value ?? 0);
const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

async function audit(actor: PosActor, action: string, entityName: string, entityId: string, payload: Record<string, unknown>, client: DbClient = db) {
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action, entityName, entityId, payload }, client);
}

async function assertItems(client: DbClient, companyId: string, itemIds: readonly string[]) {
  const unique = [...new Set(itemIds)];
  if (unique.length === 0) return;
  const owned = await client.select({ id: item.id }).from(item).where(and(eq(item.companyId, companyId), inArray(item.id, unique)));
  if (owned.length !== unique.length) throw new HttpError(404, "Algún artículo no existe.");
}

// ---------------------------------------------------------------------------------------------
// Modificadores
// ---------------------------------------------------------------------------------------------

export async function listModifierGroups(companyId: string) {
  const [groups, options, links] = await Promise.all([
    db.select().from(posModifierGroup).where(eq(posModifierGroup.companyId, companyId)).orderBy(asc(posModifierGroup.position), asc(posModifierGroup.name)),
    db.select().from(posModifierOption).where(eq(posModifierOption.companyId, companyId)).orderBy(asc(posModifierOption.position)),
    db.select({ groupId: posItemModifierGroup.groupId, itemId: posItemModifierGroup.itemId }).from(posItemModifierGroup).where(eq(posItemModifierGroup.companyId, companyId)),
  ]);
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    options: options.filter((option) => option.groupId === group.id).map((option) => ({ id: option.id, name: option.name, price: num(option.price) })),
    itemIds: links.filter((link) => link.groupId === group.id).map((link) => link.itemId),
  }));
}

export type ModifierGroupInput = { name: string; minSelect: number; maxSelect: number; options: Array<{ name: string; price: number }>; itemIds: string[] };

/** Crea o sustituye un grupo entero (nombre, reglas, opciones y artículos que lo piden). */
export async function saveModifierGroup(actor: PosActor, groupId: string | null, input: ModifierGroupInput) {
  if (input.options.length === 0) throw new HttpError(400, "Añade al menos una opción.");
  if (input.minSelect > input.maxSelect) throw new HttpError(400, "El mínimo no puede ser mayor que el máximo.");
  if (input.minSelect > input.options.length) throw new HttpError(400, "Hay menos opciones que el mínimo obligatorio.");
  const names = input.options.map((option) => option.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) throw new HttpError(400, "Hay opciones repetidas.");
  return db.transaction(async (tx) => {
    await assertItems(tx, actor.companyId, input.itemIds);
    let id = groupId;
    const values = { name: input.name.trim(), minSelect: input.minSelect, maxSelect: Math.max(1, input.maxSelect) };
    if (id) {
      const [updated] = await tx.update(posModifierGroup).set(values).where(and(eq(posModifierGroup.id, id), eq(posModifierGroup.companyId, actor.companyId))).returning({ id: posModifierGroup.id });
      if (!updated) throw new HttpError(404, "Grupo no encontrado.");
      await tx.delete(posModifierOption).where(eq(posModifierOption.groupId, id));
      await tx.delete(posItemModifierGroup).where(eq(posItemModifierGroup.groupId, id));
    } else {
      // Al final de la lista: los grupos se piden en el orden en que se crearon.
      const existing = await tx.select({ id: posModifierGroup.id }).from(posModifierGroup).where(eq(posModifierGroup.companyId, actor.companyId));
      const [created] = await tx.insert(posModifierGroup).values({ companyId: actor.companyId, ...values, position: existing.length }).returning({ id: posModifierGroup.id });
      id = created.id;
    }
    await tx.insert(posModifierOption).values(input.options.map((option, position) => ({ companyId: actor.companyId, groupId: id!, name: option.name.trim(), price: money(Math.max(0, option.price)), position })));
    const itemIds = [...new Set(input.itemIds)];
    if (itemIds.length > 0) await tx.insert(posItemModifierGroup).values(itemIds.map((itemId) => ({ companyId: actor.companyId, itemId, groupId: id! })));
    await audit(actor, groupId ? "pos_modifier_group.update" : "pos_modifier_group.create", "pos_modifier_group", id!, { name: values.name, options: input.options.length, items: itemIds.length }, tx);
    return { id: id! };
  });
}

export async function deleteModifierGroup(actor: PosActor, groupId: string) {
  await db.delete(posModifierGroup).where(and(eq(posModifierGroup.id, groupId), eq(posModifierGroup.companyId, actor.companyId)));
  await audit(actor, "pos_modifier_group.delete", "pos_modifier_group", groupId, {});
}

// ---------------------------------------------------------------------------------------------
// Menús de precio cerrado
// ---------------------------------------------------------------------------------------------

export async function listSetMenus(companyId: string) {
  const [courses, choices, items] = await Promise.all([
    db.select().from(posSetMenuCourse).where(eq(posSetMenuCourse.companyId, companyId)).orderBy(asc(posSetMenuCourse.position)),
    db.select().from(posSetMenuChoice).where(eq(posSetMenuChoice.companyId, companyId)).orderBy(asc(posSetMenuChoice.position)),
    db.select({ id: item.id, name: item.name }).from(item).where(eq(item.companyId, companyId)),
  ]);
  const names = new Map(items.map((row) => [row.id, row.name]));
  const menuIds = [...new Set(courses.map((course) => course.itemId))];
  return menuIds.map((itemId) => ({
    itemId,
    name: names.get(itemId) ?? "Menú",
    courses: courses.filter((course) => course.itemId === itemId).map((course) => ({
      id: course.id,
      name: course.name,
      course: course.course,
      choices: choices.filter((choice) => choice.courseId === course.id).map((choice) => ({ itemId: choice.itemId, name: names.get(choice.itemId) ?? "?", supplement: num(choice.supplement) })),
    })),
  }));
}

export type SetMenuInput = Array<{ name: string; course: number; choices: Array<{ itemId: string; supplement: number }> }>;

/** Sustituye los tiempos y platos a elegir de un menú. */
export async function saveSetMenu(actor: PosActor, itemId: string, courses: SetMenuInput) {
  if (courses.length === 0) throw new HttpError(400, "Añade al menos un tiempo (Primero, Segundo…).");
  for (const course of courses) {
    if (course.choices.length === 0) throw new HttpError(400, `Añade platos a «${course.name}».`);
    if (course.choices.some((choice) => choice.itemId === itemId)) throw new HttpError(400, "Un menú no puede incluirse a sí mismo.");
    if (new Set(course.choices.map((choice) => choice.itemId)).size !== course.choices.length) throw new HttpError(400, `Hay platos repetidos en «${course.name}».`);
  }
  return db.transaction(async (tx) => {
    await assertItems(tx, actor.companyId, [itemId, ...courses.flatMap((course) => course.choices.map((choice) => choice.itemId))]);
    await tx.delete(posSetMenuCourse).where(and(eq(posSetMenuCourse.itemId, itemId), eq(posSetMenuCourse.companyId, actor.companyId)));
    for (const [position, course] of courses.entries()) {
      const [created] = await tx.insert(posSetMenuCourse).values({ companyId: actor.companyId, itemId, name: course.name.trim(), course: Math.max(0, Math.min(4, course.course)), position }).returning({ id: posSetMenuCourse.id });
      await tx.insert(posSetMenuChoice).values(course.choices.map((choice, index) => ({ companyId: actor.companyId, courseId: created.id, itemId: choice.itemId, supplement: money(Math.max(0, choice.supplement)), position: index })));
    }
    await audit(actor, "pos_set_menu.save", "item", itemId, { courses: courses.map((course) => ({ name: course.name, choices: course.choices.length })) }, tx);
    return { itemId };
  });
}

export async function deleteSetMenu(actor: PosActor, itemId: string) {
  await db.delete(posSetMenuCourse).where(and(eq(posSetMenuCourse.itemId, itemId), eq(posSetMenuCourse.companyId, actor.companyId)));
  await audit(actor, "pos_set_menu.delete", "item", itemId, {});
}

// ---------------------------------------------------------------------------------------------
// Para el TPV y para validar al pedir
// ---------------------------------------------------------------------------------------------

/** Modificadores y menús por artículo (solo los artículos indicados si se pasan). */
export async function getOrderingOptions(companyId: string, client: DbClient = db, itemIds?: readonly string[]) {
  const filterItems = itemIds ? [...new Set(itemIds)] : null;
  if (filterItems && filterItems.length === 0) return { modifiers: {} as Record<string, ModifierGroup[]>, setMenus: {} as Record<string, SetMenuCourse[]> };
  const [links, groups, options, courses, items] = await Promise.all([
    client.select().from(posItemModifierGroup).where(and(eq(posItemModifierGroup.companyId, companyId), ...(filterItems ? [inArray(posItemModifierGroup.itemId, filterItems)] : []))).orderBy(asc(posItemModifierGroup.position)),
    client.select().from(posModifierGroup).where(eq(posModifierGroup.companyId, companyId)).orderBy(asc(posModifierGroup.position), asc(posModifierGroup.name)),
    client.select().from(posModifierOption).where(eq(posModifierOption.companyId, companyId)).orderBy(asc(posModifierOption.position)),
    client.select().from(posSetMenuCourse).where(and(eq(posSetMenuCourse.companyId, companyId), ...(filterItems ? [inArray(posSetMenuCourse.itemId, filterItems)] : []))).orderBy(asc(posSetMenuCourse.position)),
    client.select({ id: item.id, name: item.name, isActive: item.isActive }).from(item).where(eq(item.companyId, companyId)),
  ]);
  const choices = courses.length > 0 ? await client.select().from(posSetMenuChoice).where(inArray(posSetMenuChoice.courseId, courses.map((course) => course.id))).orderBy(asc(posSetMenuChoice.position)) : [];
  const itemInfo = new Map(items.map((row) => [row.id, row]));
  const modifiers: Record<string, ModifierGroup[]> = {};
  for (const link of links) {
    const group = groups.find((entry) => entry.id === link.groupId);
    if (!group) continue;
    (modifiers[link.itemId] ??= []).push({ id: group.id, name: group.name, minSelect: group.minSelect, maxSelect: group.maxSelect, options: options.filter((option) => option.groupId === group.id).map((option) => ({ id: option.id, name: option.name, price: num(option.price) })) });
  }
  // Grupos en el orden general (no en el de alta en cada artículo).
  for (const list of Object.values(modifiers)) list.sort((a, b) => groups.findIndex((group) => group.id === a.id) - groups.findIndex((group) => group.id === b.id));
  const setMenus: Record<string, SetMenuCourse[]> = {};
  for (const course of courses) {
    (setMenus[course.itemId] ??= []).push({
      id: course.id,
      name: course.name,
      course: course.course,
      choices: choices.filter((choice) => choice.courseId === course.id && itemInfo.get(choice.itemId)?.isActive !== false).map((choice) => ({ itemId: choice.itemId, name: itemInfo.get(choice.itemId)?.name ?? "?", supplement: num(choice.supplement) })),
    });
  }
  return { modifiers, setMenus };
}

export type OrderingOptions = Awaited<ReturnType<typeof getOrderingOptions>>;

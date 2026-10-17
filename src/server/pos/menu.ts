import { and, asc, eq, isNotNull, ne, sql } from "drizzle-orm";

import { company, item, itemCategory, posArea, posBookingSettings, posMenuItem, posMenuSection, posMenuSettings, posTable } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { slugify, zonedParts } from "@/modules/hospitality/bookings";
import { ALLERGEN_IDS, dietConflicts, isSectionAvailable, localized, MENU_TAG_IDS, scheduleLabel, type MenuLang } from "@/modules/hospitality/menu";
import { grossPrice } from "@/modules/pos/model";
import { recordAudit } from "@/server/audit";
import { isModuleEnabled } from "@/server/modules/service";
import { listPosCatalog, type PosActor } from "@/server/pos/service";

const MAX_IMAGE_BYTES = 450_000;
const IMAGE_PATTERN = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

async function audit(actor: PosActor, action: string, entityName: string, entityId: string, payload: Record<string, unknown>) {
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action, entityName, entityId, payload });
}

async function companyToday(companyId: string) {
  const [row] = await db.select({ timezone: company.timezone }).from(company).where(eq(company.id, companyId)).limit(1);
  const timezone = row?.timezone ?? "Europe/Madrid";
  return { timezone, ...zonedParts(new Date(), timezone) };
}

// ---------------------------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------------------------

export async function getMenuSettings(companyId: string) {
  const [[settings], [owner], [booking]] = await Promise.all([
    db.select().from(posMenuSettings).where(eq(posMenuSettings.companyId, companyId)).limit(1),
    db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1),
    db.select({ slug: posBookingSettings.slug }).from(posBookingSettings).where(eq(posBookingSettings.companyId, companyId)).limit(1),
  ]);
  return {
    enabled: settings?.enabled ?? false,
    slug: settings?.slug ?? booking?.slug ?? (slugify(owner?.name ?? "") || "mi-local"),
    intro: settings?.intro ?? null,
    introEn: settings?.introEn ?? null,
    showBookingLink: settings?.showBookingLink ?? true,
  };
}

export async function saveMenuSettings(actor: PosActor, input: { enabled: boolean; slug: string; intro: string | null; introEn: string | null; showBookingLink: boolean }) {
  const slug = slugify(input.slug);
  if (slug.length < 3) throw new HttpError(400, "La dirección de la carta debe tener al menos 3 letras o números.");
  const [taken] = await db.select({ id: posMenuSettings.id }).from(posMenuSettings).where(and(eq(posMenuSettings.slug, slug), ne(posMenuSettings.companyId, actor.companyId))).limit(1);
  if (taken) throw new HttpError(409, `La dirección «${slug}» ya la usa otro local: elige otra.`);
  const values = { enabled: input.enabled, slug, intro: input.intro?.trim() || null, introEn: input.introEn?.trim() || null, showBookingLink: input.showBookingLink, updatedAt: new Date() };
  await db.insert(posMenuSettings).values({ companyId: actor.companyId, ...values }).onConflictDoUpdate({ target: posMenuSettings.companyId, set: values });
  await audit(actor, "pos_menu_settings.update", "pos_menu_settings", actor.companyId, values);
  return { slug };
}

// ---------------------------------------------------------------------------------------------
// Gestión: secciones y fichas
// ---------------------------------------------------------------------------------------------

export type SectionInput = { name: string; nameEn: string | null; description: string | null; descriptionEn: string | null; weekdays: number[]; fromTime: string | null; toTime: string | null; fixedPrice: number | null; isActive: boolean };

function sectionValues(input: SectionInput) {
  if (Boolean(input.fromTime) !== Boolean(input.toTime)) throw new HttpError(400, "Pon la hora de inicio y la de fin, o ninguna.");
  return {
    name: input.name.trim(),
    nameEn: input.nameEn?.trim() || null,
    description: input.description?.trim() || null,
    descriptionEn: input.descriptionEn?.trim() || null,
    weekdays: [...new Set(input.weekdays)].filter((day) => day >= 0 && day <= 6).sort(),
    fromTime: input.fromTime || null,
    toTime: input.toTime || null,
    fixedPrice: input.fixedPrice === null ? null : input.fixedPrice.toFixed(2),
    isActive: input.isActive,
  };
}

export async function createSection(actor: PosActor, input: SectionInput) {
  const [{ max }] = await db.select({ max: sql<number | null>`max(${posMenuSection.position})` }).from(posMenuSection).where(eq(posMenuSection.companyId, actor.companyId));
  const [created] = await db.insert(posMenuSection).values({ companyId: actor.companyId, position: (max ?? -1) + 1, ...sectionValues(input) }).returning({ id: posMenuSection.id });
  await audit(actor, "pos_menu_section.create", "pos_menu_section", created.id, { name: input.name });
  return created;
}

export async function updateSection(actor: PosActor, sectionId: string, input: SectionInput) {
  const [updated] = await db.update(posMenuSection).set(sectionValues(input)).where(and(eq(posMenuSection.id, sectionId), eq(posMenuSection.companyId, actor.companyId))).returning({ id: posMenuSection.id });
  if (!updated) throw new HttpError(404, "Sección no encontrada.");
  await audit(actor, "pos_menu_section.update", "pos_menu_section", sectionId, { name: input.name });
  return updated;
}

export async function deleteSection(actor: PosActor, sectionId: string) {
  await db.delete(posMenuSection).where(and(eq(posMenuSection.id, sectionId), eq(posMenuSection.companyId, actor.companyId)));
  await audit(actor, "pos_menu_section.delete", "pos_menu_section", sectionId, {});
}

/** Sube o baja una sección un puesto. */
export async function moveSection(actor: PosActor, sectionId: string, direction: "up" | "down") {
  const sections = await db.select({ id: posMenuSection.id }).from(posMenuSection).where(eq(posMenuSection.companyId, actor.companyId)).orderBy(asc(posMenuSection.position), asc(posMenuSection.name));
  const index = sections.findIndex((section) => section.id === sectionId);
  if (index < 0) throw new HttpError(404, "Sección no encontrada.");
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= sections.length) return { moved: false };
  [sections[index], sections[target]] = [sections[target], sections[index]];
  await db.transaction(async (tx) => {
    for (const [position, section] of sections.entries()) await tx.update(posMenuSection).set({ position }).where(eq(posMenuSection.id, section.id));
  });
  return { moved: true };
}

async function assertItem(companyId: string, itemId: string) {
  const [row] = await db.select({ id: item.id }).from(item).where(and(eq(item.id, itemId), eq(item.companyId, companyId))).limit(1);
  if (!row) throw new HttpError(404, "Artículo no encontrado.");
}

async function assertSection(companyId: string, sectionId: string | null) {
  if (!sectionId) return;
  const [row] = await db.select({ id: posMenuSection.id }).from(posMenuSection).where(and(eq(posMenuSection.id, sectionId), eq(posMenuSection.companyId, companyId))).limit(1);
  if (!row) throw new HttpError(404, "Sección no encontrada.");
}

export type MenuItemInput = { sectionId: string | null; visible: boolean; displayName: string | null; nameEn: string | null; description: string | null; descriptionEn: string | null; allergens: string[]; traces: string[]; tags: string[] };

export async function saveMenuItem(actor: PosActor, itemId: string, input: MenuItemInput) {
  await assertItem(actor.companyId, itemId);
  await assertSection(actor.companyId, input.sectionId);
  const values = {
    sectionId: input.sectionId,
    visible: input.visible,
    displayName: input.displayName?.trim() || null,
    nameEn: input.nameEn?.trim() || null,
    description: input.description?.trim() || null,
    descriptionEn: input.descriptionEn?.trim() || null,
    allergens: ALLERGEN_IDS.filter((id) => input.allergens.includes(id)),
    // Si lo lleva, no son trazas.
    traces: ALLERGEN_IDS.filter((id) => input.traces.includes(id) && !input.allergens.includes(id)),
    tags: MENU_TAG_IDS.filter((id) => input.tags.includes(id)),
    // Guardar la ficha es revisar sus alérgenos (aunque no tenga ninguno).
    allergensReviewedAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insert(posMenuItem).values({ companyId: actor.companyId, itemId, ...values }).onConflictDoUpdate({ target: posMenuItem.itemId, set: values });
  await audit(actor, "pos_menu_item.update", "item", itemId, { ...values, updatedAt: undefined });
  return { itemId };
}

/** Mostrar u ocultar en la carta (crea la ficha si no existía). */
export async function setMenuItemVisible(actor: PosActor, itemId: string, visible: boolean) {
  await assertItem(actor.companyId, itemId);
  await db.insert(posMenuItem).values({ companyId: actor.companyId, itemId, visible }).onConflictDoUpdate({ target: posMenuItem.itemId, set: { visible, updatedAt: new Date() } });
  return { itemId, visible };
}

/** Agotado hoy (fecha local): se ve en la carta como «Agotado» hasta mañana. */
export async function setSoldOut(actor: PosActor, itemId: string, soldOut: boolean) {
  await assertItem(actor.companyId, itemId);
  const { date } = await companyToday(actor.companyId);
  const soldOutDate = soldOut ? date : null;
  await db.insert(posMenuItem).values({ companyId: actor.companyId, itemId, visible: false, soldOutDate }).onConflictDoUpdate({ target: posMenuItem.itemId, set: { soldOutDate, updatedAt: new Date() } });
  await audit(actor, soldOut ? "pos_menu_item.sold_out" : "pos_menu_item.available", "item", itemId, { date });
  return { itemId, soldOut };
}

export async function setMenuItemImage(actor: PosActor, itemId: string, image: string | null) {
  await assertItem(actor.companyId, itemId);
  if (image !== null) {
    const match = IMAGE_PATTERN.exec(image);
    if (!match) throw new HttpError(400, "La foto debe ser JPEG, PNG o WebP.");
    if (Math.floor((match[2].length * 3) / 4) > MAX_IMAGE_BYTES) throw new HttpError(413, "La foto es demasiado grande (máx. 450 KB).");
  }
  await db
    .insert(posMenuItem)
    .values({ companyId: actor.companyId, itemId, image, imageVersion: 1 })
    .onConflictDoUpdate({ target: posMenuItem.itemId, set: { image, imageVersion: sql`${posMenuItem.imageVersion} + 1`, updatedAt: new Date() } });
  await audit(actor, "pos_menu_item.image", "item", itemId, { removed: image === null });
  return { itemId };
}

/** Primer arranque: una sección por categoría de artículos y todos sus artículos en la carta. */
export async function importCategories(actor: PosActor) {
  const categories = await db
    .select({ id: itemCategory.id, name: itemCategory.name })
    .from(itemCategory)
    .where(and(eq(itemCategory.companyId, actor.companyId), sql`exists (select 1 from ${item} where ${item.categoryId} = ${itemCategory.id} and ${item.isActive} = true)`))
    .orderBy(asc(itemCategory.name));
  const existing = await db.select({ id: posMenuSection.id, name: posMenuSection.name, position: posMenuSection.position }).from(posMenuSection).where(eq(posMenuSection.companyId, actor.companyId));
  let position = Math.max(-1, ...existing.map((section) => section.position)) + 1;
  let sections = 0;
  let dishes = 0;
  await db.transaction(async (tx) => {
    for (const category of categories) {
      let section = existing.find((entry) => entry.name.toLowerCase() === category.name.toLowerCase());
      if (!section) {
        const [created] = await tx.insert(posMenuSection).values({ companyId: actor.companyId, name: category.name, position }).returning({ id: posMenuSection.id, name: posMenuSection.name, position: posMenuSection.position });
        section = created;
        position += 1;
        sections += 1;
      }
      const items = await tx.select({ id: item.id }).from(item).where(and(eq(item.companyId, actor.companyId), eq(item.categoryId, category.id), eq(item.isActive, true)));
      if (items.length === 0) continue;
      const inserted = await tx
        .insert(posMenuItem)
        .values(items.map((row) => ({ companyId: actor.companyId, itemId: row.id, sectionId: section!.id, visible: true })))
        .onConflictDoNothing()
        .returning({ id: posMenuItem.id });
      dishes += inserted.length;
    }
  });
  await audit(actor, "pos_menu.import_categories", "pos_menu_settings", actor.companyId, { sections, dishes });
  return { sections, dishes };
}

/** Todo lo que necesita la pantalla de gestión de la carta. */
export async function getMenuAdmin(companyId: string) {
  const [settings, sections, rows, catalog, today] = await Promise.all([
    getMenuSettings(companyId),
    db.select().from(posMenuSection).where(eq(posMenuSection.companyId, companyId)).orderBy(asc(posMenuSection.position), asc(posMenuSection.name)),
    db
      .select({
        itemId: posMenuItem.itemId,
        sectionId: posMenuItem.sectionId,
        visible: posMenuItem.visible,
        displayName: posMenuItem.displayName,
        nameEn: posMenuItem.nameEn,
        description: posMenuItem.description,
        descriptionEn: posMenuItem.descriptionEn,
        allergens: posMenuItem.allergens,
        traces: posMenuItem.traces,
        reviewedAt: posMenuItem.allergensReviewedAt,
        tags: posMenuItem.tags,
        hasImage: sql<boolean>`${posMenuItem.image} is not null`,
        imageVersion: posMenuItem.imageVersion,
        id: posMenuItem.id,
        soldOutDate: posMenuItem.soldOutDate,
      })
      .from(posMenuItem)
      .where(eq(posMenuItem.companyId, companyId)),
    listPosCatalog(companyId, null, false),
    companyToday(companyId),
  ]);
  const byItem = new Map(rows.map((row) => [row.itemId, row]));
  return {
    settings,
    sections: sections.map((section) => ({ id: section.id, name: section.name, nameEn: section.nameEn, description: section.description, descriptionEn: section.descriptionEn, weekdays: section.weekdays, fromTime: section.fromTime, toTime: section.toTime, fixedPrice: section.fixedPrice === null ? null : Number(section.fixedPrice), isActive: section.isActive })),
    items: catalog.map((entry) => {
      const row = byItem.get(entry.id);
      return {
        itemId: entry.id,
        sku: entry.sku,
        name: entry.name,
        categoryName: entry.categoryName,
        price: grossPrice(entry.unitPrice, entry.taxRate),
        sectionId: row?.sectionId ?? null,
        visible: row?.visible ?? false,
        displayName: row?.displayName ?? null,
        nameEn: row?.nameEn ?? null,
        description: row?.description ?? null,
        descriptionEn: row?.descriptionEn ?? null,
        allergens: row?.allergens ?? [],
        traces: row?.traces ?? [],
        reviewed: Boolean(row?.reviewedAt),
        conflicts: dietConflicts(row?.allergens ?? [], row?.tags ?? [], row?.traces ?? []),
        tags: row?.tags ?? [],
        imageUrl: row?.hasImage ? `/api/public/menu/image/${row.id}?v=${row.imageVersion}` : null,
        soldOut: row?.soldOutDate === today.date,
      };
    }),
  };
}

export type MenuAdmin = Awaited<ReturnType<typeof getMenuAdmin>>;

// ---------------------------------------------------------------------------------------------
// Carta pública
// ---------------------------------------------------------------------------------------------

export async function getPublicMenu(slug: string, lang: MenuLang, tableId: string | null) {
  const [settings] = await db
    .select({ companyId: posMenuSettings.companyId, enabled: posMenuSettings.enabled, slug: posMenuSettings.slug, intro: posMenuSettings.intro, introEn: posMenuSettings.introEn, showBookingLink: posMenuSettings.showBookingLink })
    .from(posMenuSettings)
    .where(eq(posMenuSettings.slug, slugify(slug)))
    .limit(1);
  if (!settings || !settings.enabled || !(await isModuleEnabled(settings.companyId, "hospitality"))) return null;
  const companyId = settings.companyId;
  const [[owner], sections, rows, catalog, today, [booking], [table]] = await Promise.all([
    db.select({ name: company.name, address: company.fiscalAddress, city: company.city, phone: company.phone, logo: company.logoDataUrl, currency: company.baseCurrencyCode }).from(company).where(eq(company.id, companyId)).limit(1),
    db.select().from(posMenuSection).where(and(eq(posMenuSection.companyId, companyId), eq(posMenuSection.isActive, true))).orderBy(asc(posMenuSection.position), asc(posMenuSection.name)),
    db
      .select({ id: posMenuItem.id, itemId: posMenuItem.itemId, sectionId: posMenuItem.sectionId, position: posMenuItem.position, displayName: posMenuItem.displayName, nameEn: posMenuItem.nameEn, description: posMenuItem.description, descriptionEn: posMenuItem.descriptionEn, allergens: posMenuItem.allergens, traces: posMenuItem.traces, reviewedAt: posMenuItem.allergensReviewedAt, tags: posMenuItem.tags, hasImage: sql<boolean>`${posMenuItem.image} is not null`, imageVersion: posMenuItem.imageVersion, soldOutDate: posMenuItem.soldOutDate })
      .from(posMenuItem)
      .where(and(eq(posMenuItem.companyId, companyId), eq(posMenuItem.visible, true))),
    listPosCatalog(companyId, null, false),
    companyToday(companyId),
    settings.showBookingLink ? db.select({ slug: posBookingSettings.slug }).from(posBookingSettings).where(and(eq(posBookingSettings.companyId, companyId), eq(posBookingSettings.enabled, true))).limit(1) : Promise.resolve([]),
    tableId ? db.select({ name: posTable.name }).from(posTable).innerJoin(posArea, eq(posArea.id, posTable.areaId)).where(and(eq(posTable.id, tableId), eq(posTable.companyId, companyId), eq(posTable.isActive, true))).limit(1) : Promise.resolve([]),
  ]);
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const dishes = rows
    .filter((row) => catalogById.has(row.itemId))
    .map((row) => {
      const entry = catalogById.get(row.itemId)!;
      return {
        id: row.id,
        sectionId: row.sectionId,
        position: row.position,
        name: localized(row.displayName ?? entry.name, row.nameEn, lang)!,
        description: localized(row.description, row.descriptionEn, lang),
        price: grossPrice(entry.unitPrice, entry.taxRate),
        allergens: row.allergens,
        traces: row.traces,
        reviewed: Boolean(row.reviewedAt),
        tags: row.tags,
        imageUrl: row.hasImage ? `/api/public/menu/image/${row.id}?v=${row.imageVersion}` : null,
        soldOut: row.soldOutDate === today.date,
      };
    })
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "es"));
  const knownSections = new Set(sections.map((section) => section.id));
  const publicSections = sections
    .map((section) => {
      const schedule = { weekdays: section.weekdays, fromTime: section.fromTime, toTime: section.toTime };
      return {
        id: section.id,
        name: localized(section.name, section.nameEn, lang)!,
        description: localized(section.description, section.descriptionEn, lang),
        fixedPrice: section.fixedPrice === null ? null : Number(section.fixedPrice),
        availableNow: isSectionAvailable(schedule, today),
        schedule: scheduleLabel(schedule, lang),
        dishes: dishes.filter((dish) => dish.sectionId === section.id),
      };
    })
    .filter((section) => section.dishes.length > 0 || section.fixedPrice !== null);
  const loose = dishes.filter((dish) => !dish.sectionId || !knownSections.has(dish.sectionId));
  if (loose.length > 0) publicSections.push({ id: "otros", name: lang === "en" ? "More" : "Otros", description: null, fixedPrice: null, availableNow: true, schedule: null, dishes: loose });
  // Lo que se sirve ahora, primero; lo de otras horas, al final.
  publicSections.sort((a, b) => Number(b.availableNow) - Number(a.availableNow));
  return {
    slug: settings.slug,
    name: owner?.name ?? "",
    address: [owner?.address, owner?.city].filter(Boolean).join(", ") || null,
    phone: owner?.phone ?? null,
    logo: owner?.logo ?? null,
    currency: owner?.currency ?? "EUR",
    intro: localized(settings.intro, settings.introEn, lang),
    hasEnglish: Boolean(settings.introEn || rows.some((row) => row.nameEn) || sections.some((section) => section.nameEn)),
    bookingSlug: booking?.slug ?? null,
    tableName: table?.name ?? null,
    sections: publicSections,
  };
}

export type PublicMenu = NonNullable<Awaited<ReturnType<typeof getPublicMenu>>>;

/** Foto de un plato (la misma URL sirve a la carta pública y a la pantalla de gestión). */
export async function getMenuImage(menuItemId: string) {
  const [row] = await db
    .select({ image: posMenuItem.image })
    .from(posMenuItem)
    .where(and(eq(posMenuItem.id, menuItemId), isNotNull(posMenuItem.image)))
    .limit(1);
  if (!row?.image) return null;
  const match = IMAGE_PATTERN.exec(row.image);
  if (!match) return null;
  return { contentType: `image/${match[1]}`, body: Buffer.from(match[2], "base64") };
}

/** Mesas para la hoja de QR. */
export async function listQrTables(companyId: string) {
  return db
    .select({ id: posTable.id, name: posTable.name, areaName: posArea.name })
    .from(posTable)
    .innerJoin(posArea, eq(posArea.id, posTable.areaId))
    .where(and(eq(posTable.companyId, companyId), eq(posTable.isActive, true)))
    .orderBy(asc(posArea.position), asc(posTable.position), asc(posTable.name));
}

export async function countSoldOut(companyId: string) {
  const { date } = await companyToday(companyId);
  const rows = await db.select({ itemId: posMenuItem.itemId }).from(posMenuItem).where(and(eq(posMenuItem.companyId, companyId), eq(posMenuItem.soldOutDate, date)));
  return rows.map((row) => row.itemId);
}


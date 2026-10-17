import { z } from "zod";

const id = z.string().trim().min(1);
const amount = z.number().min(0).max(999_999_999);

export const openOrderSchema = z.object({
  registerId: id,
  tableId: z.string().trim().nullable().optional(),
  label: z.string().trim().max(60).nullable().optional(),
  guests: z.number().int().min(1).max(200).optional(),
  waiterUserId: z.string().trim().nullable().optional(),
});

export const updateOrderSchema = z.object({
  guests: z.number().int().min(1).max(200).optional(),
  waiterUserId: z.string().trim().nullable().optional(),
  label: z.string().trim().max(60).nullable().optional(),
});

export const addLinesSchema = z.object({
  waiterUserId: z.string().trim().nullable().optional(),
  lines: z.array(z.object({
    itemId: z.string().trim().nullable().optional(),
    description: z.string().trim().min(1).max(300),
    quantity: z.number().positive().max(10_000),
    unitPrice: amount,
    taxRate: z.number().min(0).max(100),
    taxId: z.string().trim().nullable().optional(),
    note: z.string().trim().max(200).nullable().optional(),
    course: z.number().int().min(0).max(4).nullable().optional(),
    modifierOptionIds: z.array(id).max(50).optional(),
    setMenuPicks: z.array(z.object({ courseId: id, itemId: id })).max(10).optional(),
  })).min(1).max(100),
});

export const updateLineSchema = z.object({
  quantity: z.number().min(0).max(10_000).optional(),
  note: z.string().trim().max(200).nullable().optional(),
  cancelReason: z.string().trim().max(200).nullable().optional(),
  course: z.number().int().min(1).max(4).optional(),
});

export const modifierGroupSchema = z.object({
  name: z.string().trim().min(1, "Pon nombre al grupo.").max(60),
  minSelect: z.number().int().min(0).max(20),
  maxSelect: z.number().int().min(1).max(20),
  options: z.array(z.object({ name: z.string().trim().min(1, "Las opciones necesitan nombre.").max(60), price: z.number().min(0).max(10_000) })).min(1, "Añade al menos una opción.").max(40),
  itemIds: z.array(id).max(1000),
});

export const setMenuSchema = z.object({
  courses: z.array(z.object({
    name: z.string().trim().min(1, "Pon nombre al tiempo (Primero, Segundo…).").max(40),
    course: z.number().int().min(0).max(4),
    choices: z.array(z.object({ itemId: id, supplement: z.number().min(0).max(10_000) })).min(1).max(60),
  })).min(1).max(8),
});

export const moveSchema = z.object({ tableId: id });
export const mergeSchema = z.object({ targetOrderId: id });
export const transferSchema = z.object({ tableId: id, lines: z.array(z.object({ lineId: id, quantity: z.number().positive() })).min(1).max(100) });
export const cancelSchema = z.object({ reason: z.string().trim().max(200).default("") });

export const paySchema = z.object({
  clientRequestId: z.string().trim().min(8).max(80),
  part: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("all") }),
    z.object({ mode: z.literal("lines"), lines: z.array(z.object({ lineId: id, quantity: z.number().positive() })).min(1).max(100) }),
    z.object({ mode: z.literal("equal"), parts: z.number().int().min(2).max(50) }),
  ]),
  payment: z.object({ cash: amount, card: amount, cashReceived: amount.nullable().optional() }),
  customerId: z.string().trim().nullable().optional(),
  tipAmount: z.number().min(0).max(10_000).optional(),
  waiterUserId: z.string().trim().nullable().optional(),
});

export const kitchenStatusSchema = z.object({ lineIds: z.array(id).min(1).max(200), status: z.enum(["SENT", "READY", "SERVED"]) });

export const areaSchema = z.object({ name: z.string().trim().min(1, "Pon nombre a la sala.").max(40) });
export const areaUpdateSchema = z.object({ name: z.string().trim().min(1).max(40).optional(), position: z.number().int().min(0).max(1000).optional(), bookable: z.boolean().optional() });
export const layoutSchema = z.object({
  tables: z.array(z.object({ id, posX: z.number().int().min(0).max(100), posY: z.number().int().min(0).max(100), width: z.number().int().min(1).max(24), height: z.number().int().min(1).max(16), shape: z.enum(["SQUARE", "ROUND", "RECT"]) })).max(300),
});
export const tablesSchema = z.object({ areaId: id, prefix: z.string().trim().max(20).default("Mesa"), from: z.number().int().min(0).max(9999), to: z.number().int().min(0).max(9999), seats: z.number().int().min(1).max(50).default(4) });
export const tableUpdateSchema = z.object({ name: z.string().trim().min(1).max(30).optional(), seats: z.number().int().min(1).max(50).optional(), isActive: z.boolean().optional(), areaId: z.string().trim().optional(), shape: z.enum(["SQUARE", "ROUND", "RECT"]).optional(), bookable: z.boolean().optional() });
export const stationsSchema = z.object({ entries: z.array(z.object({ categoryId: id, station: z.enum(["KITCHEN", "BAR", "NONE"]) })).max(500) });
export const pinSchema = z.object({ pin: z.string().trim().regex(/^(\d{4,6})?$/, "El PIN tiene de 4 a 6 cifras.").nullable() });
export const verifySchema = z.object({ pin: z.string().trim().max(6) });

export function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

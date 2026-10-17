import type { TableShape } from "@/modules/hospitality/floor-plan";
import type { EqualSplit, LineStatus, OrderStatus, Station } from "@/modules/hospitality/model";

/** JSON que devuelve la API de hostelería (fechas como texto). */
export type FloorOrder = {
  id: string;
  tableId: string | null;
  label: string | null;
  status: OrderStatus;
  guests: number;
  openedAt: string;
  waiterName: string | null;
  total: number;
  pending: number;
  unsent: number;
  ready: number;
};

export type FloorBooking = { id: string; time: string; name: string; partySize: number; late: boolean };
export type FloorTable = { id: string; name: string; seats: number; shape: TableShape; posX: number; posY: number; width: number; height: number; order: FloorOrder | null; booking: FloorBooking | null };

export type FloorData = {
  areas: Array<{ id: string; name: string; planned: boolean; tables: FloorTable[] }>;
  loose: FloorOrder[];
  pendingBookings: number;
};

export type OrderLineView = {
  id: string;
  orderId: string;
  itemId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxId: string | null;
  note: string | null;
  station: Station;
  status: LineStatus;
  paidQuantity: number;
  sentAt: string | null;
  createdAt: string;
  addedByName: string | null;
};

export type OrderData = {
  id: string;
  registerId: string;
  tableId: string | null;
  tableName: string | null;
  areaName: string | null;
  label: string | null;
  name: string;
  status: OrderStatus;
  guests: number;
  equalSplit: EqualSplit | null;
  waiterUserId: string | null;
  waiterName: string | null;
  openedAt: string;
  closedAt: string | null;
  lines: OrderLineView[];
  amounts: { total: number; pending: number; paid: number };
  tickets: Array<{ id: string; invoiceId: string; totalAmount: number; tipAmount: number; createdAt: string }>;
};

export async function postJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  const { getCsrfHeader } = await import("@/lib/csrf-client");
  const { readApiError } = await import("@/components/ui/form");
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await readApiError(response, "No se pudo completar la operación."));
  return (response.status === 204 ? null : await response.json()) as T;
}

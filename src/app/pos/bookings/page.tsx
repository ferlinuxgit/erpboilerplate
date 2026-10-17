import type { Metadata } from "next";

import { BookingsDay } from "@/components/bookings/bookings-day";
import { requireContext } from "@/lib/current-context";
import { isDate, zonedParts } from "@/modules/hospitality/bookings";
import { listBookings } from "@/server/pos/bookings";
import { listRegisters } from "@/server/pos/service";

export const metadata: Metadata = { title: "Reservas" };

/** Reservas del día en la tablet del local (?date=AAAA-MM-DD, ?register=<caja> para volver a sus mesas). */
export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ date?: string; register?: string }> }) {
  const ctx = await requireContext("pos.sell");
  const params = await searchParams;
  const today = zonedParts(new Date(), ctx.company.timezone).date;
  const date = params.date && isDate(params.date) ? params.date : today;
  const [day, registers] = await Promise.all([listBookings(ctx.company.id, date), listRegisters(ctx.company.id)]);
  const tableRegisters = registers.filter((register) => register.mode === "TABLES" && register.isActive !== false).map((register) => ({ id: register.id, name: register.name }));
  const registerId = tableRegisters.some((register) => register.id === params.register) ? params.register! : null;
  return <BookingsDay initial={JSON.parse(JSON.stringify(day))} key={date} registerId={registerId} registers={tableRegisters} today={today} />;
}

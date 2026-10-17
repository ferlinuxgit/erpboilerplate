/**
 * Reservas de mesa: horas disponibles y elección de mesa. Todo es puro (sin base de datos) para poder
 * probarlo: las horas se calculan en la zona horaria de la empresa y se guardan en UTC.
 */

export const BOOKING_STATUSES = ["AWAITING_PAYMENT", "PENDING", "CONFIRMED", "SEATED", "COMPLETED", "NO_SHOW", "CANCELLED"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
/** Estados que ocupan la mesa (esperando el pago de la fianza la retiene unos minutos). */
export const ACTIVE_BOOKING_STATUSES = ["AWAITING_PAYMENT", "PENDING", "CONFIRMED", "SEATED"] as const satisfies readonly BookingStatus[];
export type DepositStatus = "NONE" | "PENDING" | "PAID" | "REFUNDED" | "KEPT";
export const depositStatusLabels: Record<DepositStatus, string> = { NONE: "Sin fianza", PENDING: "Fianza pendiente", PAID: "Fianza pagada", REFUNDED: "Fianza devuelta", KEPT: "Fianza retenida" };
/** Minutos que se guarda la mesa mientras el cliente paga la fianza. */
export const DEPOSIT_HOLD_MINUTES = 15;

/** Fianza de una reserva: importe por persona desde cierto número de comensales (null si no aplica). */
export function depositFor(settings: { depositEnabled: boolean; depositPerPerson: number; depositMinParty: number }, partySize: number) {
  if (!settings.depositEnabled || settings.depositPerPerson <= 0 || partySize < settings.depositMinParty) return null;
  return Math.round(settings.depositPerPerson * partySize * 100) / 100;
}
export const BOOKING_SOURCES = ["WEB", "PHONE", "WALK_IN", "STAFF"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export const bookingStatusLabels: Record<BookingStatus, string> = {
  AWAITING_PAYMENT: "Esperando fianza",
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  SEATED: "Sentados",
  COMPLETED: "Terminada",
  NO_SHOW: "No vino",
  CANCELLED: "Cancelada",
};
export const bookingSourceLabels: Record<BookingSource, string> = { WEB: "Web", PHONE: "Teléfono", WALK_IN: "Sin reserva", STAFF: "Personal" };
export const WEEKDAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;

export type BookingRules = {
  slotMinutes: number;
  durationMinutes: number;
  minPartySize: number;
  maxPartySize: number;
  leadMinutes: number;
  maxDaysAhead: number;
  allowCombining: boolean;
};
export type BookingShift = { weekday: number; opensAt: string; lastStart: string };
export type BookableTable = { id: string; name: string; areaId: string; seats: number };
export type BusyBooking = { id?: string; startsAt: Date; endsAt: Date; tableIds: readonly string[] };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isTime(value: string) {
  return TIME.test(value);
}

export function isDate(value: string) {
  return DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

export function minutesOfDay(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function timeFromMinutes(total: number) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Fecha, hora y día de la semana de un instante en la zona horaria dada. */
export function zonedParts(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time: `${parts.hour}:${parts.minute}`, weekday: new Date(`${date}T00:00:00Z`).getUTCDay() };
}

/** Instante UTC de una fecha y hora de reloj en la zona dada (en el salto de hora se usa el desfase previo). */
export function zonedToUtc(date: string, time: string, timeZone: string) {
  const guess = new Date(`${date}T${time}:00Z`);
  const offset = (instant: Date) => {
    const local = zonedParts(instant, timeZone);
    return Date.parse(`${local.date}T${local.time}:00Z`) - instant.getTime();
  };
  const first = new Date(guess.getTime() - offset(guess));
  return new Date(guess.getTime() - offset(first));
}

export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function weekdayOf(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Horas de inicio de un día según los turnos (sin contar ocupación). */
export function shiftStarts(date: string, shifts: readonly BookingShift[], slotMinutes: number) {
  const weekday = weekdayOf(date);
  const starts = new Set<number>();
  for (const shift of shifts) {
    if (shift.weekday !== weekday || !isTime(shift.opensAt) || !isTime(shift.lastStart)) continue;
    for (let minute = minutesOfDay(shift.opensAt); minute <= minutesOfDay(shift.lastStart); minute += slotMinutes) starts.add(minute);
  }
  return [...starts].sort((a, b) => a - b).map(timeFromMinutes);
}

/** Por qué un día no admite reservas online (o null si las admite). */
export function dateUnavailableReason(input: { date: string; today: string; rules: Pick<BookingRules, "maxDaysAhead">; closures: ReadonlyArray<{ date: string; reason?: string | null }> }) {
  if (!isDate(input.date)) return "Fecha no válida.";
  if (input.date < input.today) return "Esa fecha ya ha pasado.";
  if (input.date > addDays(input.today, input.rules.maxDaysAhead)) return `Solo se puede reservar con ${input.rules.maxDaysAhead} días de antelación como máximo.`;
  const closure = input.closures.find((entry) => entry.date === input.date);
  if (closure) return closure.reason?.trim() ? `Cerrado: ${closure.reason.trim()}.` : "Ese día no hay reservas.";
  return null;
}

export function overlapsInterval(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

export function busyTableIds(window: { startsAt: Date; endsAt: Date }, bookings: readonly BusyBooking[], ignoreBookingId?: string) {
  const busy = new Set<string>();
  for (const booking of bookings) {
    if (ignoreBookingId && booking.id === ignoreBookingId) continue;
    if (overlapsInterval(window, booking)) for (const id of booking.tableIds) busy.add(id);
  }
  return busy;
}

/**
 * Mesa para un grupo: la libre más ajustada (la de menos plazas que les quepa); si ninguna basta y se
 * permite, dos mesas libres de la misma sala con el menor total de plazas. Null si no hay sitio.
 */
export function pickTables(partySize: number, tables: readonly BookableTable[], busy: ReadonlySet<string>, allowCombining: boolean): BookableTable[] | null {
  const free = tables.filter((table) => !busy.has(table.id));
  const byName = (a: BookableTable, b: BookableTable) => a.name.localeCompare(b.name, "es", { numeric: true });
  const single = free.filter((table) => table.seats >= partySize).sort((a, b) => a.seats - b.seats || byName(a, b))[0];
  if (single) return [single];
  if (!allowCombining) return null;
  let best: [BookableTable, BookableTable] | null = null;
  const sorted = [...free].sort(byName);
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const pair: [BookableTable, BookableTable] = [sorted[i], sorted[j]];
      const seats = pair[0].seats + pair[1].seats;
      if (pair[0].areaId !== pair[1].areaId || seats < partySize) continue;
      if (!best || seats < best[0].seats + best[1].seats) best = pair;
    }
  }
  return best;
}

export type SlotAvailability = { time: string; startsAt: Date; available: boolean; tables: BookableTable[] | null };

/** Horas de un día con su disponibilidad para un grupo. */
export function daySlots(input: {
  date: string;
  partySize: number;
  timeZone: string;
  now: Date;
  rules: BookingRules;
  shifts: readonly BookingShift[];
  tables: readonly BookableTable[];
  bookings: readonly BusyBooking[];
  /** El personal puede reservar para ya mismo, sin antelación mínima. */
  ignoreLead?: boolean;
  ignoreBookingId?: string;
}): SlotAvailability[] {
  const earliest = input.now.getTime() + (input.ignoreLead ? 0 : input.rules.leadMinutes * 60_000);
  return shiftStarts(input.date, input.shifts, input.rules.slotMinutes).flatMap((time) => {
    const startsAt = zonedToUtc(input.date, time, input.timeZone);
    if (startsAt.getTime() < earliest) return [];
    const endsAt = new Date(startsAt.getTime() + input.rules.durationMinutes * 60_000);
    const tables = pickTables(input.partySize, input.tables, busyTableIds({ startsAt, endsAt }, input.bookings, input.ignoreBookingId), input.rules.allowCombining);
    return [{ time, startsAt, available: Boolean(tables), tables }];
  });
}

/** Localizador corto sin caracteres que se confunden (0/O, 1/I/L). */
export function bookingCode(random: (max: number) => number) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[random(alphabet.length)]).join("");
}

/** ¿Puede el cliente cancelar online todavía? */
export function canCustomerCancel(booking: { status: string; startsAt: Date }, cancellationHours: number, now: Date) {
  if (booking.status === "AWAITING_PAYMENT") return true;
  if (!["PENDING", "CONFIRMED"].includes(booking.status)) return false;
  return booking.startsAt.getTime() - now.getTime() >= cancellationHours * 3_600_000;
}

/** Slug de dirección pública a partir del nombre del local. */
export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function icsText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

function icsDate(instant: Date) {
  return instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Evento de calendario (.ics) de la reserva. */
export function bookingIcs(input: { code: string; startsAt: Date; endsAt: Date; title: string; description: string; location?: string | null; now: Date; cancelled?: boolean }) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ERP//Reservas//ES",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${input.code}@reservas`,
    `DTSTAMP:${icsDate(input.now)}`,
    `DTSTART:${icsDate(input.startsAt)}`,
    `DTEND:${icsDate(input.endsAt)}`,
    `SUMMARY:${icsText(input.title)}`,
    `DESCRIPTION:${icsText(input.description)}`,
    ...(input.location ? [`LOCATION:${icsText(input.location)}`] : []),
    `STATUS:${input.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

import { describe, expect, it } from "vitest";

import { bookingCode, bookingIcs, canCustomerCancel, dateUnavailableReason, daySlots, isDate, pickTables, shiftStarts, slugify, zonedParts, zonedToUtc, type BookingRules } from "./bookings";

const rules: BookingRules = { slotMinutes: 30, durationMinutes: 90, minPartySize: 1, maxPartySize: 8, leadMinutes: 60, maxDaysAhead: 30, allowCombining: true };
const tables = [
  { id: "t1", name: "Mesa 1", areaId: "salon", seats: 2 },
  { id: "t2", name: "Mesa 2", areaId: "salon", seats: 4 },
  { id: "t3", name: "Mesa 3", areaId: "salon", seats: 4 },
  { id: "t4", name: "Mesa 4", areaId: "terraza", seats: 6 },
];

describe("zonas horarias", () => {
  it("convierte la hora de Madrid a UTC en invierno y en verano", () => {
    expect(zonedToUtc("2026-01-15", "21:00", "Europe/Madrid").toISOString()).toBe("2026-01-15T20:00:00.000Z");
    expect(zonedToUtc("2026-07-15", "21:00", "Europe/Madrid").toISOString()).toBe("2026-07-15T19:00:00.000Z");
    expect(zonedToUtc("2026-07-15", "21:00", "Atlantic/Canary").toISOString()).toBe("2026-07-15T20:00:00.000Z");
  });

  it("devuelve fecha, hora y día de la semana locales", () => {
    expect(zonedParts(new Date("2026-03-01T23:30:00Z"), "Europe/Madrid")).toEqual({ date: "2026-03-02", time: "00:30", weekday: 1 });
  });

  it("valida fechas reales", () => {
    expect(isDate("2026-02-28")).toBe(true);
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("28/02/2026")).toBe(false);
  });
});

describe("turnos", () => {
  it("genera las horas de inicio de los turnos de ese día sin repetir", () => {
    const shifts = [
      { weekday: 5, opensAt: "13:00", lastStart: "14:30" },
      { weekday: 5, opensAt: "20:30", lastStart: "21:30" },
      { weekday: 6, opensAt: "13:00", lastStart: "15:00" },
    ];
    expect(shiftStarts("2026-10-16", shifts, 30)).toEqual(["13:00", "13:30", "14:00", "14:30", "20:30", "21:00", "21:30"]);
    expect(shiftStarts("2026-10-15", shifts, 30)).toEqual([]);
  });

  it("explica por qué no se puede reservar un día", () => {
    const closures = [{ date: "2026-10-20", reason: "Evento privado" }];
    expect(dateUnavailableReason({ date: "2026-10-20", today: "2026-10-17", rules, closures })).toBe("Cerrado: Evento privado.");
    expect(dateUnavailableReason({ date: "2026-10-16", today: "2026-10-17", rules, closures })).toMatch(/pasado/);
    expect(dateUnavailableReason({ date: "2026-12-01", today: "2026-10-17", rules, closures })).toMatch(/30 días/);
    expect(dateUnavailableReason({ date: "2026-10-18", today: "2026-10-17", rules, closures })).toBeNull();
  });
});

describe("elección de mesa", () => {
  it("elige la mesa libre más ajustada", () => {
    expect(pickTables(2, tables, new Set(), true)?.map((table) => table.id)).toEqual(["t1"]);
    expect(pickTables(3, tables, new Set(), true)?.map((table) => table.id)).toEqual(["t2"]);
    expect(pickTables(3, tables, new Set(["t2"]), true)?.map((table) => table.id)).toEqual(["t3"]);
  });

  it("junta dos mesas de la misma sala cuando ninguna basta", () => {
    expect(pickTables(8, tables, new Set(), true)?.map((table) => table.id)).toEqual(["t2", "t3"]);
    expect(pickTables(8, tables, new Set(), false)).toBeNull();
    // La 4 (terraza) no se junta con las del salón.
    expect(pickTables(9, tables, new Set(), true)).toBeNull();
  });
});

describe("horas disponibles", () => {
  const shifts = [{ weekday: 6, opensAt: "20:00", lastStart: "22:00" }];
  const base = { date: "2026-10-17", timeZone: "Europe/Madrid", rules, shifts, tables };

  it("respeta la antelación mínima", () => {
    // Son las 20:10 en Madrid: con 60 min de antelación la primera hora es las 21:30.
    const slots = daySlots({ ...base, partySize: 2, now: new Date("2026-10-17T18:10:00Z"), bookings: [] });
    expect(slots.map((slot) => slot.time)).toEqual(["21:30", "22:00"]);
    expect(daySlots({ ...base, partySize: 2, now: new Date("2026-10-17T18:10:00Z"), bookings: [], ignoreLead: true })[0].time).toBe("20:30");
  });

  it("bloquea las horas que se solapan con reservas que ocupan todas las mesas válidas", () => {
    const now = new Date("2026-10-17T08:00:00Z");
    const at = (time: string) => zonedToUtc("2026-10-17", time, "Europe/Madrid");
    const bookings = [{ startsAt: at("21:00"), endsAt: at("22:30"), tableIds: ["t4"] }];
    const slots = daySlots({ ...base, partySize: 6, now, bookings });
    const available = Object.fromEntries(slots.map((slot) => [slot.time, slot.available]));
    // Para 6: la 4 (terraza) o juntar 2+3 en el salón; con la 4 ocupada sigue habiendo sitio juntando.
    expect(available["21:00"]).toBe(true);
    // Para 7 solo vale juntar la 2 y la 3: con la 2 ocupada de 20:00 a 21:30 no hay sitio hasta las 21:30.
    const seven = daySlots({ ...base, partySize: 7, now, bookings: [...bookings, { startsAt: at("20:00"), endsAt: at("21:30"), tableIds: ["t2"] }] });
    const sevenMap = Object.fromEntries(seven.map((slot) => [slot.time, slot.available]));
    expect(sevenMap["20:00"]).toBe(false);
    expect(sevenMap["21:00"]).toBe(false);
    expect(sevenMap["21:30"]).toBe(true);
    expect(seven.find((slot) => slot.time === "21:30")?.tables?.map((table) => table.id)).toEqual(["t2", "t3"]);
    // Una reserva que se edita no se bloquea a sí misma.
    expect(daySlots({ ...base, partySize: 6, now, bookings: [{ id: "b1", startsAt: at("20:00"), endsAt: at("23:59"), tableIds: ["t4", "t2"] }], ignoreBookingId: "b1" })[0].available).toBe(true);
  });
});

describe("utilidades", () => {
  it("genera localizadores legibles", () => {
    let seed = 0;
    const code = bookingCode((max) => (seed++ * 7) % max);
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
  });

  it("solo deja cancelar online dentro del plazo", () => {
    const startsAt = new Date("2026-10-17T20:00:00Z");
    expect(canCustomerCancel({ status: "CONFIRMED", startsAt }, 2, new Date("2026-10-17T17:59:00Z"))).toBe(true);
    expect(canCustomerCancel({ status: "CONFIRMED", startsAt }, 2, new Date("2026-10-17T18:30:00Z"))).toBe(false);
    expect(canCustomerCancel({ status: "SEATED", startsAt }, 2, new Date("2026-10-16T00:00:00Z"))).toBe(false);
  });

  it("crea slugs y calendarios", () => {
    expect(slugify("Bar La Plaza & Cía.")).toBe("bar-la-plaza-cia");
    const ics = bookingIcs({ code: "ABC234", startsAt: new Date("2026-10-17T19:00:00Z"), endsAt: new Date("2026-10-17T20:30:00Z"), title: "Reserva, La Plaza", description: "2 personas", now: new Date("2026-10-01T00:00:00Z") });
    expect(ics).toContain("DTSTART:20261017T190000Z");
    expect(ics).toContain("SUMMARY:Reserva\\, La Plaza");
    expect(ics.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
  });
});

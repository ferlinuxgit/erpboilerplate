import { describe, expect, it } from "vitest";

import { allowedActions, formatMinutes, groupByWorkday, stateAfter, summarizeDay, timesheetCsv } from "./model";

const at = (time: string) => new Date(`2026-10-16T${time}:00Z`);

describe("registro de jornada", () => {
  it("solo deja el fichaje que toca", () => {
    expect(allowedActions(stateAfter(null))).toEqual(["IN"]);
    expect(allowedActions(stateAfter("IN"))).toEqual(["BREAK_START", "OUT"]);
    expect(allowedActions(stateAfter("BREAK_START"))).toEqual(["BREAK_END"]);
    expect(allowedActions(stateAfter("BREAK_END"))).toEqual(["BREAK_START", "OUT"]);
    expect(allowedActions(stateAfter("OUT"))).toEqual(["IN"]);
  });

  it("suma horas y pausas de una jornada partida", () => {
    const day = summarizeDay("2026-10-16", [
      { kind: "IN", at: at("08:00") }, { kind: "BREAK_START", at: at("11:00") }, { kind: "BREAK_END", at: at("11:30") }, { kind: "OUT", at: at("14:00") },
      { kind: "IN", at: at("17:00") }, { kind: "OUT", at: at("20:15") },
    ], at("22:00"), false);
    expect(day.workedMinutes).toBe(5 * 60 + 30 + 3 * 60 + 15);
    expect(day.breakMinutes).toBe(30);
    expect(day.issues).toEqual([]);
    expect(day.open).toBe(false);
    expect(formatMinutes(day.workedMinutes)).toBe("8 h 45 min");
  });

  it("cuenta la jornada en curso hoy y marca olvidos en días pasados", () => {
    expect(summarizeDay("2026-10-16", [{ kind: "IN", at: at("09:00") }], at("10:30"), true)).toMatchObject({ workedMinutes: 90, open: true, issues: [] });
    expect(summarizeDay("2026-10-16", [{ kind: "IN", at: at("09:00") }], at("23:00"), false).issues).toEqual(["Falta la salida"]);
    expect(summarizeDay("2026-10-16", [{ kind: "OUT", at: at("09:00") }], at("23:00"), false).issues[0]).toMatch(/fuera de orden/);
  });

  it("una jornada que pasa de medianoche cuenta en el día de entrada", () => {
    const days = groupByWorkday([
      { kind: "IN" as const, at: new Date("2026-10-16T18:00:00Z") }, // 20:00 en Madrid
      { kind: "OUT" as const, at: new Date("2026-10-17T00:30:00Z") }, // 02:30 del día siguiente
      { kind: "IN" as const, at: new Date("2026-10-17T16:00:00Z") },
    ], "Europe/Madrid");
    expect([...days.keys()]).toEqual(["2026-10-16", "2026-10-17"]);
    expect(days.get("2026-10-16")!.map((entry) => entry.kind)).toEqual(["IN", "OUT"]);
    expect(summarizeDay("2026-10-16", days.get("2026-10-16")!, new Date(), false).workedMinutes).toBe(390);
  });

  it("exporta un CSV que abre Excel", () => {
    const csv = timesheetCsv([{ worker: "Ana; López", date: "2026-10-16", entries: "08:00 Entrada · 14:00 Salida", workedMinutes: 360, breakMinutes: 0, issues: "" }]);
    expect(csv.startsWith("﻿Trabajador;Fecha")).toBe(true);
    expect(csv).toContain('"Ana; López";2026-10-16;08:00 Entrada · 14:00 Salida;6,00;0;');
  });
});

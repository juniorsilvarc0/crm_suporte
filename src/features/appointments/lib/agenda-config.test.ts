import { describe, expect, it } from "vitest";

import {
  emptyAgendaHours,
  isOutsideAgendaHours,
  isValidTime,
  normalizeTimes,
  timesForDateKey,
  weekdayOfDateKey,
  type AgendaHours,
} from "@/features/appointments/lib/agenda-config";

function hoursWith(weekday: number, times: string[]): AgendaHours {
  const hours = emptyAgendaHours();
  hours[weekday] = times;
  return hours;
}

describe("grade de horários da agenda", () => {
  it("valida o formato HH:MM", () => {
    expect(isValidTime("08:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("8:00")).toBe(false);
    expect(isValidTime("08:60")).toBe(false);
    expect(isValidTime("")).toBe(false);
  });

  it("normaliza: descarta inválido, tira repetido e ordena", () => {
    expect(normalizeTimes(["12:00", "08:00", "12:00", "xx", "09:30"])).toEqual([
      "08:00",
      "09:30",
      "12:00",
    ]);
  });

  it("lê o dia da semana em data LOCAL, não em UTC", () => {
    // `new Date("2026-08-07")` seria UTC e, em -03:00, voltaria para quinta.
    expect(weekdayOfDateKey("2026-08-07")).toBe(5);
    expect(weekdayOfDateKey("2026-08-03")).toBe(1);
    expect(weekdayOfDateKey("nao-e-data")).toBeNull();
  });

  it("devolve a grade do dia certo", () => {
    const hours = hoursWith(5, ["08:00", "09:00"]);

    expect(timesForDateKey(hours, "2026-08-07")).toEqual(["08:00", "09:00"]);
    expect(timesForDateKey(hours, "2026-08-06")).toEqual([]);
  });
});

describe("aviso de horário fora do expediente", () => {
  it("avisa quando o horário não está na grade do dia — o caso da sexta", () => {
    // Sexta configurada só de manhã; 19:00 vindo de outro dia fica fora.
    const hours = hoursWith(5, ["08:00", "09:00", "10:00", "11:00", "12:00"]);

    expect(isOutsideAgendaHours(hours, "2026-08-07T19:00")).toBe(true);
    expect(isOutsideAgendaHours(hours, "2026-08-07T09:00")).toBe(false);
  });

  it("não avisa em dia sem grade configurada", () => {
    // Vazio significa "não configurado", não "fechado". Avisar em todo
    // agendamento vira ruído e ninguém lê mais.
    expect(isOutsideAgendaHours(emptyAgendaHours(), "2026-08-07T19:00")).toBe(false);
  });

  it("não avisa com horário incompleto no campo", () => {
    const hours = hoursWith(5, ["08:00"]);

    expect(isOutsideAgendaHours(hours, "2026-08-07")).toBe(false);
    expect(isOutsideAgendaHours(hours, "2026-08-07T9:0")).toBe(false);
  });
});

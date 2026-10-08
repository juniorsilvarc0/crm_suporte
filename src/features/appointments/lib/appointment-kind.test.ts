import { describe, expect, it } from "vitest";

import {
  APPOINTMENT_KINDS,
  appointmentKindColor,
  appointmentKindLabel,
  appointmentKindOptions,
  isAppointmentKind,
} from "@/features/appointments/lib/appointment-kind";

describe("appointment-kind", () => {
  it("tem os quatro tipos do suporte", () => {
    expect([...APPOINTMENT_KINDS]).toEqual([
      "visita_tecnica",
      "treinamento",
      "implantacao",
      "acesso_remoto",
    ]);
  });

  it("isAppointmentKind aceita só os válidos", () => {
    expect(isAppointmentKind("visita_tecnica")).toBe(true);
    expect(isAppointmentKind("consulta")).toBe(false);
    expect(isAppointmentKind(null)).toBe(false);
    expect(isAppointmentKind(123)).toBe(false);
  });

  it("todo tipo tem rótulo PT-BR e uma cor nomeada", () => {
    for (const kind of APPOINTMENT_KINDS) {
      expect(appointmentKindLabel[kind]).toBeTruthy();
      expect(appointmentKindColor[kind]).toBeTruthy();
    }
  });

  it("as opções do select cobrem os tipos, com value e label", () => {
    expect(appointmentKindOptions.map((option) => option.value)).toEqual([...APPOINTMENT_KINDS]);
    expect(appointmentKindOptions.every((option) => option.label.length > 0)).toBe(true);
  });
});

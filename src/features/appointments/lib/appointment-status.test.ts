import { describe, expect, it } from "vitest";

import {
  APPOINTMENT_STATUSES,
  appointmentStatusColor,
  appointmentStatusLabel,
  appointmentStatusOptions,
  isAppointmentStatus,
} from "@/features/appointments/lib/appointment-status";

describe("appointment-status", () => {
  it("tem o fluxo agendado → confirmado → realizado, ou cancelado (sem compareceu/faltou)", () => {
    expect([...APPOINTMENT_STATUSES]).toEqual(["agendado", "confirmado", "realizado", "cancelado"]);
    expect(isAppointmentStatus("compareceu")).toBe(false);
    expect(isAppointmentStatus("faltou")).toBe(false);
  });

  it("isAppointmentStatus aceita só os válidos", () => {
    expect(isAppointmentStatus("realizado")).toBe(true);
    expect(isAppointmentStatus("")).toBe(false);
    expect(isAppointmentStatus(undefined)).toBe(false);
  });

  it("todo estado tem rótulo e cor; as opções cobrem os estados", () => {
    for (const status of APPOINTMENT_STATUSES) {
      expect(appointmentStatusLabel[status]).toBeTruthy();
      expect(appointmentStatusColor[status]).toBeTruthy();
    }
    expect(appointmentStatusOptions.map((option) => option.value)).toEqual([...APPOINTMENT_STATUSES]);
  });
});

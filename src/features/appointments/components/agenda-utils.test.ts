import { describe, expect, it } from "vitest";

import {
  canMarkAppointmentAttended,
  resolveInitialAppointmentDayKey,
} from "@/features/appointments/components/agenda-utils";

describe("canMarkAppointmentAttended", () => {
  it.each(["agendado", "confirmado"] as const)(
    "permite registrar visita para o status %s",
    (status) => {
      expect(canMarkAppointmentAttended(status)).toBe(true);
    }
  );

  it.each(["compareceu", "cancelado", "faltou"] as const)(
    "não permite registrar visita para o status %s",
    (status) => {
      expect(canMarkAppointmentAttended(status)).toBe(false);
    }
  );
});

describe("resolveInitialAppointmentDayKey", () => {
  it("abre hoje quando hoje possui agendamento", () => {
    expect(
      resolveInitialAppointmentDayKey(
        [{ key: "2026-08-06" }, { key: "2026-08-08" }, { key: "2026-08-12" }],
        "2026-08-08"
      )
    ).toBe("2026-08-08");
  });

  it("abre o próximo dia com agendamento quando hoje está vazio", () => {
    expect(
      resolveInitialAppointmentDayKey(
        [{ key: "2026-08-06" }, { key: "2026-08-12" }, { key: "2026-08-19" }],
        "2026-08-08"
      )
    ).toBe("2026-08-12");
  });

  it("abre o dia passado mais recente quando não há próximo agendamento", () => {
    expect(
      resolveInitialAppointmentDayKey(
        [{ key: "2026-08-02" }, { key: "2026-08-06" }],
        "2026-08-08"
      )
    ).toBe("2026-08-06");
  });

  it("devolve vazio quando o mês não possui agendamentos", () => {
    expect(resolveInitialAppointmentDayKey([], "2026-08-08")).toBe("");
  });
});

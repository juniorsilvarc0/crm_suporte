import { describe, expect, it } from "vitest";

import {
  findAppointmentConflicts,
  intervalsOverlap,
  type ConflictCandidate,
} from "@/features/appointments/lib/appointment-conflicts";

function candidate(
  id: string,
  iso: string,
  durationMin: number | null = 60,
  status = "agendado"
): ConflictCandidate {
  return { id, scheduledAt: iso, durationMin, leadName: id, status };
}

const AT_19 = "2026-08-03T22:00:00.000Z"; // 19:00 em America/Sao_Paulo

describe("conflito de agendamento", () => {
  it("acusa dois pacientes no mesmo horário — o caso relatado", () => {
    const conflitos = findAppointmentConflicts({
      candidates: [candidate("Aguir", AT_19)],
      startIso: AT_19,
      durationMin: 60,
    });

    expect(conflitos).toHaveLength(1);
    expect(conflitos[0].id).toBe("Aguir");
  });

  it("não acusa encosto: quem termina 09:00 convive com quem começa 09:00", () => {
    const conflitos = findAppointmentConflicts({
      candidates: [candidate("antes", "2026-08-03T11:00:00.000Z", 60)],
      startIso: "2026-08-03T12:00:00.000Z",
      durationMin: 60,
    });

    expect(conflitos).toHaveLength(0);
  });

  it("acusa sobreposição parcial", () => {
    const conflitos = findAppointmentConflicts({
      candidates: [candidate("longo", "2026-08-03T11:00:00.000Z", 90)],
      startIso: "2026-08-03T12:00:00.000Z",
      durationMin: 30,
    });

    expect(conflitos).toHaveLength(1);
  });

  it("ignora cancelado e faltou — o horário voltou a ficar livre", () => {
    const conflitos = findAppointmentConflicts({
      candidates: [
        candidate("cancelado", AT_19, 60, "cancelado"),
        candidate("faltou", AT_19, 60, "faltou"),
      ],
      startIso: AT_19,
      durationMin: 60,
    });

    expect(conflitos).toHaveLength(0);
  });

  it("conta compareceu e confirmado como ocupados", () => {
    const conflitos = findAppointmentConflicts({
      candidates: [
        candidate("compareceu", AT_19, 60, "compareceu"),
        candidate("confirmado", AT_19, 60, "confirmado"),
      ],
      startIso: AT_19,
      durationMin: 60,
    });

    expect(conflitos).toHaveLength(2);
  });

  it("não deixa o agendamento em edição conflitar consigo mesmo", () => {
    const conflitos = findAppointmentConflicts({
      candidates: [candidate("eu-mesmo", AT_19)],
      startIso: AT_19,
      durationMin: 60,
      ignoreId: "eu-mesmo",
    });

    expect(conflitos).toHaveLength(0);
  });

  it("trata duração ausente como uma hora", () => {
    const conflitos = findAppointmentConflicts({
      candidates: [candidate("sem-duracao", AT_19, null)],
      startIso: "2026-08-03T22:30:00.000Z",
      durationMin: 30,
    });

    expect(conflitos).toHaveLength(1);
  });

  it("devolve vazio para data inválida em vez de quebrar", () => {
    expect(
      findAppointmentConflicts({
        candidates: [candidate("x", AT_19)],
        startIso: "nao-e-data",
        durationMin: 60,
      })
    ).toEqual([]);
  });

  it("intervalos: sobreposição é estrita nas duas pontas", () => {
    expect(intervalsOverlap(0, 10, 10, 20)).toBe(false);
    expect(intervalsOverlap(10, 20, 0, 10)).toBe(false);
    expect(intervalsOverlap(0, 10, 9, 20)).toBe(true);
  });
});

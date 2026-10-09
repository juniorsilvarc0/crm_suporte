import { describe, expect, it } from "vitest";

import {
  findAppointmentConflicts,
  intervalsOverlap,
  type ConflictCandidate,
} from "@/features/appointments/lib/appointment-conflicts";

const ANA = "u-ana";
const BRUNO = "u-bruno";

// 13:00 UTC = 10:00 em São Paulo.
const candidate = (overrides: Partial<ConflictCandidate> = {}): ConflictCandidate => ({
  id: "a1",
  scheduled_at: "2026-10-12T13:00:00.000Z",
  duration_min: 60,
  status: "agendado",
  assignee_id: ANA,
  ...overrides,
});

const at = (utcTime: string) => `2026-10-12T${utcTime}:00.000Z`;

describe("findAppointmentConflicts", () => {
  it("acusa dois compromissos do mesmo técnico no mesmo horário", () => {
    const found = findAppointmentConflicts({
      candidates: [candidate()],
      assigneeId: ANA,
      startIso: at("13:30"),
      durationMin: 60,
    });

    expect(found.map((item) => item.id)).toEqual(["a1"]);
  });

  it("compromisso de OUTRO técnico não ocupa a agenda deste", () => {
    expect(
      findAppointmentConflicts({ candidates: [candidate()], assigneeId: BRUNO, startIso: at("13:00"), durationMin: 60 })
    ).toEqual([]);
  });

  it("sem técnico escolhido não há conflito a apontar", () => {
    expect(
      findAppointmentConflicts({ candidates: [candidate()], assigneeId: null, startIso: at("13:00"), durationMin: 60 })
    ).toEqual([]);
  });

  it("não acusa encosto: quem termina 11:00 convive com quem começa 11:00", () => {
    expect(
      findAppointmentConflicts({ candidates: [candidate()], assigneeId: ANA, startIso: at("14:00"), durationMin: 60 })
    ).toEqual([]);
  });

  it("cancelado libera o horário; confirmado e realizado ocupam", () => {
    const candidates = [
      candidate({ id: "cancelado", status: "cancelado" }),
      candidate({ id: "confirmado", status: "confirmado" }),
      candidate({ id: "realizado", status: "realizado" }),
    ];

    expect(
      findAppointmentConflicts({ candidates, assigneeId: ANA, startIso: at("13:00"), durationMin: 30 }).map(
        (item) => item.id
      )
    ).toEqual(["confirmado", "realizado"]);
  });

  it("editar não conflita consigo mesmo", () => {
    expect(
      findAppointmentConflicts({
        candidates: [candidate()],
        assigneeId: ANA,
        startIso: at("13:00"),
        durationMin: 60,
        ignoreId: "a1",
      })
    ).toEqual([]);
  });

  it("duração ausente conta uma hora", () => {
    expect(
      findAppointmentConflicts({
        candidates: [candidate({ duration_min: null })],
        assigneeId: ANA,
        startIso: at("13:59"),
        durationMin: 30,
      })
    ).toHaveLength(1);
  });

  it("data inválida devolve vazio em vez de quebrar", () => {
    expect(
      findAppointmentConflicts({ candidates: [candidate()], assigneeId: ANA, startIso: "", durationMin: 60 })
    ).toEqual([]);
  });

  it("intervalos: a sobreposição é estrita nas duas pontas", () => {
    expect(intervalsOverlap(0, 10, 10, 20)).toBe(false);
    expect(intervalsOverlap(0, 11, 10, 20)).toBe(true);
    expect(intervalsOverlap(10, 20, 0, 10)).toBe(false);
  });
});

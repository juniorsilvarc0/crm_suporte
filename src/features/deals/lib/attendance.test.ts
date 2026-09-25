import { describe, expect, it } from "vitest";

import {
  pickAttendedDeals,
  selectAttendedDeals,
} from "@/features/deals/lib/attendance";

const CLOSED = ["cliente", "recorrente", "perdido"];

function deal(
  id: string,
  stage: string,
  appointment_id: string | null = null
) {
  return { id, stage, appointment_id };
}

describe("pickAttendedDeals", () => {
  it("move o card aberto do lead para compareceu", () => {
    const picked = pickAttendedDeals({
      deals: [deal("d1", "agendado")],
      closedStages: CLOSED,
    });

    expect(picked).toEqual(["d1"]);
  });

  it("move mesmo quando o card está em uma etapa custom aberta", () => {
    const picked = pickAttendedDeals({
      deals: [deal("d1", "em-atendimento-bruna")],
      closedStages: CLOSED,
    });

    expect(picked).toEqual(["d1"]);
  });

  it("não mexe em card já na etapa compareceu", () => {
    const picked = pickAttendedDeals({
      deals: [deal("d1", "compareceu")],
      closedStages: CLOSED,
    });

    expect(picked).toEqual([]);
  });

  it("NUNCA rebaixa card ganho ou perdido", () => {
    const picked = pickAttendedDeals({
      deals: [deal("d1", "cliente"), deal("d2", "recorrente"), deal("d3", "perdido")],
      closedStages: CLOSED,
    });

    expect(picked).toEqual([]);
  });

  it("move só os abertos quando o lead tem card aberto e card ganho", () => {
    const picked = pickAttendedDeals({
      deals: [deal("aberto", "em_atendimento"), deal("ganho", "cliente")],
      closedStages: CLOSED,
    });

    expect(picked).toEqual(["aberto"]);
  });

  it("com vínculo de agendamento, move só o card daquele agendamento", () => {
    const picked = pickAttendedDeals({
      deals: [
        deal("outro", "em_atendimento"),
        deal("doAgendamento", "agendado", "appt-1"),
      ],
      appointmentId: "appt-1",
      closedStages: CLOSED,
    });

    expect(picked).toEqual(["doAgendamento"]);
  });

  it("card do agendamento já fechado: não move nada, nem os outros", () => {
    const picked = pickAttendedDeals({
      deals: [
        deal("outro", "em_atendimento"),
        deal("doAgendamento", "cliente", "appt-1"),
      ],
      appointmentId: "appt-1",
      closedStages: CLOSED,
    });

    expect(picked).toEqual([]);
  });

  it("appointmentId sem vínculo não escolhe entre duas oportunidades abertas", () => {
    const picked = pickAttendedDeals({
      deals: [deal("d1", "em_atendimento"), deal("d2", "agendado")],
      appointmentId: "appt-sem-card",
      closedStages: CLOSED,
    });

    expect(picked).toEqual([]);
  });

  it("lead com dois cards abertos sinaliza ambiguidade sem mover nenhum", () => {
    const selection = selectAttendedDeals({
      deals: [deal("d1", "em_atendimento"), deal("d2", "novo")],
      closedStages: CLOSED,
    });

    expect(selection).toEqual({ ids: [], ambiguous: true });
  });

  it("lead sem card nenhum não quebra", () => {
    expect(pickAttendedDeals({ deals: [], closedStages: CLOSED })).toEqual([]);
  });

  it("respeita uma etapa de destino diferente (board renomeado)", () => {
    const picked = pickAttendedDeals({
      deals: [deal("d1", "veio"), deal("d2", "agendado")],
      closedStages: CLOSED,
      attendedStage: "veio",
    });

    expect(picked).toEqual(["d2"]);
  });
});

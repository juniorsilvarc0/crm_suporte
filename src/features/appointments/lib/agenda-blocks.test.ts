import { describe, expect, it } from "vitest";

import {
  blockDateKeys,
  blockLabel,
  blockMinutesInDay,
  blocksForDateKey,
  describeAgendaBlockForDate,
  describeAgendaBlockPeriod,
  findBlocksForRange,
  localToIso,
  relevantBlocks,
  type AgendaBlock,
} from "@/features/appointments/lib/agenda-blocks";

/** Bloqueio em horário LOCAL, do jeito que a tela cadastra. */
function block(
  id: string,
  from: [string, string],
  to: [string, string],
  extra: Partial<AgendaBlock> = {}
): AgendaBlock {
  return {
    id,
    startsAt: localToIso(from[0], from[1]),
    endsAt: localToIso(to[0], to[1]),
    allDay: false,
    reason: null,
    assignee: null,
    ...extra,
  };
}

const ANA = { id: "u-ana", name: "Ana Lima" };

describe("bloqueios da agenda", () => {
  it("monta o instante no fuso do app, não em UTC", () => {
    expect(localToIso("2026-08-07", "09:00")).toBe("2026-08-07T12:00:00.000Z");
  });

  it("acusa visita que cai dentro do bloqueio", () => {
    const blocks = [block("treinamento", ["2026-08-07", "08:00"], ["2026-08-07", "12:00"])];

    const achados = findBlocksForRange({ blocks, startIso: localToIso("2026-08-07", "09:00"), durationMin: 60 });

    expect(achados.map((item) => item.id)).toEqual(["treinamento"]);
  });

  it("não acusa encosto: bloqueio até 14:00 libera a visita das 14:00", () => {
    const blocks = [block("almoco", ["2026-08-07", "12:00"], ["2026-08-07", "14:00"])];

    expect(findBlocksForRange({ blocks, startIso: localToIso("2026-08-07", "14:00"), durationMin: 60 })).toHaveLength(0);
  });

  it("acusa sobreposição parcial", () => {
    const blocks = [block("reuniao", ["2026-08-07", "14:00"], ["2026-08-07", "16:00"])];

    expect(findBlocksForRange({ blocks, startIso: localToIso("2026-08-07", "13:30"), durationMin: 60 })).toHaveLength(1);
  });

  it("vale o bloqueio de todos e o do técnico escolhido; o de outro técnico, não", () => {
    const feriado = block("feriado", ["2026-08-07", "00:00"], ["2026-08-08", "00:00"], { allDay: true });
    const ferias = block("ferias", ["2026-08-07", "00:00"], ["2026-08-08", "00:00"], { assignee: ANA });

    expect(relevantBlocks([feriado, ferias], "u-ana").map((item) => item.id)).toEqual(["feriado", "ferias"]);
    expect(relevantBlocks([feriado, ferias], "u-bruno").map((item) => item.id)).toEqual(["feriado"]);
    expect(relevantBlocks([feriado, ferias], null).map((item) => item.id)).toEqual(["feriado"]);
  });

  it("encontra os bloqueios que tocam o dia, inclusive os de vários dias", () => {
    const blocks = [
      block("ferias", ["2026-08-05", "00:00"], ["2026-08-10", "00:00"], { allDay: true }),
      block("outro-dia", ["2026-08-12", "09:00"], ["2026-08-12", "10:00"]),
    ];

    expect(blocksForDateKey(blocks, "2026-08-07").map((item) => item.id)).toEqual(["ferias"]);
  });

  it("recorta o bloqueio longo dentro do dia, em minutos", () => {
    const longo = block("longo", ["2026-08-06", "18:00"], ["2026-08-08", "10:00"]);

    expect(blockMinutesInDay(longo, "2026-08-06")).toEqual({ startMinutes: 18 * 60, endMinutes: 24 * 60 });
    expect(blockMinutesInDay(longo, "2026-08-07")).toEqual({ startMinutes: 0, endMinutes: 24 * 60 });
    expect(blockMinutesInDay(longo, "2026-08-08")).toEqual({ startMinutes: 0, endMinutes: 10 * 60 });
    expect(blockMinutesInDay(longo, "2026-08-09")).toBeNull();
  });

  it("lista os dias tocados, com o fim exclusivo", () => {
    const ferias = block("ferias", ["2026-08-05", "00:00"], ["2026-08-08", "00:00"], { allDay: true });

    expect(blockDateKeys(ferias)).toEqual(["2026-08-05", "2026-08-06", "2026-08-07"]);
  });

  it("usa um rótulo neutro sem motivo, e põe o técnico na frente quando o bloqueio é dele", () => {
    expect(blockLabel({ reason: "  ", assignee: null })).toBe("Indisponível");
    expect(blockLabel({ reason: "Férias", assignee: ANA })).toBe("Ana Lima: Férias");
  });

  it("descreve o parcial com o intervalo recortado no dia, e o dia inteiro como tal", () => {
    const almoco = block("almoco", ["2026-08-07", "12:00"], ["2026-08-07", "13:30"], { reason: "Almoço" });
    const feriado = block("feriado", ["2026-08-07", "00:00"], ["2026-08-08", "00:00"], {
      allDay: true,
      reason: "Feriado",
    });

    expect(describeAgendaBlockForDate(almoco, "2026-08-07")).toEqual({
      kind: "partial",
      reason: "Almoço",
      period: "12:00–13:30",
      label: "Almoço · 12:00–13:30",
    });
    expect(describeAgendaBlockForDate(feriado, "2026-08-07")?.label).toBe("Feriado · Dia inteiro");
    expect(describeAgendaBlockForDate(feriado, "2026-08-08")).toBeNull();
  });

  it("escreve o período inteiro para a lista do cadastro", () => {
    expect(
      describeAgendaBlockPeriod(block("f", ["2026-08-05", "00:00"], ["2026-08-08", "00:00"], { allDay: true }))
    ).toBe("05/08 a 07/08 · Dia inteiro");
    expect(
      describeAgendaBlockPeriod(block("f", ["2026-08-07", "00:00"], ["2026-08-08", "00:00"], { allDay: true }))
    ).toBe("07/08 · Dia inteiro");
    expect(describeAgendaBlockPeriod(block("a", ["2026-08-07", "12:00"], ["2026-08-07", "13:30"]))).toBe(
      "07/08 12:00–13:30"
    );
    expect(describeAgendaBlockPeriod(block("n", ["2026-08-07", "22:00"], ["2026-08-08", "00:00"]))).toBe(
      "07/08 22:00–24:00"
    );
    expect(describeAgendaBlockPeriod(block("l", ["2026-08-06", "18:00"], ["2026-08-08", "10:00"]))).toBe(
      "06/08 18:00 a 08/08 10:00"
    );
  });

  it("devolve vazio para data inválida em vez de quebrar", () => {
    expect(localToIso("07/08/2026", "09:00")).toBe("");
    expect(blocksForDateKey([block("x", ["2026-08-07", "09:00"], ["2026-08-07", "10:00"])], "lixo")).toEqual([]);
  });
});

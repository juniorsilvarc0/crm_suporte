import { describe, expect, it } from "vitest";

import {
  blockDateKeys,
  blockLabel,
  blockMinutesInDay,
  blocksForDateKey,
  describeAgendaBlockForDate,
  findBlocksForRange,
  isTimeBlocked,
  localToIso,
  normalizeAgendaBlock,
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
    ...extra,
  };
}

describe("bloqueios da agenda", () => {
  it("monta o instante no fuso do app, não em UTC", () => {
    const iso = localToIso("2026-08-07", "09:00");

    expect(iso).toBe("2026-08-07T12:00:00.000Z");
  });

  it("acusa consulta que cai dentro do bloqueio", () => {
    const blocks = [block("congresso", ["2026-08-07", "08:00"], ["2026-08-07", "12:00"])];

    const achados = findBlocksForRange({
      blocks,
      startIso: localToIso("2026-08-07", "09:00"),
      durationMin: 60,
    });

    expect(achados).toHaveLength(1);
    expect(achados[0].id).toBe("congresso");
  });

  it("não acusa encosto: bloqueio até 14:00 libera a consulta das 14:00", () => {
    const blocks = [block("almoco", ["2026-08-07", "12:00"], ["2026-08-07", "14:00"])];

    expect(
      findBlocksForRange({
        blocks,
        startIso: localToIso("2026-08-07", "14:00"),
        durationMin: 60,
      })
    ).toHaveLength(0);
  });

  it("acusa sobreposição parcial", () => {
    const blocks = [block("cirurgia", ["2026-08-07", "14:00"], ["2026-08-07", "16:00"])];

    expect(
      findBlocksForRange({
        blocks,
        startIso: localToIso("2026-08-07", "13:30"),
        durationMin: 60,
      })
    ).toHaveLength(1);
  });

  it("marca o horário rápido que caiu dentro do bloqueio", () => {
    const blocks = [block("ferias", ["2026-08-07", "08:00"], ["2026-08-07", "12:00"])];

    expect(isTimeBlocked({ blocks, dateKey: "2026-08-07", time: "09:00" })?.id).toBe("ferias");
    expect(isTimeBlocked({ blocks, dateKey: "2026-08-07", time: "12:00" })).toBeNull();
    expect(isTimeBlocked({ blocks, dateKey: "2026-08-08", time: "09:00" })).toBeNull();
  });

  it("encontra os bloqueios que tocam o dia, inclusive os de vários dias", () => {
    const blocks = [block("ferias", ["2026-08-05", "00:00"], ["2026-08-09", "00:00"])];

    expect(blocksForDateKey(blocks, "2026-08-07")).toHaveLength(1);
    expect(blocksForDateKey(blocks, "2026-08-04")).toHaveLength(0);
    expect(blocksForDateKey(blocks, "2026-08-09")).toHaveLength(0);
  });

  it("recorta o bloqueio longo dentro do dia, em minutos", () => {
    // Três dias de férias viram faixa CHEIA no dia do meio, não uma barra
    // gigante saindo pela primeira coluna da grade.
    const ferias = block("ferias", ["2026-08-05", "14:00"], ["2026-08-09", "10:00"]);

    expect(blockMinutesInDay(ferias, "2026-08-05")).toEqual({
      startMinutes: 14 * 60,
      endMinutes: 24 * 60,
    });
    expect(blockMinutesInDay(ferias, "2026-08-07")).toEqual({
      startMinutes: 0,
      endMinutes: 24 * 60,
    });
    expect(blockMinutesInDay(ferias, "2026-08-09")).toEqual({
      startMinutes: 0,
      endMinutes: 10 * 60,
    });
    expect(blockMinutesInDay(ferias, "2026-08-10")).toBeNull();
  });

  it("lista os dias tocados, para marcar no calendário do mês", () => {
    const ferias = block("ferias", ["2026-08-05", "00:00"], ["2026-08-08", "00:00"]);

    expect(blockDateKeys(ferias)).toEqual(["2026-08-05", "2026-08-06", "2026-08-07"]);
  });

  it("normaliza bloqueio de dia inteiro gravado em UTC pela rota antiga", () => {
    const legacy: AgendaBlock = {
      id: "legacy",
      startsAt: "2026-08-21T00:00:00.000Z",
      endsAt: "2026-08-22T00:00:00.000Z",
      allDay: true,
      reason: "Cirurgia",
    };

    const normalized = normalizeAgendaBlock(legacy);

    expect(normalized.startsAt).toBe("2026-08-21T03:00:00.000Z");
    expect(normalized.endsAt).toBe("2026-08-22T03:00:00.000Z");
    expect(blockDateKeys(normalized)).toEqual(["2026-08-21"]);
  });

  it("não altera bloqueio já salvo no fuso correto", () => {
    const current = block(
      "current",
      ["2026-08-21", "00:00"],
      ["2026-08-22", "00:00"],
      { allDay: true }
    );

    expect(normalizeAgendaBlock(current)).toBe(current);
  });

  it("usa um rótulo neutro quando não há motivo", () => {
    expect(blockLabel(block("x", ["2026-08-07", "08:00"], ["2026-08-07", "09:00"]))).toBe(
      "Indisponível"
    );
    expect(
      blockLabel(
        block("x", ["2026-08-07", "08:00"], ["2026-08-07", "09:00"], { reason: "  Férias " })
      )
    ).toBe("Férias");
  });

  it("descreve bloqueio parcial com o intervalo recortado no dia", () => {
    const jantar = block(
      "jantar",
      ["2026-08-07", "17:00"],
      ["2026-08-07", "20:00"],
      { reason: "Jantar laboratório" }
    );

    expect(describeAgendaBlockForDate(jantar, "2026-08-07")).toEqual({
      kind: "partial",
      reason: "Jantar laboratório",
      period: "17:00–20:00",
      label: "Jantar laboratório · 17:00–20:00",
    });
  });

  it("mantém a identidade de dia inteiro explícita", () => {
    const cirurgia = block(
      "cirurgia",
      ["2026-08-07", "00:00"],
      ["2026-08-08", "00:00"],
      { allDay: true, reason: "Cirurgia" }
    );

    expect(describeAgendaBlockForDate(cirurgia, "2026-08-07")).toEqual({
      kind: "all-day",
      reason: "Cirurgia",
      period: "Dia inteiro",
      label: "Cirurgia · Dia inteiro",
    });
  });

  it("recorta a descrição horária de um bloqueio parcial com vários dias", () => {
    const congresso = block(
      "congresso",
      ["2026-08-07", "17:00"],
      ["2026-08-09", "10:00"],
      { reason: "Congresso" }
    );

    expect(describeAgendaBlockForDate(congresso, "2026-08-08")?.period).toBe(
      "00:00–24:00"
    );
    expect(describeAgendaBlockForDate(congresso, "2026-08-10")).toBeNull();
  });

  it("devolve vazio para data inválida em vez de quebrar", () => {
    expect(
      findBlocksForRange({ blocks: [], startIso: "nao-e-data", durationMin: 60 })
    ).toEqual([]);
    expect(localToIso("nao-e-data", "09:00")).toBe("");
  });
});

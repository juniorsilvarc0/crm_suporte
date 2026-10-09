import { describe, expect, it } from "vitest";

import {
  GRID_HEIGHT,
  MIN_BLOCK_HEIGHT,
  layoutTimeGrid,
  type TimeGridInput,
} from "@/features/appointments/lib/time-grid-layout";

/** "08:30" → minutos desde a meia-noite. */
function at(time: string, durationMin = 60, id = time): TimeGridInput {
  const [hour, minute] = time.split(":").map(Number);
  return { id, startMinutes: hour * 60 + minute, durationMin };
}

function byId(placements: ReturnType<typeof layoutTimeGrid>) {
  return new Map(placements.map((p) => [p.id, p]));
}

describe("layout da grade de horários", () => {
  it("dá a coluna inteira para um agendamento sozinho", () => {
    const [block] = layoutTimeGrid([at("10:00")]);

    expect(block.leftPct).toBe(0);
    expect(block.widthPct).toBe(100);
    expect(block.lanes).toBe(1);
  });

  it("posiciona pelo relógio, a 1px por minuto", () => {
    const [block] = layoutTimeGrid([at("08:30", 30)]);

    // 08:30 são 90 minutos depois das 07:00, início da grade.
    expect(block.top).toBe(90);
    expect(block.height).toBe(30);
  });

  it("põe lado a lado o que se cruza — o bug do print", () => {
    // 08:00–09:00, 08:30–09:00 e 09:00–10:00: os dois primeiros se cruzam.
    const blocks = byId(layoutTimeGrid([at("08:00", 60), at("08:30", 30), at("09:00", 60)]));

    expect(blocks.get("08:00")!.widthPct).toBe(50);
    expect(blocks.get("08:00")!.leftPct).toBe(0);
    expect(blocks.get("08:30")!.widthPct).toBe(50);
    expect(blocks.get("08:30")!.leftPct).toBe(50);

    // 09:00 começa quando os dois acabam: aglomerado novo, largura inteira.
    expect(blocks.get("09:00")!.widthPct).toBe(100);
    expect(blocks.get("09:00")!.leftPct).toBe(0);
  });

  it("mantém a mesma largura na corrente inteira", () => {
    // A 10:00–11:00 cruza B 10:30–11:30, que cruza C 11:00–12:00 — mas A e C
    // não se cruzam. Os três formam UM aglomerado e saem com a mesma largura;
    // se a conta fosse par a par, B encolheria no meio da corrente.
    const blocks = byId(
      layoutTimeGrid([at("10:00", 60, "A"), at("10:30", 60, "B"), at("11:00", 60, "C")])
    );

    expect(blocks.get("A")!.widthPct).toBe(50);
    expect(blocks.get("B")!.widthPct).toBe(50);
    expect(blocks.get("C")!.widthPct).toBe(50);

    // Duas faixas dão conta dos três: C entra na faixa que A acabou de deixar.
    expect(blocks.get("A")!.leftPct).toBe(0);
    expect(blocks.get("B")!.leftPct).toBe(50);
    expect(blocks.get("C")!.leftPct).toBe(0);
  });

  it("abre faixa nova só quando nenhuma vagou", () => {
    // B ocupa 10:00–12:00 inteiro, então C às 11:00 não cabe na faixa dele e
    // herda a de A, que terminou às 11:00. Três agendamentos, duas faixas.
    const blocks = byId(
      layoutTimeGrid([at("10:00", 60, "A"), at("10:00", 120, "B"), at("11:00", 60, "C")])
    );

    // Empate no início: o mais longo abre a faixa da esquerda.
    expect(blocks.get("B")!.leftPct).toBe(0);
    expect(blocks.get("A")!.leftPct).toBe(50);
    expect(blocks.get("C")!.leftPct).toBe(50);
    expect(blocks.get("C")!.lanes).toBe(2);
  });

  it("garante altura mínima para meia hora não virar um fio", () => {
    const [block] = layoutTimeGrid([{ id: "x", startMinutes: 10 * 60, durationMin: 5 }]);

    expect(block.height).toBe(MIN_BLOCK_HEIGHT);
  });

  it("trata duração ausente como uma hora", () => {
    const [block] = layoutTimeGrid([{ id: "x", startMinutes: 10 * 60, durationMin: 0 }]);

    expect(block.height).toBe(60);
  });

  it("encosta na borda em vez de sumir com horário fora da grade", () => {
    const antes = layoutTimeGrid([at("05:00", 60)])[0];
    const depois = layoutTimeGrid([at("23:00", 60)])[0];

    expect(antes.top).toBe(0);
    expect(depois.top).toBeLessThanOrEqual(GRID_HEIGHT - MIN_BLOCK_HEIGHT);
    expect(depois.height).toBeGreaterThanOrEqual(MIN_BLOCK_HEIGHT);
  });

  it("não estoura o fim da grade", () => {
    const [block] = layoutTimeGrid([at("20:00", 600)]);

    expect(block.top + block.height).toBeLessThanOrEqual(GRID_HEIGHT);
  });

  it("devolve um lugar para cada agendamento", () => {
    const input = [at("08:00"), at("08:00", 60, "b"), at("08:00", 60, "c"), at("15:00")];

    expect(layoutTimeGrid(input)).toHaveLength(4);
  });
});

import { describe, expect, it } from "vitest";

import {
  formatDuration,
  humanizeSince,
  humanizeUntil,
} from "@/lib/formatters/relative-time";

// Relógio fixo: nenhum teste depende da hora em que roda.
const NOW = new Date("2026-09-25T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

describe("formatDuration", () => {
  it("abaixo de 1 minuto diz 'menos de 1 min', nunca '0 min'", () => {
    expect(formatDuration(0)).toBe("menos de 1 min");
    expect(formatDuration(59_999)).toBe("menos de 1 min");
  });

  it("minutos em 'min', sem plural", () => {
    expect(formatDuration(MINUTE)).toBe("1 min");
    expect(formatDuration(25 * MINUTE)).toBe("25 min");
  });

  it("horas e dias no singular e no plural", () => {
    expect(formatDuration(HOUR)).toBe("1 hora");
    expect(formatDuration(3 * HOUR)).toBe("3 horas");
    expect(formatDuration(DAY)).toBe("1 dia");
    expect(formatDuration(3 * DAY)).toBe("3 dias");
  });

  it("arredonda para baixo: nunca promete mais tempo do que existe", () => {
    expect(formatDuration(25 * MINUTE + 59_999)).toBe("25 min");
    expect(formatDuration(2 * HOUR - 1)).toBe("1 hora");
    expect(formatDuration(2 * DAY - 1)).toBe("1 dia");
  });

  it("normaliza a unidade na fronteira: nada de '60 min' nem '24 horas'", () => {
    expect(formatDuration(HOUR - 1)).toBe("59 min");
    expect(formatDuration(HOUR)).toBe("1 hora");
    expect(formatDuration(DAY - 1)).toBe("23 horas");
    expect(formatDuration(DAY)).toBe("1 dia");
  });

  it("devolve vazio para negativo e para valor não finito", () => {
    expect(formatDuration(-1)).toBe("");
    expect(formatDuration(Number.NaN)).toBe("");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("humanizeUntil", () => {
  it("prazo no futuro: 'em …'", () => {
    expect(humanizeUntil(at(25 * MINUTE), NOW)).toBe("em 25 min");
    expect(humanizeUntil(at(2 * HOUR + 30 * MINUTE), NOW)).toBe("em 2 horas");
    expect(humanizeUntil(at(3 * DAY), NOW)).toBe("em 3 dias");
    expect(humanizeUntil(at(30_000), NOW)).toBe("em menos de 1 min");
  });

  it("prazo vencido vira 'há …' em vez de 'agora'", () => {
    expect(humanizeUntil(at(-3 * HOUR), NOW)).toBe("há 3 horas");
    expect(humanizeUntil(at(-90 * MINUTE), NOW)).toBe("há 1 hora");
  });

  it("no instante exato já conta como vencido (como o <= da view)", () => {
    expect(humanizeUntil(NOW, NOW)).toBe("há menos de 1 min");
  });

  it("aceita a data do PostgREST com microssegundos e fuso", () => {
    expect(humanizeUntil(new Date("2026-09-25T14:00:00.123456+00:00"), NOW)).toBe("em 2 horas");
  });

  it("devolve vazio para data inválida", () => {
    expect(humanizeUntil(new Date("data-invalida"), NOW)).toBe("");
    expect(humanizeUntil(at(HOUR), new Date("data-invalida"))).toBe("");
  });
});

describe("humanizeSince", () => {
  it("instante no passado: 'há …'", () => {
    expect(humanizeSince(at(-3 * HOUR), NOW)).toBe("há 3 horas");
    expect(humanizeSince(at(-2 * DAY - 5 * HOUR), NOW)).toBe("há 2 dias");
    expect(humanizeSince(at(-MINUTE), NOW)).toBe("há 1 min");
    expect(humanizeSince(NOW, NOW)).toBe("há menos de 1 min");
  });

  it("instante no futuro (relógio adiantado) vira 'em …', sem trocar a direção", () => {
    expect(humanizeSince(at(10 * MINUTE), NOW)).toBe("em 10 min");
  });

  it("devolve vazio para data inválida", () => {
    expect(humanizeSince(new Date("data-invalida"), NOW)).toBe("");
  });
});

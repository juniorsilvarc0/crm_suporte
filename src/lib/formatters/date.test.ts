import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addDaysToAppDateKey,
  addMonthsToAppMonthKey,
  dateKeyToAppDate,
  defaultDateTimeLocalForDateKey,
  formatDateTime,
  formatDateTimeLocalInput,
  formatDayNumber,
  formatLongDate,
  formatMonthShort,
  formatMonthTitle,
  formatShortDate,
  formatTime,
  formatWeekdayShort,
  getCurrentAppMonthKey,
  getDayQueryRange,
  getMonthDateKeys,
  getMonthQueryRange,
  getTodayAppDateKey,
  getWeekDateKeys,
  getWeekQueryRange,
  localDateTimeToIso,
  normalizeAppMonthKey,
  toAppDate,
  toAppDateKey,
} from "@/lib/formatters/date";

describe("toAppDate", () => {
  it("interpreta data no formato YYYY-MM-DD como meio-dia no fuso de São Paulo", () => {
    const date = toAppDate("2026-07-02");
    expect(date?.toISOString()).toBe("2026-07-02T15:00:00.000Z");
  });

  it("interpreta data-hora local sem segundos", () => {
    const date = toAppDate("2026-07-02T14:30");
    expect(date?.toISOString()).toBe("2026-07-02T17:30:00.000Z");
  });

  it("interpreta data-hora local com segundos", () => {
    const date = toAppDate("2026-07-02T14:30:45");
    expect(date?.toISOString()).toBe("2026-07-02T17:30:45.000Z");
  });

  it("retorna a mesma instância quando recebe um Date válido", () => {
    const input = new Date("2026-07-02T10:00:00.000Z");
    expect(toAppDate(input)).toBe(input);
  });

  it("retorna null para um Date inválido", () => {
    expect(toAppDate(new Date("data-invalida"))).toBeNull();
  });

  it("retorna null para string inválida", () => {
    expect(toAppDate("nao-e-uma-data")).toBeNull();
  });

  it("retorna null para valores vazios ou nulos", () => {
    expect(toAppDate(null)).toBeNull();
    expect(toAppDate(undefined)).toBeNull();
    expect(toAppDate("")).toBeNull();
    expect(toAppDate("   ")).toBeNull();
  });
});

describe("toAppDateKey", () => {
  it("converte um ISO em UTC para a data local de São Paulo (fuso -03:00)", () => {
    // 2026-07-02T02:00:00Z equivale a 2026-07-01T23:00:00 em São Paulo.
    expect(toAppDateKey("2026-07-02T02:00:00.000Z")).toBe("2026-07-01");
  });

  it("mantém a mesma data quando o horário já está bem dentro do dia local", () => {
    expect(toAppDateKey("2026-07-02T18:00:00.000Z")).toBe("2026-07-02");
  });

  it("retorna string vazia para valor inválido", () => {
    expect(toAppDateKey("invalido")).toBe("");
  });
});

describe("getTodayAppDateKey e getCurrentAppMonthKey", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-07-02T15:00:00Z = 2026-07-02T12:00:00-03:00
    vi.setSystemTime(new Date("2026-07-02T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna a data de hoje no fuso do app", () => {
    expect(getTodayAppDateKey()).toBe("2026-07-02");
  });

  it("retorna o mês corrente no formato YYYY-MM", () => {
    expect(getCurrentAppMonthKey()).toBe("2026-07");
  });
});

describe("normalizeAppMonthKey", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mantém uma chave de mês válida", () => {
    expect(normalizeAppMonthKey("2025-12")).toBe("2025-12");
  });

  it("cai para o mês corrente quando o valor é nulo", () => {
    expect(normalizeAppMonthKey(null)).toBe("2026-07");
  });

  it("cai para o mês corrente quando o formato é inválido", () => {
    expect(normalizeAppMonthKey("2025/12")).toBe("2026-07");
    expect(normalizeAppMonthKey("data-qualquer")).toBe("2026-07");
  });
});

describe("dateKeyToAppDate", () => {
  it("converte uma chave de data válida em Date", () => {
    const date = dateKeyToAppDate("2026-07-02");
    expect(date?.toISOString()).toBe("2026-07-02T15:00:00.000Z");
  });

  it("retorna null para chave inválida", () => {
    expect(dateKeyToAppDate("invalido")).toBeNull();
  });
});

describe("addDaysToAppDateKey", () => {
  it("soma dias dentro do mesmo mês", () => {
    expect(addDaysToAppDateKey("2026-07-02", 1)).toBe("2026-07-03");
  });

  it("soma dias cruzando o fim do mês", () => {
    expect(addDaysToAppDateKey("2026-07-31", 1)).toBe("2026-08-01");
  });

  it("subtrai dias usando valor negativo", () => {
    expect(addDaysToAppDateKey("2026-07-02", -2)).toBe("2026-06-30");
  });

  it("retorna a própria chave quando ela é inválida", () => {
    expect(addDaysToAppDateKey("invalido", 1)).toBe("invalido");
  });
});

describe("addMonthsToAppMonthKey", () => {
  it("soma meses dentro do mesmo ano", () => {
    expect(addMonthsToAppMonthKey("2026-07", 1)).toBe("2026-08");
  });

  it("soma meses cruzando o fim do ano", () => {
    expect(addMonthsToAppMonthKey("2026-07", 6)).toBe("2027-01");
  });

  it("subtrai meses cruzando o início do ano", () => {
    expect(addMonthsToAppMonthKey("2026-01", -1)).toBe("2025-12");
  });
});

describe("getMonthDateKeys", () => {
  it("retorna somente as semanas visíveis que contêm o mês informado", () => {
    const keys = getMonthDateKeys("2026-07");

    expect(keys).toHaveLength(35);
    expect(keys[0]).toBe("2026-06-28");
    expect(keys[34]).toBe("2026-08-01");
    expect(keys).toContain("2026-07-01");
    expect(keys).toContain("2026-07-31");
  });
});

describe("getMonthQueryRange", () => {
  it("retorna o intervalo ISO cobrindo toda a grade do mês", () => {
    const range = getMonthQueryRange("2026-07");

    expect(range.startIso).toBe("2026-06-28T00:00:00-03:00");
    expect(range.endIso).toBe("2026-08-02T00:00:00-03:00");
  });
});

describe("getWeekDateKeys", () => {
  it("retorna a semana de domingo a sábado que contém a data", () => {
    expect(getWeekDateKeys("2026-07-13")).toEqual([
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
    ]);
  });
});

describe("intervalos de semana e dia", () => {
  it("retorna o intervalo ISO completo da semana", () => {
    expect(getWeekQueryRange("2026-07-13")).toEqual({
      startIso: "2026-07-12T00:00:00-03:00",
      endIso: "2026-07-19T00:00:00-03:00",
    });
  });

  it("retorna o intervalo ISO completo do dia", () => {
    expect(getDayQueryRange("2026-07-13")).toEqual({
      startIso: "2026-07-13T00:00:00-03:00",
      endIso: "2026-07-14T00:00:00-03:00",
    });
  });
});

describe("formatDateTime", () => {
  it("formata data e hora no padrão dd/mm/aaaa hh:mm", () => {
    expect(formatDateTime("2026-07-02T14:05:00")).toBe("02/07/2026 14:05");
  });

  it("retorna '-' para valor nulo", () => {
    expect(formatDateTime(null)).toBe("-");
  });
});

describe("formatShortDate", () => {
  it("formata apenas dia e mês", () => {
    expect(formatShortDate("2026-07-02T14:05:00")).toBe("02/07");
  });

  it("retorna '-' para valor nulo", () => {
    expect(formatShortDate(null)).toBe("-");
  });
});

describe("formatTime", () => {
  it("formata apenas hora e minuto", () => {
    expect(formatTime("2026-07-02T14:05:00")).toBe("14:05");
  });

  it("retorna '-' para valor nulo", () => {
    expect(formatTime(null)).toBe("-");
  });
});

describe("formatLongDate", () => {
  it("formata dia da semana por extenso, dia e mês", () => {
    expect(formatLongDate("2026-07-02T12:00:00-03:00")).toBe("quinta-feira, 02 de julho");
  });

  it("retorna '-' para valor nulo/indefinido", () => {
    expect(formatLongDate(null)).toBe("-");
    expect(formatLongDate(undefined)).toBe("-");
  });
});

describe("formatWeekdayShort", () => {
  it("formata dia da semana abreviado sem ponto final", () => {
    expect(formatWeekdayShort("2026-07-02T12:00:00-03:00")).toBe("qui");
  });

  it("retorna '-' para valor nulo", () => {
    expect(formatWeekdayShort(null)).toBe("-");
  });
});

describe("formatDayNumber", () => {
  it("retorna apenas o número do dia", () => {
    expect(formatDayNumber("2026-07-02T12:00:00-03:00")).toBe("02");
  });

  it("retorna '--' para valor nulo", () => {
    expect(formatDayNumber(null)).toBe("--");
  });
});

describe("formatMonthShort", () => {
  it("formata o mês abreviado sem ponto final", () => {
    expect(formatMonthShort("2026-07-02T12:00:00-03:00")).toBe("jul");
  });

  it("retorna '-' para valor nulo", () => {
    expect(formatMonthShort(null)).toBe("-");
  });
});

describe("formatMonthTitle", () => {
  it("formata mês por extenso com ano", () => {
    expect(formatMonthTitle("2026-07")).toBe("julho de 2026");
  });
});

describe("formatDateTimeLocalInput", () => {
  it("formata no padrão usado por <input type='datetime-local'>", () => {
    expect(formatDateTimeLocalInput("2026-07-02T14:05:00")).toBe("2026-07-02T14:05");
  });

  it("retorna string vazia para valor inválido", () => {
    expect(formatDateTimeLocalInput(null)).toBe("");
  });
});

describe("defaultDateTimeLocalForDateKey", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("usa a chave de data informada com horário padrão 09:00", () => {
    expect(defaultDateTimeLocalForDateKey("2026-08-15")).toBe("2026-08-15T09:00");
  });

  it("cai para o dia de hoje quando a chave é inválida ou ausente", () => {
    expect(defaultDateTimeLocalForDateKey(null)).toBe("2026-07-02T09:00");
    expect(defaultDateTimeLocalForDateKey("data-invalida")).toBe("2026-07-02T09:00");
  });
});

describe("localDateTimeToIso", () => {
  it("converte data-hora local para ISO em UTC", () => {
    expect(localDateTimeToIso("2026-07-02T14:30")).toBe("2026-07-02T17:30:00.000Z");
  });

  it("retorna string vazia para entrada inválida", () => {
    expect(localDateTimeToIso("nao-e-data")).toBe("");
  });
});

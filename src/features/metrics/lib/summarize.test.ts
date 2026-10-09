import { describe, expect, it } from "vitest";

import { metricPeriodHref, metricRange, parseMetricPeriod } from "@/features/metrics/lib/period";
import { formatMetricDuration, median, summarizeSupportMetrics, type MetricsInput } from "@/features/metrics/lib/summarize";

const TODAY = "2026-10-09";
const range = metricRange(7, TODAY);

const input = (overrides: Partial<MetricsInput> = {}): MetricsInput => ({
  created: [],
  createdTotal: 0,
  resolved: [],
  resolvedTotal: 0,
  openNow: 0,
  breachedNow: 0,
  reopened: 0,
  ...overrides,
});

describe("período", () => {
  it("abre em 30 dias; aceita 7 e 90; o resto vira o padrão", () => {
    expect(parseMetricPeriod({})).toBe(30);
    expect(parseMetricPeriod({ periodo: "7" })).toBe(7);
    expect(parseMetricPeriod({ periodo: ["90", "7"] })).toBe(90);
    expect(parseMetricPeriod({ periodo: "365" })).toBe(30);
  });

  it("últimos 7 dias = de 00:00 de seis dias atrás até 00:00 de amanhã, no fuso do app", () => {
    expect(range.startIso).toBe("2026-10-03T00:00:00-03:00");
    expect(range.endIso).toBe("2026-10-10T00:00:00-03:00");
    expect(range.dayKeys).toEqual([
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
    ]);
  });

  it("o link do padrão não leva parâmetro", () => {
    expect(metricPeriodHref(30)).toBe("/app/metricas");
    expect(metricPeriodHref(7)).toBe("/app/metricas?periodo=7");
  });
});

describe("median", () => {
  it("ímpar pega o do meio; par, a média dos dois do meio; vazio, null", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("summarizeSupportMetrics", () => {
  it("conta pelo `count` exato e tira a mediana da 1ª resposta só de quem foi respondido", () => {
    const metrics = summarizeSupportMetrics(
      input({
        created: [
          // 10 min até a 1ª resposta.
          { created_at: "2026-10-09T12:00:00Z", source: "agent", first_responded_at: "2026-10-09T12:10:00Z" },
          // 30 min.
          { created_at: "2026-10-08T12:00:00Z", source: "ai", first_responded_at: "2026-10-08T12:30:00Z" },
          // Sem resposta ainda: fora da amostra.
          { created_at: "2026-10-08T15:00:00Z", source: "ai", first_responded_at: null },
        ],
        createdTotal: 3,
        openNow: 5,
        breachedNow: 2,
        reopened: 1,
      }),
      range
    );

    expect(metrics).toMatchObject({
      openNow: 5,
      breachedNow: 2,
      opened: 3,
      openedByAi: 2,
      reopened: 1,
      firstResponse: { medianMs: 20 * 60_000, sample: 2 },
      partial: false,
    });
  });

  it("resposta antes da abertura conta como zero, nunca negativo", () => {
    const metrics = summarizeSupportMetrics(
      input({
        created: [{ created_at: "2026-10-09T12:00:00Z", source: "agent", first_responded_at: "2026-10-09T11:00:00Z" }],
        createdTotal: 1,
      }),
      range
    );

    expect(metrics.firstResponse).toEqual({ medianMs: 0, sample: 1 });
  });

  it("resolução é abertura → resolução, com a amostra dos resolvidos", () => {
    const metrics = summarizeSupportMetrics(
      input({
        resolved: [
          { created_at: "2026-10-01T12:00:00Z", resolved_at: "2026-10-04T12:00:00Z" },
          { created_at: "2026-10-08T12:00:00Z", resolved_at: "2026-10-08T14:00:00Z" },
        ],
        resolvedTotal: 2,
      }),
      range
    );

    expect(metrics.resolved).toBe(2);
    expect(metrics.resolution).toEqual({ medianMs: (72 * 60 + 2 * 60) * 30_000, sample: 2 });
  });

  it("o gráfico conta cada dia pelo calendário do app: 01:00 UTC ainda é o dia anterior", () => {
    const metrics = summarizeSupportMetrics(
      input({
        created: [
          { created_at: "2026-10-09T01:00:00Z", source: "agent", first_responded_at: null },
          { created_at: "2026-10-09T12:00:00Z", source: "agent", first_responded_at: null },
          // Fora da janela (abriu antes): não entra no gráfico.
          { created_at: "2026-09-01T12:00:00Z", source: "agent", first_responded_at: null },
        ],
        createdTotal: 3,
        resolved: [{ created_at: "2026-09-01T12:00:00Z", resolved_at: "2026-10-09T13:00:00Z" }],
        resolvedTotal: 1,
      }),
      range
    );

    expect(metrics.daily).toHaveLength(7);
    expect(metrics.daily.find((point) => point.date === "2026-10-08")).toEqual({
      date: "2026-10-08",
      abertos: 1,
      resolvidos: 0,
    });
    expect(metrics.daily.find((point) => point.date === "2026-10-09")).toEqual({
      date: "2026-10-09",
      abertos: 1,
      resolvidos: 1,
    });
  });

  it("mais tickets que o teto da leitura marca a amostra como parcial", () => {
    const metrics = summarizeSupportMetrics(
      input({
        created: [{ created_at: "2026-10-09T12:00:00Z", source: "agent", first_responded_at: null }],
        createdTotal: 12_000,
      }),
      range
    );

    expect(metrics.opened).toBe(12_000);
    expect(metrics.partial).toBe(true);
  });
});

describe("formatMetricDuration", () => {
  it("escreve a duração com os minutos que importam numa mediana", () => {
    expect(formatMetricDuration(null)).toBe("—");
    expect(formatMetricDuration(30_000)).toBe("menos de 1 min");
    expect(formatMetricDuration(45 * 60_000)).toBe("45 min");
    expect(formatMetricDuration(2 * 3_600_000 + 15 * 60_000)).toBe("2 h 15 min");
    expect(formatMetricDuration(3 * 3_600_000)).toBe("3 h");
    expect(formatMetricDuration((3 * 24 + 4) * 3_600_000)).toBe("3 d 4 h");
    expect(formatMetricDuration(-1)).toBe("—");
  });
});

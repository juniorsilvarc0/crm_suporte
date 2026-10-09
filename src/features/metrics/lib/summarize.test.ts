import { describe, expect, it } from "vitest";

import { metricPeriodHref, metricRange, parseMetricPeriod } from "@/features/metrics/lib/period";
import {
  formatMetricDuration,
  median,
  summarizeSupportMetrics,
  topCustomerIds,
  type MetricNames,
  type MetricsInput,
} from "@/features/metrics/lib/summarize";
import type { CreatedTicketRow, OpenTicketRow, ResolvedTicketRow } from "@/features/metrics/types";

const TODAY = "2026-10-09";
const range = metricRange(7, TODAY);

const created = (overrides: Partial<CreatedTicketRow> = {}): CreatedTicketRow => ({
  created_at: "2026-10-09T12:00:00Z",
  source: "agent",
  first_responded_at: null,
  first_ai_response_at: null,
  product_id: null,
  customer_id: null,
  assigned_to_user_id: null,
  ...overrides,
});

const resolved = (overrides: Partial<ResolvedTicketRow> = {}): ResolvedTicketRow => ({
  created_at: "2026-10-08T12:00:00Z",
  resolved_at: "2026-10-09T12:00:00Z",
  first_responded_at: "2026-10-08T12:30:00Z",
  product_id: null,
  customer_id: null,
  assigned_to_user_id: null,
  ...overrides,
});

const open = (overrides: Partial<OpenTicketRow> = {}): OpenTicketRow => ({
  product_id: null,
  customer_id: null,
  assigned_to_user_id: null,
  ...overrides,
});

const input = (overrides: Partial<MetricsInput> = {}): MetricsInput => {
  const base: MetricsInput = {
    created: [],
    createdTotal: 0,
    resolved: [],
    resolvedTotal: 0,
    open: [],
    openNow: 0,
    breachedNow: 0,
    reopened: 0,
    ...overrides,
  };
  return {
    ...base,
    createdTotal: overrides.createdTotal ?? base.created.length,
    resolvedTotal: overrides.resolvedTotal ?? base.resolved.length,
    openNow: overrides.openNow ?? base.open.length,
  };
};

const NO_NAMES: MetricNames = { products: {}, users: {}, customers: {} };
const summarize = (value: MetricsInput, names: MetricNames = NO_NAMES) => summarizeSupportMetrics(value, range, names);

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
    expect(range.dayKeys).toHaveLength(7);
    expect(range.dayKeys[0]).toBe("2026-10-03");
    expect(range.dayKeys[6]).toBe(TODAY);
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

describe("summarizeSupportMetrics — resumo", () => {
  it("conta pelo `count` exato e tira a mediana da 1ª resposta só de quem foi respondido", () => {
    const metrics = summarize(
      input({
        created: [
          created({ first_responded_at: "2026-10-09T12:10:00Z" }),
          created({ created_at: "2026-10-08T12:00:00Z", source: "ai", first_responded_at: "2026-10-08T12:30:00Z" }),
          created({ created_at: "2026-10-08T15:00:00Z", source: "ai" }),
        ],
        openNow: 5,
        breachedNow: 2,
        reopened: 1,
      })
    );

    expect(metrics).toMatchObject({
      openNow: 5,
      breachedNow: 2,
      opened: 3,
      openedByAi: 2,
      reopened: 1,
      firstResponse: { medianMs: 20 * 60_000, sample: 2 },
    });
  });

  it("resposta antes da abertura conta como zero, nunca negativo", () => {
    expect(summarize(input({ created: [created({ first_responded_at: "2026-10-09T11:00:00Z" })] })).firstResponse).toEqual({
      medianMs: 0,
      sample: 1,
    });
  });

  it("resolução é abertura → resolução, com a amostra dos resolvidos", () => {
    const metrics = summarize(
      input({
        resolved: [
          resolved({ created_at: "2026-10-01T12:00:00Z", resolved_at: "2026-10-04T12:00:00Z" }),
          resolved({ created_at: "2026-10-08T12:00:00Z", resolved_at: "2026-10-08T14:00:00Z" }),
        ],
      })
    );

    expect(metrics.resolution).toEqual({ medianMs: 37 * 3_600_000, sample: 2 });
  });

  it("o gráfico conta cada dia pelo calendário do app: 01:00 UTC ainda é o dia anterior", () => {
    const metrics = summarize(
      input({
        created: [
          created({ created_at: "2026-10-09T01:00:00Z" }),
          created({ created_at: "2026-10-09T12:00:00Z" }),
          created({ created_at: "2026-09-01T12:00:00Z" }),
        ],
        resolved: [resolved({ created_at: "2026-09-01T12:00:00Z", resolved_at: "2026-10-09T13:00:00Z" })],
      })
    );

    expect(metrics.daily).toHaveLength(7);
    expect(metrics.daily.find((point) => point.date === "2026-10-08")).toEqual({ date: "2026-10-08", abertos: 1, resolvidos: 0 });
    expect(metrics.daily.find((point) => point.date === TODAY)).toEqual({ date: TODAY, abertos: 1, resolvidos: 1 });
  });

  it("mais tickets que o teto (em qualquer leitura, inclusive os em aberto) marca a amostra como parcial", () => {
    expect(summarize(input({ created: [created()], createdTotal: 12_000 })).partial).toBe(true);
    expect(summarize(input({ open: [open()], openNow: 12_000 })).partial).toBe(true);
    expect(summarize(input({ created: [created()] })).partial).toBe(false);
  });
});

describe("summarizeSupportMetrics — recortes", () => {
  const names: MetricNames = {
    products: { erp: "ERP", fiscal: "Fiscal" },
    users: { ana: "Ana Lima", bruno: "Bruno Costa" },
    customers: { padaria: "Padaria São João", mercado: "Mercado Bom Preço" },
  };

  it("por fila: abertos, resolvidos, em aberto agora e a mediana da 1ª resposta, com 'Sem fila' por último", () => {
    const metrics = summarize(
      input({
        created: [
          created({ product_id: "erp", first_responded_at: "2026-10-09T12:10:00Z" }),
          created({ product_id: "erp", first_responded_at: "2026-10-09T12:30:00Z" }),
          created({ product_id: "fiscal" }),
          created(),
        ],
        resolved: [resolved({ product_id: "fiscal" })],
        open: [open({ product_id: "erp" }), open({ product_id: "fiscal" }), open({ product_id: "fiscal" })],
      }),
      names
    );

    expect(metrics.breakdowns.byProduct).toEqual([
      { id: "erp", name: "ERP", opened: 2, resolved: 0, openNow: 1, firstResponse: { medianMs: 20 * 60_000, sample: 2 } },
      { id: "fiscal", name: "Fiscal", opened: 1, resolved: 1, openNow: 2, firstResponse: { medianMs: null, sample: 0 } },
      { id: null, name: "Sem fila", opened: 1, resolved: 0, openNow: 0, firstResponse: { medianMs: null, sample: 0 } },
    ]);
  });

  it("por analista: o responsável atual, com a carga (em aberto) primeiro e 'Sem responsável' contando o que ninguém pegou", () => {
    const metrics = summarize(
      input({
        resolved: [resolved({ assigned_to_user_id: "ana" }), resolved({ assigned_to_user_id: "ana" })],
        open: [open({ assigned_to_user_id: "bruno" }), open({ assigned_to_user_id: "bruno" }), open()],
      }),
      names
    );

    expect(metrics.breakdowns.byAssignee.map((row) => [row.name, row.openNow, row.resolved])).toEqual([
      ["Bruno Costa", 2, 0],
      ["Sem responsável", 1, 0],
      ["Ana Lima", 0, 2],
    ]);
  });

  it("por cliente: os que mais abriram, sem 'Sem empresa', e quantos clientes diferentes abriram", () => {
    const value = input({
      created: [
        created({ customer_id: "mercado" }),
        created({ customer_id: "padaria" }),
        created({ customer_id: "padaria" }),
        created(),
        created(),
        created(),
      ],
      open: [open({ customer_id: "mercado" })],
    });

    expect(topCustomerIds(value)).toEqual(["padaria", "mercado"]);
    const metrics = summarize(value, names);
    expect(metrics.breakdowns.byCustomer.map((row) => [row.name, row.opened, row.openNow])).toEqual([
      ["Padaria São João", 2, 0],
      ["Mercado Bom Preço", 1, 1],
    ]);
    expect(metrics.breakdowns.customerCount).toBe(2);
  });

  it("o ranking de clientes para no limite", () => {
    const value = input({ created: Array.from({ length: 12 }, (_, index) => created({ customer_id: `c${index}` })) });

    expect(topCustomerIds(value, 10)).toHaveLength(10);
  });

  it("id sem nome não some: vira '—'", () => {
    expect(summarize(input({ created: [created({ product_id: "removida" })] }), names).breakdowns.byProduct[0].name).toBe("—");
  });
});

describe("summarizeSupportMetrics — IA × analista", () => {
  it("conta quem abriu, a mediana da 1ª resposta da IA e os resolvidos sem resposta do analista", () => {
    const metrics = summarize(
      input({
        created: [
          created({ source: "ai", first_ai_response_at: "2026-10-09T12:01:00Z" }),
          created({ source: "ai", first_ai_response_at: "2026-10-09T12:03:00Z" }),
          created({ source: "agent" }),
          created({ source: "api" }),
        ],
        resolved: [resolved({ first_responded_at: null }), resolved()],
      })
    );

    expect(metrics.aiVsHuman).toEqual({
      openedBy: { ai: 2, agent: 1, api: 1 },
      firstAiResponse: { medianMs: 2 * 60_000, sample: 2 },
      resolvedWithoutHuman: 1,
    });
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

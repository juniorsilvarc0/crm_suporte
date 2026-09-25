import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Lead } from "@/features/leads/types";
import {
  filterLeadsByPeriod,
  getPeriodFilter,
  getPeriodFromSearchParams,
} from "@/features/dashboard/lib/period";

describe("getPeriodFromSearchParams", () => {
  it("retorna o valor quando é string", () => {
    expect(getPeriodFromSearchParams({ period: "7d" })).toBe("7d");
  });

  it("retorna o primeiro item quando é array", () => {
    expect(getPeriodFromSearchParams({ period: ["30d", "7d"] })).toBe("30d");
  });

  it("retorna undefined quando ausente", () => {
    expect(getPeriodFromSearchParams({})).toBeUndefined();
  });
});

describe("getPeriodFilter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna {} para 'all' ou ausência de período", () => {
    expect(getPeriodFilter("all")).toEqual({});
    expect(getPeriodFilter(undefined)).toEqual({});
  });

  it("calcula 'from' 7 dias atrás para '7d'", () => {
    expect(getPeriodFilter("7d")).toEqual({ from: "2026-06-26T12:00:00.000Z" });
  });

  it("calcula 'from' 30 dias atrás para '30d'", () => {
    expect(getPeriodFilter("30d")).toEqual({ from: "2026-06-03T12:00:00.000Z" });
  });

  it("calcula 'from' 90 dias atrás para '90d'", () => {
    expect(getPeriodFilter("90d")).toEqual({ from: "2026-04-04T12:00:00.000Z" });
  });
});

describe("filterLeadsByPeriod", () => {
  const lead = (id: string, created_at: string) =>
    ({ id, created_at }) as unknown as Lead;

  const leads = [
    lead("a", "2026-07-01T00:00:00.000Z"),
    lead("b", "2026-06-01T00:00:00.000Z"),
    lead("c", "2026-05-01T00:00:00.000Z"),
  ];

  it("retorna todos quando não há intervalo", () => {
    expect(filterLeadsByPeriod(leads, {})).toHaveLength(3);
  });

  it("mantém só os leads a partir de 'from'", () => {
    const result = filterLeadsByPeriod(leads, { from: "2026-06-15T00:00:00.000Z" });
    expect(result.map((l) => l.id)).toEqual(["a"]);
  });

  it("respeita 'from' e 'to'", () => {
    const result = filterLeadsByPeriod(leads, {
      from: "2026-05-15T00:00:00.000Z",
      to: "2026-06-15T00:00:00.000Z",
    });
    expect(result.map((l) => l.id)).toEqual(["b"]);
  });
});

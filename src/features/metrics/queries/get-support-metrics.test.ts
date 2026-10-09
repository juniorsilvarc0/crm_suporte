import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, envMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  envMock: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: envMock,
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

import { metricRange } from "@/features/metrics/lib/period";
import { METRIC_ROW_CAP, getSupportMetrics } from "@/features/metrics/queries/get-support-metrics";

type Call = [method: string, ...args: unknown[]];

function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "gte", "lt", "order", "limit", "eq", "neq", "not"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  return { builder, calls };
}

/** Uma resposta por leitura, na ordem: abertos, resolvidos, em aberto, estourados, reaberturas. */
function queueQueries(...results: unknown[]) {
  const queries = results.map(fakeQuery);
  for (const query of queries) fromMock.mockReturnValueOnce(query.builder);
  return queries.map((query) => query.calls);
}

const range = metricRange(7, "2026-10-09");
const ok = (data: unknown, count: number) => ({ data, count, error: null });

beforeEach(() => {
  fromMock.mockReset();
  envMock.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getSupportMetrics", () => {
  it("lê as cinco fontes com o recorte certo de cada uma", async () => {
    const [created, resolved, openNow, breached, reopened] = queueQueries(
      ok([], 0),
      ok([], 0),
      ok(null, 0),
      ok(null, 0),
      ok(null, 0)
    );

    await getSupportMetrics(range);

    expect(fromMock.mock.calls.map(([table]) => table)).toEqual([
      "tickets",
      "tickets",
      "ticket_queue",
      "ticket_queue",
      "ticket_status_history",
    ]);
    expect(created).toEqual([
      ["select", "created_at, source, first_responded_at", { count: "exact" }],
      ["gte", "created_at", "2026-10-03T00:00:00-03:00"],
      ["lt", "created_at", "2026-10-10T00:00:00-03:00"],
      ["order", "created_at", { ascending: true }],
      ["limit", METRIC_ROW_CAP],
    ]);
    expect(resolved).toContainEqual(["gte", "resolved_at", "2026-10-03T00:00:00-03:00"]);
    expect(resolved).toContainEqual(["lt", "resolved_at", "2026-10-10T00:00:00-03:00"]);
    // Em aberto agora: nem encerrado nem resolvido — e sem recorte de período.
    expect(openNow).toEqual([
      ["select", "id", { count: "exact", head: true }],
      ["eq", "is_terminal", false],
      ["neq", "status", "resolvido"],
    ]);
    expect(breached).toContainEqual(["eq", "sla_breached", true]);
    // Reabrir = sair de "resolvido" para atendimento, dentro da janela.
    expect(reopened).toEqual([
      ["select", "id", { count: "exact", head: true }],
      ["eq", "from_status", "resolvido"],
      ["not", "to_status", "in", "(fechado,cancelado)"],
      ["gte", "occurred_at", "2026-10-03T00:00:00-03:00"],
      ["lt", "occurred_at", "2026-10-10T00:00:00-03:00"],
    ]);
  });

  it("monta as métricas com as contagens exatas do banco", async () => {
    queueQueries(
      ok(
        [
          { created_at: "2026-10-09T12:00:00Z", source: "ai", first_responded_at: "2026-10-09T12:20:00Z" },
          { created_at: "2026-10-08T12:00:00Z", source: "agent", first_responded_at: null },
        ],
        2
      ),
      ok([{ created_at: "2026-10-08T12:00:00Z", resolved_at: "2026-10-09T12:00:00Z" }], 1),
      ok(null, 7),
      ok(null, 3),
      ok(null, 1)
    );

    const metrics = await getSupportMetrics(range);

    expect(metrics).toMatchObject({
      failed: false,
      openNow: 7,
      breachedNow: 3,
      opened: 2,
      openedByAi: 1,
      resolved: 1,
      reopened: 1,
      firstResponse: { medianMs: 20 * 60_000, sample: 1 },
      resolution: { medianMs: 24 * 3_600_000, sample: 1 },
      partial: false,
    });
  });

  it("qualquer leitura com erro vira falha marcada, nunca zero", async () => {
    queueQueries(ok([], 0), ok([], 0), ok(null, 0), { data: null, count: null, error: { code: "42P01", message: "boom" } }, ok(null, 0));

    const metrics = await getSupportMetrics(range);

    expect(metrics).toEqual({ failed: true, range });
  });

  it("sem o Supabase configurado, falha marcada sem consultar", async () => {
    envMock.mockReturnValue(false);

    expect(await getSupportMetrics(range)).toEqual({ failed: true, range });
    expect(fromMock).not.toHaveBeenCalled();
  });
});

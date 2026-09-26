import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, envMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  envMock: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: envMock,
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

import { TICKET_LIST_SELECT } from "@/features/tickets/queries/get-tickets-page";
import { getTicketQueue, TICKET_QUEUE_LIMIT } from "@/features/tickets/queries/get-ticket-queue";

type Call = [method: string, ...args: unknown[]];

// Builder encadeável que grava cada chamada e resolve com `result` quando é
// aguardado. O mesmo de get-tickets-page.test.ts.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "ilike", "eq", "neq", "is", "not", "order", "range", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  return { builder, calls };
}

// Na ordem em que a função chama from(): "mine" e depois "unassigned".
function queueQueries(...results: unknown[]) {
  const queries = results.map(fakeQuery);
  for (const query of queries) fromMock.mockReturnValueOnce(query.builder);
  return queries.map((query) => query.calls);
}

const VIEWER = "5b0e0c2a-1d3f-4c55-9a77-0c1d2e3f4a5b";
const NOW = new Date("2026-09-25T15:00:00.000Z");

// Como o PostgREST entrega a linha da view: instantes crus com microssegundos.
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  number: 1024,
  title: "Erro ao emitir nota fiscal",
  status: "novo",
  priority: "alta",
  version: 1,
  source: "ai",
  conversation_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  is_terminal: false,
  reopened_count: 0,
  sla_mode: "running",
  sla_first_response_minutes: 60,
  sla_resolution_minutes: 480,
  sla_warn_pct: 80,
  first_response_due_at: "2026-09-25T13:00:00.123456+00:00",
  resolution_due_at: "2026-09-25T20:00:00.123456+00:00",
  first_responded_at: null,
  sla_paused_at: null,
  resolved_at: null,
  closed_at: null,
  next_due_at: "2026-09-25T13:00:00.123456+00:00",
  last_inbound_at: "2026-09-25T12:05:00.000001+00:00",
  created_at: "2026-09-25T12:00:00.123456+00:00",
  updated_at: "2026-09-25T12:00:00.123456+00:00",
  customer: null,
  contact: { id: "p1", name: "Maria Souza", phone: "5527999990000" },
  product: null,
  assignee: null,
  ...overrides,
});

const ok = (data: unknown[], count = data.length) => ({ data, error: null, count });
const failure = () => ({
  data: null,
  error: { code: "57014", message: "timeout" },
  count: null,
});

// Só os filtros, na ordem em que a query os aplica.
const filters = (calls: Call[]) =>
  calls.filter(([method]) => ["eq", "neq", "is", "not", "ilike"].includes(method));

const FAILED = { items: [], total: 0, failed: true };

beforeEach(() => {
  fromMock.mockReset();
  envMock.mockReturnValue(true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getTicketQueue", () => {
  it("mine: do analista e não terminal; unassigned: sem responsável e relógio não parado", async () => {
    const [mine, unassigned] = queueQueries(ok([]), ok([]));

    await getTicketQueue(VIEWER);

    expect(fromMock.mock.calls).toEqual([["ticket_queue"], ["ticket_queue"]]);
    expect(mine[0]).toEqual(["select", TICKET_LIST_SELECT, { count: "exact" }]);
    expect(filters(mine)).toEqual([
      ["eq", "assigned_to_user_id", VIEWER],
      ["eq", "is_terminal", false],
    ]);
    expect(unassigned[0]).toEqual(["select", TICKET_LIST_SELECT, { count: "exact" }]);
    expect(filters(unassigned)).toEqual([
      ["is", "assigned_to_user_id", null],
      ["neq", "sla_mode", "stopped"],
    ]);
  });

  it("cada seção traz no máximo 8, por prazo", async () => {
    const [mine, unassigned] = queueQueries(ok([]), ok([]));

    await getTicketQueue(VIEWER);

    expect(TICKET_QUEUE_LIMIT).toBe(8);
    for (const calls of [mine, unassigned]) {
      expect(calls.filter(([method]) => method === "order")[0]).toEqual([
        "order",
        "next_due_at",
        { ascending: true, nullsFirst: false },
      ]);
      expect(calls.at(-1)).toEqual(["limit", 8]);
    }
  });

  it("devolve os itens, o total da contagem e o instante da leitura", async () => {
    const assignee = { id: VIEWER, name: "Ana", avatar_color: "violet", avatar_url: null };
    queueQueries(ok([row({ assignee })], 3), ok([row()], 12));

    const queue = await getTicketQueue(VIEWER);

    expect(queue).toEqual({
      mine: { items: [row({ assignee })], total: 3, failed: false },
      unassigned: { items: [row()], total: 12, failed: false },
      fetchedAt: NOW.toISOString(),
    });
  });

  it("erro em mine falha só ela; unassigned segue com itens e total", async () => {
    queueQueries(failure(), ok([row()], 12));

    const queue = await getTicketQueue(VIEWER);

    expect(queue.mine).toEqual(FAILED);
    expect(queue.unassigned).toEqual({ items: [row()], total: 12, failed: false });
    expect(console.error).toHaveBeenCalled();
  });

  it("linha inesperada em unassigned falha só ela; mine segue", async () => {
    queueQueries(ok([row()], 1), ok([row({ status: "arquivado" })], 1));

    const queue = await getTicketQueue(VIEWER);

    expect(queue.mine).toEqual({ items: [row()], total: 1, failed: false });
    expect(queue.unassigned).toEqual(FAILED);
  });

  it("sem Supabase configurado, as duas seções são failed", async () => {
    envMock.mockReturnValue(false);

    expect(await getTicketQueue(VIEWER)).toEqual({
      mine: FAILED,
      unassigned: FAILED,
      fetchedAt: NOW.toISOString(),
    });
    expect(fromMock).not.toHaveBeenCalled();
  });
});

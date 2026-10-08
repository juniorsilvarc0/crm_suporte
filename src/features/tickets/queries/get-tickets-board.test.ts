import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, envMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  envMock: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: envMock,
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

import { getTicketsBoard } from "@/features/tickets/queries/get-tickets-board";
import { parseTicketListParams } from "@/features/tickets/queries/get-tickets-page";

type Call = [method: string, ...args: unknown[]];

// Builder encadeável: grava cada chamada e resolve com `result` quando aguardado.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of ["select", "or", "eq", "is", "ilike", "neq", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  return { builder, calls };
}

// Uma linha válida da view ticket_queue (toTicketListItem não a recusa).
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    number: 1024,
    title: "Sistema travando",
    status: "em_atendimento",
    priority: "alta",
    version: 3,
    source: "ai",
    conversation_id: "22222222-2222-4222-8222-222222222222",
    is_terminal: false,
    reopened_count: 0,
    sla_mode: "running",
    sla_first_response_minutes: 60,
    sla_resolution_minutes: 480,
    sla_warn_pct: 80,
    first_response_due_at: "2026-10-08T10:00:00Z",
    resolution_due_at: "2026-10-08T17:00:00Z",
    first_responded_at: null,
    sla_paused_at: null,
    resolved_at: null,
    closed_at: null,
    next_due_at: "2026-10-08T17:00:00Z",
    last_inbound_at: null,
    replied_after_resolve: false,
    created_at: "2026-10-08T09:00:00Z",
    updated_at: "2026-10-08T09:00:00Z",
    customer: null,
    contact: { id: "c1", name: "Maria", phone: "5586999990000" },
    product: null,
    assignee: null,
    ...overrides,
  };
}

const params = () => parseTicketListParams({});

beforeEach(() => {
  vi.clearAllMocks();
  envMock.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getTicketsBoard", () => {
  it("força o status ATIVOS (sla_mode != stopped), ignorando o status da URL", async () => {
    const query = fakeQuery({ data: [row()], error: null });
    fromMock.mockReturnValue(query.builder);

    // Mesmo pedindo "encerrados" na URL, o quadro traz os ativos.
    await getTicketsBoard({ ...params(), status: "encerrados" }, "viewer-1");

    expect(fromMock).toHaveBeenCalledWith("ticket_queue");
    expect(query.calls).toContainEqual(["neq", "sla_mode", "stopped"]);
    // Nunca filtra por status terminal.
    expect(query.calls.some(([m, , v]) => m === "eq" && v === "encerrados")).toBe(false);
    // Sem paginação: só o limite do teto.
    expect(query.calls.some(([m]) => m === "limit")).toBe(true);
  });

  it("mapeia os itens e marca capped=false quando cabe no teto", async () => {
    fromMock.mockReturnValue(fakeQuery({ data: [row(), row({ number: 1025 })], error: null }).builder);

    const board = await getTicketsBoard(params(), "viewer-1");

    expect(board.items).toHaveLength(2);
    expect(board.capped).toBe(false);
    expect(board.items?.[0]).toMatchObject({ number: 1024, status: "em_atendimento" });
  });

  it("marca capped=true e corta no teto quando vem mais que o limite", async () => {
    // BOARD_MAX = 500 → 501 linhas dispara o capped.
    const rows = Array.from({ length: 501 }, (_, i) => row({ number: 2000 + i }));
    fromMock.mockReturnValue(fakeQuery({ data: rows, error: null }).builder);

    const board = await getTicketsBoard(params(), "viewer-1");

    expect(board.capped).toBe(true);
    expect(board.items).toHaveLength(500);
  });

  it("erro do banco devolve items null (não lista vazia)", async () => {
    fromMock.mockReturnValue(fakeQuery({ data: null, error: { message: "boom" } }).builder);

    const board = await getTicketsBoard(params(), "viewer-1");

    expect(board.items).toBeNull();
    expect(board.capped).toBe(false);
  });

  it("sem Supabase configurado também é items null", async () => {
    envMock.mockReturnValue(false);
    const board = await getTicketsBoard(params(), "viewer-1");
    expect(board.items).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });
});

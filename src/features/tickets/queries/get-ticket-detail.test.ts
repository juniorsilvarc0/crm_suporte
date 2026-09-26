import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

import { getTicketDetail } from "@/features/tickets/queries/get-ticket-detail";

type Call = [method: string, ...args: unknown[]];

// Builder encadeável que grava cada chamada e resolve com `result` quando é
// aguardado (ou no maybeSingle). Molde de get-ticket-queue.test.ts.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
    maybeSingle: () => Promise.resolve(result),
  };
  for (const method of ["select", "eq", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  return { builder, calls };
}

const TICKET_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

// A linha da view com os embeds do detalhe, como o PostgREST entrega.
const row = (overrides: Record<string, unknown> = {}) => ({
  id: TICKET_ID,
  number: 1024,
  title: "Erro ao emitir nota fiscal",
  status: "em_atendimento",
  priority: "alta",
  version: 3,
  source: "agent",
  conversation_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  is_terminal: false,
  reopened_count: 0,
  sla_mode: "running",
  sla_first_response_minutes: 60,
  sla_resolution_minutes: 480,
  sla_warn_pct: 80,
  first_response_due_at: "2026-09-25T13:00:00.123456+00:00",
  resolution_due_at: "2026-09-25T20:00:00.123456+00:00",
  first_responded_at: "2026-09-25T12:10:00+00:00",
  sla_paused_at: null,
  resolved_at: null,
  closed_at: null,
  next_due_at: "2026-09-25T20:00:00.123456+00:00",
  last_inbound_at: null,
  created_at: "2026-09-25T12:00:00.123456+00:00",
  updated_at: "2026-09-25T12:30:00.123456+00:00",
  customer: null,
  contact: { id: "p1", name: "Maria Souza", phone: "5527999990000" },
  product: null,
  assignee: null,
  description: null,
  contact_id: "p1",
  customer_id: null,
  contract_id: null,
  product_id: null,
  category_id: "c9",
  assigned_to_user_id: null,
  first_ai_response_at: null,
  contract: null,
  creator: null,
  category: { id: "c9", name: "Antiga", archived_at: "2026-09-01T00:00:00+00:00" },
  conversation: { active_ticket_id: TICKET_ID },
  ...overrides,
});

function mockReads(detail: unknown) {
  const ticket = fakeQuery({ data: detail, error: null });
  const attachments = fakeQuery({ data: [], error: null });
  fromMock.mockReturnValueOnce(ticket.builder).mockReturnValueOnce(attachments.builder);
  return ticket.calls;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getTicketDetail — categoria e foco", () => {
  it("deve pedir a categoria e só o foco da conversa, pelo nome da FK", async () => {
    const calls = mockReads(row());

    await getTicketDetail(1024);

    const select = String(calls.find(([method]) => method === "select")?.[1]);
    expect(select).toContain("category:ticket_categories!tickets_category_id_fkey(id, name, archived_at)");
    expect(select).toContain(
      "conversation:chat_conversations!tickets_conversation_id_fkey(active_ticket_id)"
    );
    expect(select).not.toMatch(/ai_triage|idempotency_key/);
  });

  it("deve trazer a categoria atual mesmo arquivada e o ticket em foco", async () => {
    mockReads(row());

    const result = await getTicketDetail(1024);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.ticket.category).toEqual({
      id: "c9",
      name: "Antiga",
      archived_at: "2026-09-01T00:00:00+00:00",
    });
    expect(result.ticket.in_focus).toBe(true);
  });

  it("deve marcar fora de foco quando a conversa foca outro ticket ou nenhum", async () => {
    mockReads(row({ conversation: { active_ticket_id: "outro" }, category: null, category_id: null }));
    const other = await getTicketDetail(1024);
    mockReads(row({ conversation: { active_ticket_id: null } }));
    const none = await getTicketDetail(1024);

    expect(other.status === "ok" && other.ticket.in_focus).toBe(false);
    expect(other.status === "ok" && other.ticket.category).toBeNull();
    expect(none.status === "ok" && none.ticket.in_focus).toBe(false);
  });
});

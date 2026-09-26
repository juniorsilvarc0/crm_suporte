import { beforeEach, describe, expect, it, vi } from "vitest";

const { userMock, adminClientMock, fromMock, timelineMock } = vi.hoisted(() => ({
  userMock: vi.fn(),
  adminClientMock: vi.fn(),
  fromMock: vi.fn(),
  timelineMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: userMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: adminClientMock,
}));
// A montagem da página tem teste próprio (get-ticket-timeline.test.ts); aqui
// vale o que a rota faz em volta dela.
vi.mock("@/features/tickets/queries/get-ticket-timeline", () => ({
  getTicketTimeline: timelineMock,
}));

import { GET } from "@/app/api/tickets/[id]/timeline/route";
import type { TicketTimelinePage } from "@/features/tickets/types";

const VIEWER_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
// O `at` como o PostgREST devolve: microssegundos e fuso.
const CURSOR = "2026-09-26T02:45:57.194405+00:00";

type Call = [method: string, ...args: unknown[]];

// Leitura do ticket: grava as chamadas e resolve no maybeSingle.
function queueTicketRead(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = () => {
    calls.push(["maybeSingle"]);
    return Promise.resolve(result);
  };
  fromMock.mockReturnValueOnce(builder);
  return calls;
}

function get(query = "", id = TICKET_ID) {
  return GET(new Request(`http://x/api/tickets/${id}/timeline${query}`), {
    params: Promise.resolve({ id }),
  });
}

const page: TicketTimelinePage = {
  items: [
    {
      kind: "status",
      id: "44444444-4444-4444-8444-444444444444",
      at: CURSOR,
      seq: 7,
      from_status: "novo",
      to_status: "em_atendimento",
      actor_type: "agent",
      actor_user_id: VIEWER_ID,
      reason: null,
    },
    {
      kind: "comment",
      id: "55555555-5555-4555-8555-555555555555",
      at: CURSOR,
      author_user_id: VIEWER_ID,
      author_token_id: null,
      body: "Cliente pediu retorno à tarde.",
      edited_at: null,
      deleted_at: null,
    },
  ],
  hasMore: true,
  nextBefore: CURSOR,
};

beforeEach(() => {
  vi.clearAllMocks();
  userMock.mockResolvedValue({ viewer: { id: VIEWER_ID, role: "member" } });
  adminClientMock.mockReturnValue({ from: fromMock });
  timelineMock.mockResolvedValue(page);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/tickets/[id]/timeline", () => {
  it("recusa sem usuário ativo antes de acessar o banco", async () => {
    userMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await get();

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(timelineMock).not.toHaveBeenCalled();
  });

  it("id fora de UUID (o protocolo não serve aqui) → 400", async () => {
    const response = await get("", "1024");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, message: "Ticket inválido." });
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("before fora do formato → 400 no campo, sem ir ao banco", async () => {
    const response = await get("?before=ontem");
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors.before).toEqual(["Instante inválido."]);
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(timelineMock).not.toHaveBeenCalled();
  });

  it("\"+\" do fuso sem codificar chega como espaço → 400", async () => {
    const response = await get(`?before=${CURSOR}`);

    expect(response.status).toBe(400);
    expect(timelineMock).not.toHaveBeenCalled();
  });

  it("fuso que o Postgres recusa (+16:00) → 400, não 500", async () => {
    const before = "2026-09-26T02:45:57.194405+16:00";

    const response = await get(`?${new URLSearchParams({ before })}`);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors.before).toEqual(["Instante inválido."]);
    expect(timelineMock).not.toHaveBeenCalled();
  });

  it("parâmetro desconhecido (o beforeId saiu do contrato) → 400", async () => {
    const response = await get(
      `?${new URLSearchParams({ before: CURSOR, beforeId: "55555555-5555-4555-8555-555555555555" })}`
    );

    expect(response.status).toBe(400);
    expect(timelineMock).not.toHaveBeenCalled();
  });

  it("ticket inexistente → 404, sem ler a timeline", async () => {
    const calls = queueTicketRead({ data: null, error: null });

    const response = await get();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      code: "not_found",
      message: "Ticket não encontrado.",
    });
    expect(fromMock).toHaveBeenCalledWith("tickets");
    expect(calls).toEqual([["select", "id"], ["eq", "id", TICKET_ID], ["maybeSingle"]]);
    expect(timelineMock).not.toHaveBeenCalled();
  });

  it("falha ao ler o ticket → 500 logado, sem a mensagem do banco", async () => {
    queueTicketRead({ data: null, error: { code: "57014", message: "canceling statement" } });

    const response = await get();
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toEqual({ ok: false, message: "Não foi possível carregar a timeline." });
    expect(console.error).toHaveBeenCalledWith(
      "[GET /api/tickets/[id]/timeline]",
      "57014",
      "canceling statement"
    );
    expect(timelineMock).not.toHaveBeenCalled();
  });

  it("1ª página: sem cursor, devolve itens, hasMore e nextBefore", async () => {
    queueTicketRead({ data: { id: TICKET_ID }, error: null });

    const response = await get();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(timelineMock).toHaveBeenCalledWith(TICKET_ID, { before: undefined });
    expect(json).toEqual({ ok: true, ...page });
  });

  it("página seguinte: o before chega CRU à consulta (microssegundos e fuso)", async () => {
    queueTicketRead({ data: { id: TICKET_ID }, error: null });

    const response = await get(`?${new URLSearchParams({ before: CURSOR })}`);

    expect(response.status).toBe(200);
    expect(timelineMock).toHaveBeenCalledWith(TICKET_ID, { before: CURSOR });
  });

  it("ticket que existe com página vazia → 200 vazio, não 404", async () => {
    queueTicketRead({ data: { id: TICKET_ID }, error: null });
    timelineMock.mockResolvedValue({ items: [], hasMore: false, nextBefore: null });

    const response = await get(`?${new URLSearchParams({ before: "2020-01-01T00:00:00+00:00" })}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      items: [],
      hasMore: false,
      nextBefore: null,
    });
  });

  it("falha de uma fonte da timeline → 500 logado, sem a mensagem do banco", async () => {
    queueTicketRead({ data: { id: TICKET_ID }, error: null });
    timelineMock.mockRejectedValue(
      new Error("getTicketTimeline ticket_events failed: permission denied for table ticket_events")
    );

    const response = await get();
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toEqual({ ok: false, message: "Não foi possível carregar a timeline." });
    expect(JSON.stringify(json)).not.toContain("permission denied");
    expect(console.error).toHaveBeenCalledWith(
      "[GET /api/tickets/[id]/timeline]",
      expect.any(Error)
    );
  });
});

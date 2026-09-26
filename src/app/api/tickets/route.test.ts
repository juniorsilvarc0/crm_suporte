import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationTickets, TicketSummary } from "@/features/tickets/types";

const {
  sessionMock,
  adminEnvMock,
  adminClientMock,
  rpcMock,
  pushTakeoverMock,
  conversationTicketsMock,
} = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  adminEnvMock: vi.fn(),
  adminClientMock: vi.fn(),
  rpcMock: vi.fn(),
  pushTakeoverMock: vi.fn(),
  conversationTicketsMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: sessionMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: adminEnvMock,
  createSupabaseAdminClient: adminClientMock,
}));
vi.mock("@/features/chat/lib/push-takeover", () => ({
  pushTakeoverToAgent: pushTakeoverMock,
}));
vi.mock("@/features/tickets/queries/get-conversation-tickets", () => ({
  getConversationTickets: conversationTicketsMock,
}));

import { GET, POST } from "@/app/api/tickets/route";

// Ids fictícios. O jsonb segue o formato conferido no banco local (instante com
// microssegundos e fuso, number como número).
const VIEWER_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";
const IDEMPOTENCY_KEY = "88888888-8888-4888-8888-888888888888";
// Endereço do canal (telefone): nunca pode chegar à resposta.
const EXTERNAL_ID = "5500900001111";

function summary(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: TICKET_ID,
    number: 1024,
    title: "Erro ao emitir relatório",
    status: "em_atendimento",
    priority: "alta",
    version: 3,
    conversation_id: CONVERSATION_ID,
    assigned_to_user_id: VIEWER_ID,
    product_id: null,
    category_id: null,
    customer_id: null,
    contract_id: null,
    first_response_due_at: "2026-09-26T04:03:13.996092+00:00",
    resolution_due_at: "2026-09-26T11:03:13.996092+00:00",
    first_responded_at: null,
    sla_paused_at: null,
    resolved_at: null,
    closed_at: null,
    updated_at: "2026-09-26T03:03:13.996092+00:00",
    ...overrides,
  };
}

// O jsonb de create_ticket. O replay (mesma chave) vem com created=false,
// linked_messages=0 e conversation_changed=false (migration, create_ticket).
function created(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      ticket: summary(),
      created: true,
      linked_messages: 2,
      conversation_changed: true,
      conversation_external_id: EXTERNAL_ID,
      ...overrides,
    },
    error: null,
  };
}

function dbError(message: string, extra: { code?: string; details?: string; hint?: string } = {}) {
  return {
    data: null,
    error: {
      message,
      code: extra.code ?? "P0001",
      details: extra.details ?? "",
      hint: extra.hint ?? "",
    },
  };
}

// Como o formulário envia.
const form = {
  conversation_id: CONVERSATION_ID,
  title: "  Erro ao emitir relatório  ",
  priority: "alta",
  description: "",
  product_id: "",
  category_id: null,
  take_over: true,
  idempotency_key: IDEMPOTENCY_KEY,
};

function post(body: unknown) {
  return POST(
    new Request("http://x/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

function get(query: string) {
  return GET(new Request(`http://x/api/tickets${query}`));
}

// O que a RPC recebe de fato: o supabase-js serializa os args em JSON, e chave
// com undefined some. É isso que a RPC enxerga como "ausente".
function sentArgs(call = 0): Record<string, unknown> {
  return JSON.parse(JSON.stringify(rpcMock.mock.calls[call][1]));
}

const fakeClient = { rpc: rpcMock };

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ viewer: { id: VIEWER_ID, role: "member" } });
  adminEnvMock.mockReturnValue(true);
  adminClientMock.mockReturnValue(fakeClient);
  rpcMock.mockResolvedValue(created());
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/tickets", () => {
  it("recusa sem usuário ativo antes de acessar o banco", async () => {
    sessionMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await post(form);

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sem o Supabase admin configurado → 500 sem chamar a RPC", async () => {
    adminEnvMock.mockReturnValue(false);

    const response = await post(form);

    expect(response.status).toBe(500);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("JSON inválido → 400", async () => {
    const response = await post("{");

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("JSON inválido.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("campo inválido → 400 no campo, sem chamar a RPC", async () => {
    const response = await post({ ...form, title: "ab", priority: "urgente" });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.errors.title).toEqual(["Use ao menos 3 caracteres."]);
    expect(json.errors.priority).toEqual(["Escolha a prioridade."]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("título com NUL → 400 no campo, sem chamar a RPC (o banco daria 22P05)", async () => {
    const response = await post({ ...form, title: "Erro ao\u0000 emitir" });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors.title).toEqual(["Remova os caracteres inválidos."]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("exige a idempotency_key", async () => {
    // undefined some do JSON: a chave chega ausente.
    const response = await post({ ...form, idempotency_key: undefined });

    expect(response.status).toBe(400);
    expect((await response.json()).errors.idempotency_key).toBeDefined();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("recusa ator no corpo (400): o ator é sempre o da sessão", async () => {
    const response = await post({ ...form, actor_user_id: "55555555-5555-4555-8555-555555555555" });

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("abre com o ator da sessão, opcionais vazios ausentes → 201 sem o telefone", async () => {
    const response = await post({ ...form, idempotency_key: IDEMPOTENCY_KEY.toUpperCase() });
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(adminClientMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][0]).toBe("create_ticket");
    expect(sentArgs()).toStrictEqual({
      p_actor_user_id: VIEWER_ID,
      p_conversation_id: CONVERSATION_ID,
      p_title: "Erro ao emitir relatório",
      p_priority: "alta",
      p_take_over: true,
      p_idempotency_key: IDEMPOTENCY_KEY,
    });
    expect(json).toStrictEqual({
      ok: true,
      ticket: summary(),
      created: true,
      linked_messages: 2,
    });
    expect(JSON.stringify(json)).not.toContain(EXTERNAL_ID);
    expect(json).not.toHaveProperty("conversation_external_id");
    expect(json).not.toHaveProperty("conversation_changed");
  });

  it("repassa descrição e fila quando vêm preenchidas", async () => {
    await post({ ...form, description: "Tela trava ao salvar.", product_id: PRODUCT_ID });

    expect(sentArgs()).toMatchObject({
      p_description: "Tela trava ao salvar.",
      p_product_id: PRODUCT_ID,
    });
    expect(sentArgs()).not.toHaveProperty("p_category_id");
  });

  it("a mesma chave duas vezes: 1º 201, 2º 200 com created:false e o mesmo ticket", async () => {
    rpcMock.mockResolvedValueOnce(created()).mockResolvedValueOnce(
      created({ created: false, linked_messages: 0, conversation_changed: false })
    );

    const first = await post(form);
    const second = await post(form);
    const secondJson = await second.json();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(secondJson).toStrictEqual({
      ok: true,
      ticket: summary(),
      created: false,
      linked_messages: 0,
    });
    expect(sentArgs(0).p_idempotency_key).toBe(IDEMPOTENCY_KEY);
    expect(sentArgs(1).p_idempotency_key).toBe(IDEMPOTENCY_KEY);
    // O replay não assume de novo: só a 1ª chamada avisa a IA.
    expect(pushTakeoverMock).toHaveBeenCalledTimes(1);
  });

  it("avisa a IA quando o take_over mudou a conversa para human", async () => {
    await post(form);

    expect(pushTakeoverMock).toHaveBeenCalledTimes(1);
    expect(pushTakeoverMock).toHaveBeenCalledWith(EXTERNAL_ID, true);
  });

  it("não avisa a IA sem take_over", async () => {
    rpcMock.mockResolvedValue(
      created({ ticket: summary({ status: "novo", assigned_to_user_id: null }), conversation_changed: false })
    );

    const response = await post({ ...form, take_over: false });

    expect(response.status).toBe(201);
    expect(sentArgs().p_take_over).toBe(false);
    expect(pushTakeoverMock).not.toHaveBeenCalled();
  });

  it("não avisa a IA quando a conversa já estava com humano", async () => {
    rpcMock.mockResolvedValue(created({ conversation_changed: false }));

    const response = await post(form);

    expect(response.status).toBe(201);
    expect(pushTakeoverMock).not.toHaveBeenCalled();
  });

  it("conversa inexistente → 404 not_found", async () => {
    rpcMock.mockResolvedValue(dbError("CONVERSATION_NOT_FOUND"));

    const response = await post(form);
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json).toMatchObject({ ok: false, code: "not_found", message: "Conversa não encontrada." });
    expect(pushTakeoverMock).not.toHaveBeenCalled();
  });

  it("chave já usada em outra conversa → 409 idempotency_key_reused", async () => {
    rpcMock.mockResolvedValue(dbError("IDEMPOTENCY_KEY_REUSED"));

    const response = await post(form);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("idempotency_key_reused");
  });

  it("fila arquivada → 422 no campo product_id", async () => {
    rpcMock.mockResolvedValue(dbError("PRODUCT_ARCHIVED"));

    const response = await post({ ...form, product_id: PRODUCT_ID });
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.code).toBe("product_archived");
    expect(json.errors).toEqual({ product_id: ["Fila arquivada. Escolha outra."] });
  });

  it("analista desativado entre o guard e a RPC → 403", async () => {
    rpcMock.mockResolvedValue(dbError("FORBIDDEN"));

    const response = await post(form);

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
  });

  it("erro inesperado do banco → 500 logado, sem o texto do banco", async () => {
    rpcMock.mockResolvedValue(
      dbError("permission denied for table tickets", { code: "42501", details: "linha secreta" })
    );

    const response = await post(form);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toEqual({
      ok: false,
      code: "internal",
      message: "Não foi possível concluir a operação.",
    });
    expect(JSON.stringify(json)).not.toContain("permission denied");
    expect(console.error).toHaveBeenCalledWith(
      "[POST /api/tickets]",
      "internal",
      "Não foi possível concluir a operação."
    );
    // O DETAIL pode trazer a linha inteira: nunca vai para o log.
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("linha secreta");
  });

  it("retorno da RPC fora do formato → 500, sem vazar o jsonb", async () => {
    rpcMock.mockResolvedValue(created({ ticket: { ...summary(), ai_triage: {} } }));

    const response = await post(form);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.code).toBe("internal");
    expect(JSON.stringify(json)).not.toContain(EXTERNAL_ID);
  });
});

describe("GET /api/tickets", () => {
  const page: ConversationTickets = { active_ticket_id: TICKET_ID, tickets: [] };

  beforeEach(() => {
    conversationTicketsMock.mockResolvedValue(page);
  });

  it("recusa sem usuário ativo antes de acessar o banco", async () => {
    sessionMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await get(`?conversation_id=${CONVERSATION_ID}`);

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(conversationTicketsMock).not.toHaveBeenCalled();
  });

  it.each([[""], ["?conversation_id="], ["?conversation_id=abc"], [`?conversation_id=${CONVERSATION_ID}x`]])(
    "conversation_id ausente ou fora de UUID (%s) → 400",
    async (query) => {
      const response = await get(query);

      expect(response.status).toBe(400);
      expect((await response.json()).message).toBe("Conversa inválida.");
      expect(conversationTicketsMock).not.toHaveBeenCalled();
    }
  );

  it("sem o Supabase admin configurado → 500", async () => {
    adminEnvMock.mockReturnValue(false);

    const response = await get(`?conversation_id=${CONVERSATION_ID}`);

    expect(response.status).toBe(500);
    expect(conversationTicketsMock).not.toHaveBeenCalled();
  });

  it("devolve o foco e os tickets da conversa, com o client criado depois do guard", async () => {
    const response = await get(`?conversation_id=${CONVERSATION_ID}`);

    expect(response.status).toBe(200);
    expect(conversationTicketsMock).toHaveBeenCalledWith(fakeClient, CONVERSATION_ID);
    expect(await response.json()).toStrictEqual({
      ok: true,
      active_ticket_id: TICKET_ID,
      tickets: [],
    });
  });

  it("erro de leitura → 500 logado, nunca lista vazia", async () => {
    conversationTicketsMock.mockRejectedValue({ code: "42501", message: "permission denied" });

    const response = await get(`?conversation_id=${CONVERSATION_ID}`);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toEqual({
      ok: false,
      message: "Não foi possível carregar os tickets da conversa.",
    });
    expect(console.error).toHaveBeenCalled();
  });
});

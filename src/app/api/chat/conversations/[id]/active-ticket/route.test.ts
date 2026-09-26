import { beforeEach, describe, expect, it, vi } from "vitest";

const { userMock, adminClientMock, rpcMock } = vi.hoisted(() => ({
  userMock: vi.fn(),
  adminClientMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: userMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: adminClientMock,
}));

import { PUT } from "@/app/api/chat/conversations/[id]/active-ticket/route";

// Ids fictícios. O serviço é o real; só o `rpc` do client é falso.
const VIEWER_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_TICKET_ID = "55555555-5555-4555-8555-555555555555";

const params = { params: Promise.resolve({ id: CONVERSATION_ID }) };

function put(body: unknown, id = CONVERSATION_ID) {
  return PUT(
    new Request(`http://x/api/chat/conversations/${id}/active-ticket`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    id === CONVERSATION_ID ? params : { params: Promise.resolve({ id }) }
  );
}

// O que o supabase-js manda de fato: chave com undefined some no JSON.
const sentArgs = () => JSON.parse(JSON.stringify(rpcMock.mock.calls[0][1]));

function rpcError(message: string, extra: Record<string, unknown> = {}) {
  return { data: null, error: { code: "P0001", message, details: null, hint: null, ...extra } };
}

beforeEach(() => {
  vi.clearAllMocks();
  userMock.mockResolvedValue({ viewer: { id: VIEWER_ID, role: "member" } });
  rpcMock.mockResolvedValue({
    data: { active_ticket_id: TICKET_ID, changed: true },
    error: null,
  });
  adminClientMock.mockReturnValue({ rpc: rpcMock });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("PUT /api/chat/conversations/[id]/active-ticket", () => {
  it("recusa sem usuário ativo antes de acessar o banco", async () => {
    userMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await put({ ticket_id: TICKET_ID });

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("conversa fora de UUID → 400 sem chamar a RPC", async () => {
    const response = await put({ ticket_id: TICKET_ID }, "conversa-1");
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ ok: false, message: "Conversa inválida." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("JSON inválido → 400", async () => {
    const response = await put("{ticket_id:");

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("JSON inválido.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sem a chave ticket_id → 400 no campo (tirar o foco é null explícito)", async () => {
    const response = await put({});
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors.ticket_id).toEqual(["Ticket inválido."]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ticket_id fora de UUID → 400 no campo", async () => {
    const response = await put({ ticket_id: "SUP-1024" });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors.ticket_id).toEqual(["Ticket inválido."]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ator no corpo → 400 (.strict()); o ator é sempre o da sessão", async () => {
    const response = await put({ ticket_id: TICKET_ID, p_actor_user_id: OTHER_TICKET_ID });

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("põe o ticket em foco com o ator da sessão", async () => {
    const response = await put({ ticket_id: TICKET_ID });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][0]).toBe("ticket_set_active");
    expect(sentArgs()).toEqual({
      p_actor_user_id: VIEWER_ID,
      p_conversation_id: CONVERSATION_ID,
      p_ticket_id: TICKET_ID,
    });
    expect(json).toEqual({ ok: true, active_ticket_id: TICKET_ID, changed: true });
  });

  it("null tira o foco: p_ticket_id vai AUSENTE (default null da RPC)", async () => {
    rpcMock.mockResolvedValue({ data: { active_ticket_id: null, changed: true }, error: null });

    const response = await put({ ticket_id: null });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(sentArgs()).toEqual({
      p_actor_user_id: VIEWER_ID,
      p_conversation_id: CONVERSATION_ID,
    });
    expect(json).toEqual({ ok: true, active_ticket_id: null, changed: true });
  });

  it("\"\" (seleção vazia) também tira o foco", async () => {
    rpcMock.mockResolvedValue({ data: { active_ticket_id: null, changed: false }, error: null });

    const response = await put({ ticket_id: "" });

    expect(response.status).toBe(200);
    expect(sentArgs()).not.toHaveProperty("p_ticket_id");
  });

  it("o mesmo foco de novo → 200 com changed:false", async () => {
    rpcMock.mockResolvedValue({ data: { active_ticket_id: TICKET_ID, changed: false }, error: null });

    const response = await put({ ticket_id: TICKET_ID });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, active_ticket_id: TICKET_ID, changed: false });
  });

  it("TICKET_NOT_IN_CONVERSATION → 422 marcando ticket_id", async () => {
    rpcMock.mockResolvedValue(rpcError("TICKET_NOT_IN_CONVERSATION"));

    const response = await put({ ticket_id: OTHER_TICKET_ID });
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json).toMatchObject({
      ok: false,
      code: "ticket_not_in_conversation",
      errors: { ticket_id: ["O ticket não é desta conversa."] },
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("TICKET_TERMINAL → 409", async () => {
    rpcMock.mockResolvedValue(rpcError("TICKET_TERMINAL"));

    const response = await put({ ticket_id: TICKET_ID });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toMatchObject({ ok: false, code: "ticket_terminal" });
  });

  it("CONVERSATION_NOT_FOUND → 404", async () => {
    rpcMock.mockResolvedValue(rpcError("CONVERSATION_NOT_FOUND"));

    const response = await put({ ticket_id: TICKET_ID });

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
  });

  it("FORBIDDEN (desativado entre o guard e a RPC) → 403", async () => {
    rpcMock.mockResolvedValue(
      rpcError("FORBIDDEN", { details: "Usuário inativo ou inexistente." })
    );

    const response = await put({ ticket_id: TICKET_ID });
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.code).toBe("forbidden");
    expect(JSON.stringify(json)).not.toContain("inexistente");
  });

  it("erro do banco sem TAG → 500 logado, sem a mensagem do banco no corpo", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied for table chat_conversations" },
    });

    const response = await put({ ticket_id: TICKET_ID });
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toMatchObject({ ok: false, code: "internal" });
    expect(JSON.stringify(json)).not.toContain("permission denied");
    expect(console.error).toHaveBeenCalledWith(
      "[PUT /api/chat/conversations/[id]/active-ticket]",
      "internal",
      expect.any(String)
    );
  });

  it("retorno da RPC fora do formato → 500", async () => {
    rpcMock.mockResolvedValue({ data: { active_ticket_id: "SUP-1024", changed: true }, error: null });

    const response = await put({ ticket_id: TICKET_ID });

    expect(response.status).toBe(500);
    expect((await response.json()).ok).toBe(false);
  });
});

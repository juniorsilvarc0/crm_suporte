import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { TicketSummary } from "@/features/tickets/types";

const {
  userMock,
  hasAdminEnvMock,
  adminClientMock,
  rpcMock,
  fromMock,
  selectMock,
  eqMock,
  maybeSingleMock,
  pushTakeoverMock,
} = vi.hoisted(() => ({
  userMock: vi.fn(),
  hasAdminEnvMock: vi.fn(),
  adminClientMock: vi.fn(),
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  selectMock: vi.fn(),
  eqMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  pushTakeoverMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: userMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: hasAdminEnvMock,
  createSupabaseAdminClient: adminClientMock,
}));
vi.mock("@/features/chat/lib/push-takeover", () => ({
  pushTakeoverToAgent: pushTakeoverMock,
}));

import { POST } from "@/app/api/tickets/[id]/take-over/route";

// Ids fictícios. DETAIL e jsonb no formato conferido no banco local.
const VIEWER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
// Endereço do canal (telefone): vai só para o push, nunca para a resposta.
const EXTERNAL_ID = "5500900001111";
const params = { params: Promise.resolve({ id: TICKET_ID }) };

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

function takeOverResult(conversationChanged: boolean) {
  return {
    data: {
      ticket: summary(),
      conversation_id: CONVERSATION_ID,
      conversation_status: "human",
      conversation_changed: conversationChanged,
      conversation_external_id: EXTERNAL_ID,
    },
    error: null,
  };
}

function post(body: unknown, id = TICKET_ID) {
  return new Request(`http://x/api/tickets/${id}/take-over`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function dbError(message: string, extra: { code?: string; details?: string; hint?: string } = {}) {
  return {
    data: null,
    error: { message, code: extra.code ?? "P0001", details: extra.details ?? "", hint: extra.hint ?? "" },
  };
}

// O que vai de fato ao PostgREST: chave com undefined some no JSON.
function sentArgs(rpc: Mock) {
  const [name, args] = rpc.mock.calls[0] as [string, unknown];
  return { name, args: JSON.parse(JSON.stringify(args)) as Record<string, unknown> };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  userMock.mockResolvedValue({ viewer: { id: VIEWER_ID, role: "member", is_active: true } });
  hasAdminEnvMock.mockReturnValue(true);
  pushTakeoverMock.mockResolvedValue({ delivered: true, skipped: false });
  rpcMock.mockResolvedValue(takeOverResult(true));
  maybeSingleMock.mockResolvedValue({ data: { id: OTHER_USER_ID, name: "Ana" }, error: null });
  eqMock.mockReturnValue({ maybeSingle: maybeSingleMock });
  selectMock.mockReturnValue({ eq: eqMock });
  fromMock.mockReturnValue({ select: selectMock });
  adminClientMock.mockReturnValue({ rpc: rpcMock, from: fromMock });
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("POST /api/tickets/[id]/take-over", () => {
  it("sem sessão → 401 sem criar o client nem avisar a IA", async () => {
    userMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await POST(post({}), params);

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(pushTakeoverMock).not.toHaveBeenCalled();
  });

  it("id fora de UUID → 400 sem chamar a RPC", async () => {
    const response = await POST(post({}), { params: Promise.resolve({ id: "1024" }) });

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sem Supabase admin → 500 sem chamar a RPC", async () => {
    hasAdminEnvMock.mockReturnValue(false);

    const response = await POST(post({}), params);

    expect(response.status).toBe(500);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("corpo que não é JSON → 400 (o corpo sem campo é `{}`)", async () => {
    const response = await POST(post(""), params);

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("JSON inválido.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("usuário no corpo ou reassign que não é booleano → 400 sem chamar a RPC", async () => {
    for (const body of [{ user_id: OTHER_USER_ID }, { reassign: "sim" }]) {
      const response = await POST(post(body), params);
      expect(response.status).toBe(400);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("assume com o ator da sessão, avisa a IA e não devolve o telefone", async () => {
    const response = await POST(post({}), params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(sentArgs(rpcMock)).toStrictEqual({
      name: "ticket_take_over",
      args: { p_ticket_id: TICKET_ID, p_actor_user_id: VIEWER_ID, p_reassign: false },
    });
    expect(json).toStrictEqual({
      ok: true,
      ticket: summary(),
      conversation: { id: CONVERSATION_ID, status: "human" },
    });
    expect(pushTakeoverMock).toHaveBeenCalledTimes(1);
    expect(pushTakeoverMock).toHaveBeenCalledWith(EXTERNAL_ID, true);
    expect(JSON.stringify(json)).not.toContain(EXTERNAL_ID);
    expect(JSON.stringify(json)).not.toContain("conversation_changed");
  });

  it("conversa que já era human → 200 sem novo aviso à IA", async () => {
    rpcMock.mockResolvedValue(takeOverResult(false));

    const response = await POST(post({}), params);

    expect(response.status).toBe(200);
    expect(pushTakeoverMock).not.toHaveBeenCalled();
  });

  it("reassign=true segue para a RPC (tomar o ticket de outro analista)", async () => {
    await POST(post({ reassign: true }), params);

    expect(sentArgs(rpcMock).args).toMatchObject({ p_reassign: true });
  });

  it("ALREADY_ASSIGNED → 409 com o id e o nome de quem está com o ticket", async () => {
    rpcMock.mockResolvedValue(dbError("ALREADY_ASSIGNED", { details: OTHER_USER_ID }));

    const response = await POST(post({}), params);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(fromMock).toHaveBeenCalledWith("app_users");
    expect(selectMock).toHaveBeenCalledWith("id, name");
    expect(eqMock).toHaveBeenCalledWith("id", OTHER_USER_ID);
    expect(json).toStrictEqual({
      ok: false,
      code: "already_assigned",
      message: "Este ticket já está com outro analista.",
      assigned_to_user_id: OTHER_USER_ID,
      assigned_to_name: "Ana",
    });
    expect(pushTakeoverMock).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("ALREADY_ASSIGNED com a leitura do nome falhando → 409 só com o id, e loga", async () => {
    rpcMock.mockResolvedValue(dbError("ALREADY_ASSIGNED", { details: OTHER_USER_ID }));
    maybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table app_users", code: "42501" },
    });

    const response = await POST(post({}), params);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toStrictEqual({
      ok: false,
      code: "already_assigned",
      message: "Este ticket já está com outro analista.",
      assigned_to_user_id: OTHER_USER_ID,
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[POST /api/tickets/[id]/take-over]",
      "nome do responsável",
      "permission denied for table app_users"
    );
  });

  it("ALREADY_ASSIGNED de usuário que não existe mais → 409 sem nome", async () => {
    rpcMock.mockResolvedValue(dbError("ALREADY_ASSIGNED", { details: OTHER_USER_ID }));
    maybeSingleMock.mockResolvedValue({ data: null, error: null });

    const json = await (await POST(post({}), params)).json();

    expect(json.assigned_to_user_id).toBe(OTHER_USER_ID);
    expect(json).not.toHaveProperty("assigned_to_name");
  });

  it("ALREADY_ASSIGNED sem uuid no DETAIL → 409 sem ler app_users", async () => {
    rpcMock.mockResolvedValue(dbError("ALREADY_ASSIGNED", { details: "" }));

    const response = await POST(post({}), params);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(fromMock).not.toHaveBeenCalled();
    expect(json).not.toHaveProperty("assigned_to_user_id");
  });

  it("TICKET_TERMINAL → 409 sem avisar a IA", async () => {
    rpcMock.mockResolvedValue(dbError("TICKET_TERMINAL"));

    const response = await POST(post({}), params);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("ticket_terminal");
    expect(pushTakeoverMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("TICKET_NOT_FOUND → 404", async () => {
    rpcMock.mockResolvedValue(dbError("TICKET_NOT_FOUND"));

    const response = await POST(post({}), params);

    expect(response.status).toBe(404);
  });

  it("FORBIDDEN (ator desativado entre o guard e a RPC) → 403", async () => {
    rpcMock.mockResolvedValue(dbError("FORBIDDEN", { details: "Usuário inativo ou inexistente." }));

    const response = await POST(post({}), params);

    expect(response.status).toBe(403);
  });

  it("erro do banco sem TAG → 500 logado, sem repassar a mensagem do banco", async () => {
    rpcMock.mockResolvedValue(dbError("deadlock detected", { code: "40P01" }));

    const response = await POST(post({}), params);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("deadlock");
    expect(consoleError).toHaveBeenCalledWith(
      "[POST /api/tickets/[id]/take-over]",
      "internal",
      "Não foi possível concluir a operação."
    );
  });

  it("retorno fora do formato depois do commit → 500, mas a IA é avisada", async () => {
    rpcMock.mockResolvedValue({
      data: {
        ticket: { id: TICKET_ID },
        conversation_changed: true,
        conversation_external_id: EXTERNAL_ID,
      },
      error: null,
    });

    const response = await POST(post({}), params);

    expect(response.status).toBe(500);
    expect(pushTakeoverMock).toHaveBeenCalledWith(EXTERNAL_ID, true);
    expect(await response.text()).not.toContain(EXTERNAL_ID);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { TicketSummary } from "@/features/tickets/types";

const { userMock, hasAdminEnvMock, adminClientMock, rpcMock } = vi.hoisted(() => ({
  userMock: vi.fn(),
  hasAdminEnvMock: vi.fn(),
  adminClientMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: userMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: hasAdminEnvMock,
  createSupabaseAdminClient: adminClientMock,
}));

import { POST } from "@/app/api/tickets/[id]/transition/route";

// Ids fictícios. DETAIL/HINT e jsonb no formato conferido no banco local.
const VIEWER_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const params = { params: Promise.resolve({ id: TICKET_ID }) };

function summary(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: TICKET_ID,
    number: 1024,
    title: "Erro ao emitir relatório",
    status: "aguardando_cliente",
    priority: "alta",
    version: 4,
    conversation_id: CONVERSATION_ID,
    assigned_to_user_id: VIEWER_ID,
    product_id: null,
    category_id: null,
    customer_id: null,
    contract_id: null,
    first_response_due_at: "2026-09-26T04:03:13.996092+00:00",
    resolution_due_at: "2026-09-26T11:03:13.996092+00:00",
    first_responded_at: "2026-09-26T03:10:00.1944+00:00",
    sla_paused_at: "2026-09-26T03:20:00+00:00",
    resolved_at: null,
    closed_at: null,
    updated_at: "2026-09-26T03:20:00+00:00",
    ...overrides,
  };
}

function post(body: unknown, id = TICKET_ID) {
  return new Request(`http://x/api/tickets/${id}/transition`, {
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
  rpcMock.mockResolvedValue({
    data: { ticket: summary(), from: "em_atendimento", to: "aguardando_cliente", changed: true },
    error: null,
  });
  adminClientMock.mockReturnValue({ rpc: rpcMock });
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("POST /api/tickets/[id]/transition", () => {
  it("sem sessão → 401 sem criar o client", async () => {
    userMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await POST(post({ to: "resolvido", version: 4 }), params);

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("id fora de UUID → 400 sem chamar a RPC", async () => {
    const response = await POST(post({ to: "resolvido", version: 4 }), {
      params: Promise.resolve({ id: "1024" }),
    });

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sem Supabase admin → 500 sem chamar a RPC", async () => {
    hasAdminEnvMock.mockReturnValue(false);

    const response = await POST(post({ to: "resolvido", version: 4 }), params);

    expect(response.status).toBe(500);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("JSON inválido → 400", async () => {
    const response = await POST(post("{"), params);

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("JSON inválido.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("cancelar sem motivo → 400 no campo reason, sem chamar a RPC", async () => {
    const response = await POST(post({ to: "cancelado", version: 4, reason: "   " }), params);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors.reason).toEqual(["Informe o motivo do cancelamento."]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("status fora das chaves e versão ausente → 400 nos campos", async () => {
    const response = await POST(post({ to: "arquivado" }), params);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors.to).toEqual(["Status inválido."]);
    expect(json.errors.version).toEqual(["Versão inválida."]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ator no corpo → 400 (.strict()): o ator só vem da sessão", async () => {
    const response = await POST(
      post({ to: "resolvido", version: 4, actor_user_id: "22222222-2222-4222-8222-222222222222" }),
      params
    );

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("move com o ator da sessão, omite o motivo ausente e devolve o resumo", async () => {
    const response = await POST(post({ to: "aguardando_cliente", version: 4 }), params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(sentArgs(rpcMock)).toStrictEqual({
      name: "ticket_transition",
      args: {
        p_actor_user_id: VIEWER_ID,
        p_ticket_id: TICKET_ID,
        p_to: "aguardando_cliente",
        p_expected_version: 4,
      },
    });
    expect(json).toStrictEqual({
      ok: true,
      ticket: summary(),
      from: "em_atendimento",
      to: "aguardando_cliente",
      changed: true,
    });
  });

  it("cancela com o motivo aparado", async () => {
    rpcMock.mockResolvedValue({
      data: {
        ticket: summary({ status: "cancelado", closed_at: "2026-09-26T03:30:00+00:00", version: 5 }),
        from: "em_atendimento",
        to: "cancelado",
        changed: true,
      },
      error: null,
    });

    const response = await POST(post({ to: "cancelado", version: 4, reason: "  Duplicado " }), params);

    expect(response.status).toBe(200);
    expect(sentArgs(rpcMock).args).toMatchObject({ p_to: "cancelado", p_reason: "Duplicado" });
  });

  it("mesmo status de novo → 200 com changed=false", async () => {
    rpcMock.mockResolvedValue({
      data: { ticket: summary(), from: "aguardando_cliente", to: "aguardando_cliente", changed: false },
      error: null,
    });

    const response = await POST(post({ to: "aguardando_cliente", version: 3 }), params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.changed).toBe(false);
  });

  it("INVALID_TRANSITION → 409 com allowed e current", async () => {
    rpcMock.mockResolvedValue(
      dbError("INVALID_TRANSITION", {
        details: '["aguardando_cliente", "aguardando_interno", "resolvido", "cancelado"]',
        hint: "em_atendimento",
      })
    );

    const response = await POST(post({ to: "novo", version: 4 }), params);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toStrictEqual({
      ok: false,
      code: "invalid_transition",
      message: "Esse movimento não é permitido a partir do status atual.",
      allowed: ["aguardando_cliente", "aguardando_interno", "resolvido", "cancelado"],
      current: "em_atendimento",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("de um terminal, INVALID_TRANSITION vem com allowed vazio", async () => {
    rpcMock.mockResolvedValue(dbError("INVALID_TRANSITION", { details: "[]", hint: "fechado" }));

    const json = await (await POST(post({ to: "em_atendimento", version: 9 }), params)).json();

    expect(json).toMatchObject({ code: "invalid_transition", allowed: [], current: "fechado" });
  });

  it("VERSION_CONFLICT → 409 com current_version", async () => {
    rpcMock.mockResolvedValue(dbError("VERSION_CONFLICT", { details: "5" }));

    const response = await POST(post({ to: "resolvido", version: 4 }), params);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toMatchObject({ ok: false, code: "version_conflict", current_version: 5 });
  });

  it("REASON_REQUIRED da RPC → 422 no campo reason", async () => {
    rpcMock.mockResolvedValue(
      dbError("REASON_REQUIRED", { details: "Informe o motivo do cancelamento." })
    );

    const response = await POST(post({ to: "cancelado", version: 4, reason: "x" }), params);
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.code).toBe("reason_required");
    expect(json.errors).toEqual({ reason: ["Informe o motivo do cancelamento."] });
  });

  it("TICKET_NOT_FOUND → 404", async () => {
    rpcMock.mockResolvedValue(dbError("TICKET_NOT_FOUND"));

    const response = await POST(post({ to: "resolvido", version: 4 }), params);

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
  });

  it("erro do banco sem TAG → 500 logado, sem repassar a mensagem do banco", async () => {
    rpcMock.mockResolvedValue(
      dbError('permission denied for table "tickets"', { code: "42501" })
    );

    const response = await POST(post({ to: "resolvido", version: 4 }), params);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("permission denied");
    expect(consoleError).toHaveBeenCalledWith(
      "[POST /api/tickets/[id]/transition]",
      "internal",
      "Não foi possível concluir a operação."
    );
  });

  it("retorno da RPC fora do formato → 500 logado", async () => {
    rpcMock.mockResolvedValue({ data: { ticket: { id: TICKET_ID }, changed: true }, error: null });

    const response = await POST(post({ to: "resolvido", version: 4 }), params);

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalled();
  });
});

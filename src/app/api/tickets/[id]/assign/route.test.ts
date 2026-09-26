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

import { POST } from "@/app/api/tickets/[id]/assign/route";

// Ids fictícios. jsonb no formato conferido no banco local.
const VIEWER_ID = "11111111-1111-4111-8111-111111111111";
const ASSIGNEE_ID = "55555555-5555-4555-8555-555555555555";
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const params = { params: Promise.resolve({ id: TICKET_ID }) };

function summary(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: TICKET_ID,
    number: 1024,
    title: "Erro ao emitir relatório",
    status: "em_atendimento",
    priority: "media",
    version: 3,
    conversation_id: CONVERSATION_ID,
    assigned_to_user_id: ASSIGNEE_ID,
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

function post(body: unknown, id = TICKET_ID) {
  return new Request(`http://x/api/tickets/${id}/assign`, {
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
  rpcMock.mockResolvedValue({ data: { ticket: summary(), changed: true }, error: null });
  adminClientMock.mockReturnValue({ rpc: rpcMock });
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("POST /api/tickets/[id]/assign", () => {
  it("sem sessão → 401 sem criar o client", async () => {
    userMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await POST(post({ assignee_id: ASSIGNEE_ID, version: 2 }), params);

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("id fora de UUID → 400 sem chamar a RPC", async () => {
    const response = await POST(post({ assignee_id: ASSIGNEE_ID, version: 2 }), {
      params: Promise.resolve({ id: "SUP-1024" }),
    });

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sem Supabase admin → 500 sem chamar a RPC", async () => {
    hasAdminEnvMock.mockReturnValue(false);

    const response = await POST(post({ assignee_id: ASSIGNEE_ID, version: 2 }), params);

    expect(response.status).toBe(500);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("JSON inválido → 400", async () => {
    const response = await POST(post("não é json"), params);

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("JSON inválido.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("assignee_id esquecido → 400 no campo: nunca tira o responsável em silêncio", async () => {
    const response = await POST(post({ version: 2 }), params);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors.assignee_id).toEqual(["Responsável inválido."]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("assignee_id que não é uuid e versão fora da faixa → 400 nos campos", async () => {
    const response = await POST(post({ assignee_id: "ana", version: 0 }), params);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors.assignee_id).toEqual(["Responsável inválido."]);
    expect(json.errors.version).toEqual(["Versão inválida."]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ator no corpo → 400 (.strict()): o ator só vem da sessão", async () => {
    const response = await POST(
      post({ assignee_id: ASSIGNEE_ID, version: 2, actor_user_id: ASSIGNEE_ID }),
      params
    );

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("atribui com o ator da sessão e devolve o resumo", async () => {
    const response = await POST(post({ assignee_id: ASSIGNEE_ID, version: 2 }), params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(sentArgs(rpcMock)).toStrictEqual({
      name: "ticket_assign",
      args: {
        p_actor_user_id: VIEWER_ID,
        p_ticket_id: TICKET_ID,
        p_expected_version: 2,
        p_assignee_id: ASSIGNEE_ID,
      },
    });
    expect(json).toStrictEqual({ ok: true, ticket: summary(), changed: true });
  });

  it("null explícito tira o responsável (p_assignee_id ausente = default null da RPC)", async () => {
    rpcMock.mockResolvedValue({
      data: { ticket: summary({ assigned_to_user_id: null, version: 3 }), changed: true },
      error: null,
    });

    const response = await POST(post({ assignee_id: null, version: 2 }), params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(sentArgs(rpcMock).args).not.toHaveProperty("p_assignee_id");
    expect(json.ticket.assigned_to_user_id).toBeNull();
  });

  it("mesmo responsável de novo → 200 com changed=false", async () => {
    rpcMock.mockResolvedValue({ data: { ticket: summary(), changed: false }, error: null });

    const response = await POST(post({ assignee_id: ASSIGNEE_ID, version: 1 }), params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.changed).toBe(false);
  });

  it("ASSIGNEE_INACTIVE → 422 no campo assignee_id", async () => {
    rpcMock.mockResolvedValue(dbError("ASSIGNEE_INACTIVE"));

    const response = await POST(post({ assignee_id: ASSIGNEE_ID, version: 2 }), params);
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json).toStrictEqual({
      ok: false,
      code: "assignee_inactive",
      message: "Responsável inativo ou inexistente.",
      errors: { assignee_id: ["Responsável inativo ou inexistente."] },
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("TICKET_TERMINAL → 409", async () => {
    rpcMock.mockResolvedValue(dbError("TICKET_TERMINAL"));

    const response = await POST(post({ assignee_id: ASSIGNEE_ID, version: 7 }), params);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("ticket_terminal");
  });

  it("VERSION_CONFLICT → 409 com current_version", async () => {
    rpcMock.mockResolvedValue(dbError("VERSION_CONFLICT", { details: "3" }));

    const response = await POST(post({ assignee_id: ASSIGNEE_ID, version: 2 }), params);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toMatchObject({ ok: false, code: "version_conflict", current_version: 3 });
  });

  it("TICKET_NOT_FOUND → 404", async () => {
    rpcMock.mockResolvedValue(dbError("TICKET_NOT_FOUND"));

    const response = await POST(post({ assignee_id: ASSIGNEE_ID, version: 2 }), params);

    expect(response.status).toBe(404);
  });

  it("FORBIDDEN (ator desativado entre o guard e a RPC) → 403", async () => {
    rpcMock.mockResolvedValue(dbError("FORBIDDEN", { details: "Usuário inativo ou inexistente." }));

    const response = await POST(post({ assignee_id: ASSIGNEE_ID, version: 2 }), params);

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
  });

  it("erro do banco sem TAG → 500 logado, sem repassar a mensagem do banco", async () => {
    rpcMock.mockResolvedValue(dbError("could not serialize access", { code: "40001" }));

    const response = await POST(post({ assignee_id: ASSIGNEE_ID, version: 2 }), params);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("serialize");
    expect(consoleError).toHaveBeenCalledWith(
      "[POST /api/tickets/[id]/assign]",
      "internal",
      "Não foi possível concluir a operação."
    );
  });
});

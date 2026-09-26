import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TicketSummary } from "@/features/tickets/types";

const { sessionMock, adminEnvMock, adminClientMock, rpcMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  adminEnvMock: vi.fn(),
  adminClientMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: sessionMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: adminEnvMock,
  createSupabaseAdminClient: adminClientMock,
}));

import { PATCH } from "@/app/api/tickets/[id]/route";

// Ids fictícios. O jsonb segue o formato conferido no banco local.
const VIEWER_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";
const CUSTOMER_ID = "99999999-9999-4999-8999-999999999999";

const params = { params: Promise.resolve({ id: TICKET_ID }) };

function summary(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: TICKET_ID,
    number: 1024,
    title: "Erro ao emitir relatório",
    status: "em_atendimento",
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
    first_responded_at: null,
    sla_paused_at: null,
    resolved_at: null,
    closed_at: null,
    updated_at: "2026-09-26T03:03:13.996092+00:00",
    ...overrides,
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

function patch(body: unknown, id = TICKET_ID) {
  return PATCH(
    new Request(`http://x/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    id === TICKET_ID ? params : { params: Promise.resolve({ id }) }
  );
}

// O que a RPC recebe de fato: o supabase-js serializa os args em JSON.
function sentArgs(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(rpcMock.mock.calls[0][1]));
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ viewer: { id: VIEWER_ID, role: "member" } });
  adminEnvMock.mockReturnValue(true);
  adminClientMock.mockReturnValue({ rpc: rpcMock });
  rpcMock.mockResolvedValue({ data: { ticket: summary(), changed: true }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("PATCH /api/tickets/[id]", () => {
  it("recusa sem usuário ativo antes de acessar o banco", async () => {
    sessionMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await patch({ version: 3, title: "Novo título" });

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("id fora de UUID → 400 sem chamar a RPC", async () => {
    const response = await patch({ version: 3, title: "Novo título" }, "1024");

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Ticket inválido.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sem o Supabase admin configurado → 500 sem chamar a RPC", async () => {
    adminEnvMock.mockReturnValue(false);

    const response = await patch({ version: 3, title: "Novo título" });

    expect(response.status).toBe(500);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("JSON inválido → 400", async () => {
    const response = await patch("{");

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("JSON inválido.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("só a versão → 400 \"Nada para atualizar.\"", async () => {
    const response = await patch({ version: 3 });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Nada para atualizar.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("status no corpo → 400 apontando a chave (tem rota própria)", async () => {
    const response = await patch({ version: 3, status: "fechado" });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe(
      "Campo que não pode ser alterado por aqui: status."
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sem versão ou título curto → 400 nos campos", async () => {
    const response = await patch({ title: "ab" });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.message).toBe("Revise os campos destacados.");
    expect(json.errors.version).toEqual(["Versão inválida."]);
    expect(json.errors.title).toEqual(["Use ao menos 3 caracteres."]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("manda só os campos presentes, com o ator da sessão; null tira o valor", async () => {
    const response = await patch({
      version: 3,
      title: "  Novo título  ",
      product_id: PRODUCT_ID,
      category_id: null,
      customer_id: "",
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(rpcMock.mock.calls[0][0]).toBe("ticket_update");
    expect(sentArgs()).toStrictEqual({
      p_actor_user_id: VIEWER_ID,
      p_ticket_id: TICKET_ID,
      p_expected_version: 3,
      p_patch: {
        title: "Novo título",
        product_id: PRODUCT_ID,
        category_id: null,
        customer_id: null,
      },
    });
    expect(json).toStrictEqual({ ok: true, ticket: summary(), changed: true });
  });

  it("campo ausente não vira null", async () => {
    await patch({ version: 3, priority: "critica" });

    expect(sentArgs().p_patch).toStrictEqual({ priority: "critica" });
  });

  it("o mesmo valor de novo → 200 com changed:false", async () => {
    rpcMock.mockResolvedValue({ data: { ticket: summary(), changed: false }, error: null });

    const response = await patch({ version: 3, title: "Erro ao emitir relatório" });

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ ok: true, ticket: summary(), changed: false });
  });

  it("versão velha → 409 version_conflict com current_version", async () => {
    rpcMock.mockResolvedValue(dbError("VERSION_CONFLICT", { details: "5" }));

    const response = await patch({ version: 3, title: "Novo título" });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toStrictEqual({
      ok: false,
      code: "version_conflict",
      message: "O ticket mudou em outro lugar. Recarregue para ver a versão atual.",
      current_version: 5,
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("ticket inexistente → 404 not_found", async () => {
    rpcMock.mockResolvedValue(dbError("TICKET_NOT_FOUND"));

    const response = await patch({ version: 3, title: "Novo título" });

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
  });

  it("ticket fechado → 409 ticket_terminal", async () => {
    rpcMock.mockResolvedValue(dbError("TICKET_TERMINAL"));

    const response = await patch({ version: 3, title: "Novo título" });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("ticket_terminal");
  });

  it("empresa arquivada → 422 no campo customer_id", async () => {
    rpcMock.mockResolvedValue(dbError("CUSTOMER_ARCHIVED"));

    const response = await patch({ version: 3, customer_id: CUSTOMER_ID });
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.code).toBe("customer_archived");
    expect(json.errors).toEqual({ customer_id: ["Empresa arquivada. Reative-a antes."] });
  });

  it("categoria de outra fila → 422 no campo category_id", async () => {
    rpcMock.mockResolvedValue(dbError("CATEGORY_PRODUCT_MISMATCH"));

    const response = await patch({ version: 3, category_id: PRODUCT_ID });

    expect(response.status).toBe(422);
    expect((await response.json()).errors).toEqual({
      category_id: ["A categoria é de outra fila."],
    });
  });

  it("erro inesperado do banco → 500 logado, sem o texto do banco", async () => {
    rpcMock.mockResolvedValue(
      dbError("permission denied for function ticket_update", { code: "42501" })
    );

    const response = await patch({ version: 3, title: "Novo título" });
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toEqual({
      ok: false,
      code: "internal",
      message: "Não foi possível concluir a operação.",
    });
    expect(JSON.stringify(json)).not.toContain("permission denied");
    expect(console.error).toHaveBeenCalledWith(
      "[PATCH /api/tickets/[id]]",
      "internal",
      "Não foi possível concluir a operação."
    );
  });

  it("retorno da RPC fora do formato → 500", async () => {
    rpcMock.mockResolvedValue({ data: { ticket: summary(), changed: "sim" }, error: null });

    const response = await patch({ version: 3, title: "Novo título" });

    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("internal");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionMock, adminClientMock, fromMock, selectMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  adminClientMock: vi.fn(),
  fromMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: sessionMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: adminClientMock,
}));

import { GET } from "@/app/api/chat/conversations/[id]/contact/route";

const CONVERSATION_ID = "5d0c7e2a-9b3f-4a61-8e2d-1f4c6b8a9e07";
const params = (id = CONVERSATION_ID) => ({ params: Promise.resolve({ id }) });
const request = () => new Request(`http://x/api/chat/conversations/${CONVERSATION_ID}/contact`);

let result: { data: unknown; error: { code: string; message: string } | null };
const eqMock = vi.fn();

// O mock devolve colunas que a rota NÃO pediu (valor do contrato, search_name,
// telefone normalizado): a resposta precisa deixá-las de fora.
const customerRow = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  legal_name: "Padaria S. João Ltda",
  trade_name: "Padaria São João",
  cnpj: "12ABC34501DE35",
  contract_status: "suspenso",
  archived_at: null,
  search_name: "padaria sao joao 12abc34501de35",
  monthly_amount: 999,
  created_by_user_id: "user-9",
  ...overrides,
});

const contactRow = (customer: unknown) => ({
  id: "p1",
  email: "maria@exemplo.com",
  notes: "Prefere áudio.",
  created_at: "2026-09-20T12:00:00Z",
  customer,
  phone: "5527999990000",
  normalized_phone: "27999990000",
  search_name: "maria",
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ viewer: { id: "user-1", role: "member" } });
  result = { data: { contact: contactRow(customerRow()) }, error: null };
  eqMock.mockReturnValue({ maybeSingle: vi.fn(async () => result) });
  selectMock.mockReturnValue({ eq: eqMock });
  fromMock.mockReturnValue({ select: selectMock });
  adminClientMock.mockReturnValue({ from: fromMock });
});

describe("GET /api/chat/conversations/[id]/contact", () => {
  it("recusa sem usuário ativo antes de acessar o banco", async () => {
    sessionMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await GET(request(), params());

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("responde 400 para id fora de UUID, sem acessar o banco", async () => {
    const response = await GET(request(), params("conversation-1"));

    expect(response.status).toBe(400);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("responde exatamente as chaves de contact e customer, sem colunas extras", async () => {
    const response = await GET(request(), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fromMock).toHaveBeenCalledWith("chat_conversations");
    expect(eqMock).toHaveBeenCalledWith("id", CONVERSATION_ID);
    expect(Object.keys(body).sort()).toEqual(["contact", "customer"]);
    expect(Object.keys(body.contact).sort()).toEqual(["created_at", "email", "id", "notes"]);
    expect(Object.keys(body.customer).sort()).toEqual([
      "archived_at",
      "cnpj",
      "contract_status",
      "id",
      "legal_name",
      "trade_name",
    ]);
    expect(body).toEqual({
      contact: {
        id: "p1",
        email: "maria@exemplo.com",
        notes: "Prefere áudio.",
        created_at: "2026-09-20T12:00:00Z",
      },
      customer: {
        id: "c1",
        legal_name: "Padaria S. João Ltda",
        trade_name: "Padaria São João",
        cnpj: "12ABC34501DE35",
        contract_status: "suspenso",
        archived_at: null,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/monthly_amount|999|search_name|normalized_phone/);
  });

  it("o select tem colunas explícitas e não toca support_contracts", async () => {
    await GET(request(), params());

    const [columns] = selectMock.mock.calls[0] as [string];
    expect(columns).not.toMatch(/\*|support_contracts|monthly_amount|billing_day/);
    expect(columns).toContain(
      "customer:customers(id, legal_name, trade_name, cnpj, contract_status, archived_at)"
    );
  });

  it("contato sem empresa devolve customer null", async () => {
    result = { data: { contact: contactRow(null) }, error: null };

    const body = await (await GET(request(), params())).json();

    expect(body.contact).toMatchObject({ id: "p1" });
    expect(body.customer).toBeNull();
  });

  it("selo que o app não conhece vira null", async () => {
    result = {
      data: { contact: contactRow(customerRow({ contract_status: "cancelado" })) },
      error: null,
    };

    const body = await (await GET(request(), params())).json();

    expect(body.customer.contract_status).toBeNull();
  });

  it("conversa inexistente devolve os dois null com 200", async () => {
    result = { data: null, error: null };

    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ contact: null, customer: null });
  });

  it("erro de banco responde 500, não um falso 'sem empresa'", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    result = { data: null, error: { code: "42501", message: "permission denied for table customers" } };

    const response = await GET(request(), params());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(JSON.stringify(body)).not.toContain("permission denied");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("exceção também responde 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fromMock.mockImplementation(() => {
      throw new Error("boom");
    });

    const response = await GET(request(), params());

    expect(response.status).toBe(500);
    errorSpy.mockRestore();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

// authorizeIntegration é a fronteira de autenticação da API de Integração — a
// mesma lógica já é coberta por verify-webhook.test.ts, então aqui mockamos só
// essa função (mantendo `ok`/`fail` reais) e liberamos o acesso por padrão.
const { authorizeIntegrationMock } = vi.hoisted(() => ({
  authorizeIntegrationMock: vi.fn(),
}));

vi.mock("@/features/integrations/lib/authorize-integration", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/integrations/lib/authorize-integration")>();
  return { ...actual, authorizeIntegration: authorizeIntegrationMock };
});

import { GET, POST } from "@/app/api/integracao/deals/route";

type Row = Record<string, unknown>;
type Result<T = Row> = { data: T | null; error: { message: string } | null };

// Fake mínimo do client Supabase que atende as chamadas das rotas GET/POST:
//   lead_phone_identities.select().eq().maybeSingle() (findLeadByPhone)
//   board_columns.select().eq().maybeSingle()        (validação de stage)
//   deals.select().order().limit()[.eq()...]         (listagem, thenable)
//   deals.insert()/upsert().select().single()        (criação, via createDealFromWebhook)
function makeSupabase(opts: {
  leadRow?: Row | null;
  columnRow?: Row | null;
  listResult?: Result<Row[]>;
  insertResult?: Result;
}) {
  const identitiesMaybeSingle = vi.fn(async () => ({
    data: opts.leadRow ? { lead: opts.leadRow } : null,
    error: null,
  }));
  const identitiesEq = vi.fn(() => ({ maybeSingle: identitiesMaybeSingle }));
  const identitiesSelect = vi.fn(() => ({ eq: identitiesEq }));

  const columnsMaybeSingle = vi.fn(async () => ({ data: opts.columnRow ?? null, error: null }));
  const columnsEq = vi.fn(() => ({ maybeSingle: columnsMaybeSingle }));
  const columnsSelect = vi.fn(() => ({ eq: columnsEq }));

  // Builder "thenable" — imita o PostgrestFilterBuilder real do supabase-js,
  // que só resolve quando você dá `await` nele (após encadear select/order/etc.).
  const listResult: Result<Row[]> = opts.listResult ?? { data: [], error: null };
  const listBuilder: {
    select: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    then: (resolve: (v: Result<Row[]>) => void) => void;
  } = {
    select: vi.fn(() => listBuilder),
    order: vi.fn(() => listBuilder),
    limit: vi.fn(() => listBuilder),
    eq: vi.fn(() => listBuilder),
    is: vi.fn(() => listBuilder),
    then: (resolve) => resolve(listResult),
  };

  const insertResult: Result = opts.insertResult ?? { data: null, error: null };
  const single = vi.fn(async () => insertResult);
  const selectAfterWrite = vi.fn(() => ({ single }));
  const insert = vi.fn<(row: Row) => { select: typeof selectAfterWrite }>(() => ({
    select: selectAfterWrite,
  }));
  const upsert = vi.fn<
    (row: Row, options: Record<string, unknown>) => { select: typeof selectAfterWrite }
  >(() => ({ select: selectAfterWrite }));

  const from = vi.fn((table: string) => {
    if (table === "lead_phone_identities") return { select: identitiesSelect };
    if (table === "board_columns") return { select: columnsSelect };
    if (table === "deals") return { select: listBuilder.select, insert, upsert };
    throw new Error(`tabela inesperada: ${table}`);
  });

  return { from, identitiesEq, columnsEq, listBuilder, insert, upsert };
}

function authorize(supabase: unknown) {
  authorizeIntegrationMock.mockResolvedValue({ supabase });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/integracao/deals", () => {
  it("lista os deals sem aplicar nenhum filtro quando não há query params", async () => {
    const { from, listBuilder } = makeSupabase({
      listResult: { data: [{ id: "d1" }, { id: "d2" }], error: null },
    });
    authorize({ from });

    const res = await GET(new Request("http://x/api/integracao/deals"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, deals: [{ id: "d1" }, { id: "d2" }] });
    expect(listBuilder.eq).not.toHaveBeenCalled();
  });

  it("filtra por stage quando ?stage é informado", async () => {
    const { from, listBuilder } = makeSupabase({
      listResult: { data: [{ id: "d1", stage: "novo" }], error: null },
    });
    authorize({ from });

    const res = await GET(new Request("http://x/api/integracao/deals?stage=novo"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deals).toEqual([{ id: "d1", stage: "novo" }]);
    expect(listBuilder.eq).toHaveBeenCalledWith("stage", "novo");
  });

  it("retorna deals vazio quando ?phone não corresponde a nenhum lead cadastrado", async () => {
    const { from, listBuilder } = makeSupabase({ leadRow: null });
    authorize({ from });

    const res = await GET(new Request("http://x/api/integracao/deals?phone=27999990000"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, deals: [] });
    // Sem lead, a rota nem chega a montar o filtro lead_id.
    expect(listBuilder.eq).not.toHaveBeenCalled();
  });

  it("resolve o lead pelo telefone e filtra os deals por lead_id quando ?phone encontra um lead", async () => {
    const { from, identitiesEq, listBuilder } = makeSupabase({
      leadRow: { id: "lead-1" },
      listResult: { data: [{ id: "d1", lead_id: "lead-1" }], error: null },
    });
    authorize({ from });

    const res = await GET(new Request("http://x/api/integracao/deals?phone=(27) 99999-0000"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(identitiesEq).toHaveBeenCalledWith("normalized_phone", "27999990000");
    expect(listBuilder.eq).toHaveBeenCalledWith("lead_id", "lead-1");
    expect(body.deals).toEqual([{ id: "d1", lead_id: "lead-1" }]);
  });
});

describe("POST /api/integracao/deals", () => {
  function postRequest(body: unknown) {
    return new Request("http://x/api/integracao/deals", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("retorna 400 invalid_json quando o corpo não é um JSON válido", async () => {
    authorize({ from: vi.fn() });

    const res = await POST(
      new Request("http://x/api/integracao/deals", { method: "POST", body: "{invalido" })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "invalid_json" });
  });

  it("retorna 422 invalid_payload quando o telefone não é informado", async () => {
    authorize({ from: vi.fn() });

    const res = await POST(postRequest({ tipo_ensaio: "gestante" }));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid_payload");
    expect(body.fields).toHaveProperty("phone");
  });

  it("retorna 404 lead_not_found quando o telefone não corresponde a nenhum lead", async () => {
    const { from } = makeSupabase({ leadRow: null });
    authorize({ from });

    const res = await POST(postRequest({ phone: "27999990000" }));

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: "lead_not_found" });
  });

  it("retorna 400 stage_invalido quando a etapa informada não existe em board_columns", async () => {
    const { from } = makeSupabase({ leadRow: { id: "lead-1" }, columnRow: null });
    authorize({ from });

    const res = await POST(postRequest({ phone: "27999990000", stage: "etapa-fantasma" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "stage_invalido" });
  });

  it("cria o deal com a etapa default 'novo' e source 'agent' quando o payload é válido", async () => {
    const { from, columnsEq, insert, upsert } = makeSupabase({
      leadRow: { id: "lead-1" },
      columnRow: { key: "novo" },
      insertResult: { data: { id: "deal-1", lead_id: "lead-1", stage: "novo" }, error: null },
    });
    authorize({ from });

    const res = await POST(postRequest({ phone: "27999990000", tipo_ensaio: "gestante" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      deal: { id: "deal-1", lead_id: "lead-1", stage: "novo" },
    });
    expect(columnsEq).toHaveBeenCalledWith("key", "novo");
    expect(upsert).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({
      lead_id: "lead-1",
      stage: "novo",
      source: "agent",
    });
  });

  it("retorna 500 com a mensagem de erro quando a criação do deal falha no Supabase", async () => {
    // O client real do Supabase rejeita com um PostgrestError (extends Error);
    // por isso o fake também precisa lançar uma instância de Error de verdade
    // para exercitar o mesmo caminho (`e instanceof Error`) do catch da rota.
    const { from } = makeSupabase({
      leadRow: { id: "lead-1" },
      columnRow: { key: "novo" },
      insertResult: { data: null, error: new Error("boom") },
    });
    authorize({ from });

    const res = await POST(postRequest({ phone: "27999990000" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, error: "boom" });
  });
});

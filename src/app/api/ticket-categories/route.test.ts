import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { adminMock, hasAdminEnvMock, adminClientMock, fromMock } = vi.hoisted(() => ({
  adminMock: vi.fn(),
  hasAdminEnvMock: vi.fn(),
  adminClientMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardAdmin: adminMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: hasAdminEnvMock,
  createSupabaseAdminClient: adminClientMock,
}));

import { POST } from "@/app/api/ticket-categories/route";

// Ids fictícios. Mensagens no formato do banco local (TAG sozinha em P0001;
// constraint entre aspas em 23505/23503).
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "8f9bc40b-8b1c-4b17-bbb8-fb6d00fc9c07";
const PARENT_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "33333333-3333-4333-8333-333333333333";

const CATEGORY = {
  id: CATEGORY_ID,
  name: "Boletos",
  product_id: PRODUCT_ID,
  parent_id: PARENT_ID,
  archived_at: null,
};

type Call = [method: string, ...args: unknown[]];

// Builder encadeável que grava cada chamada; single e o `await` resolvem com
// `result`. O de api/customers/[id]/route.test.ts, com os métodos daqui.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "insert", "eq", "is", "ilike", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.single = () => {
    calls.push(["single"]);
    return Promise.resolve(result);
  };
  return { builder, calls };
}

function queueQueries(...results: unknown[]) {
  const queries = results.map(fakeQuery);
  for (const query of queries) fromMock.mockReturnValueOnce(query.builder);
  return queries.map((query) => query.calls);
}

const callsOf = (calls: Call[] | undefined, method: string) =>
  (calls ?? []).filter(([name]) => name === method).map(([, ...args]) => args);

function post(body: unknown) {
  return POST(
    new Request("http://x/api/ticket-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

const tagError = (message: string) => ({
  data: null,
  error: { code: "P0001", message, details: "", hint: "" },
});

const DUPLICATE = {
  data: null,
  error: {
    code: "23505",
    message: 'duplicate key value violates unique constraint "ticket_categories_name_active_uidx"',
    details: "Key (product_id, parent_id, lower(btrim(name)))=(…) already exists.",
  },
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  adminMock.mockResolvedValue({ viewer: { id: ADMIN_ID, role: "admin", is_active: true } });
  hasAdminEnvMock.mockReturnValue(true);
  adminClientMock.mockReturnValue({ from: fromMock });
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("POST /api/ticket-categories", () => {
  it("member → 403 sem criar o client", async () => {
    adminMock.mockResolvedValue({
      error: Response.json(
        { ok: false, message: "Apenas administradores podem executar esta ação." },
        { status: 403 }
      ),
    });

    expect((await post({ name: "Boletos" })).status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("sem Supabase admin → 500 sem criar o client", async () => {
    hasAdminEnvMock.mockReturnValue(false);

    expect((await post({ name: "Boletos" })).status).toBe(500);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("JSON inválido → 400", async () => {
    const response = await post("{");

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("JSON inválido.");
  });

  it("sem nome, ou com chave desconhecida → 400 sem gravar", async () => {
    const missing = await post({});
    expect(missing.status).toBe(400);
    expect((await missing.json()).errors).toEqual({ name: ["Informe o nome da categoria."] });

    const unknown = await post({ name: "Boletos", archived_at: null });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).message).toBe(
      "Campo que não pode ser alterado por aqui: archived_at."
    );
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("categoria geral: fila e mãe nulas, 201 com o item", async () => {
    const general = { ...CATEGORY, name: "Financeiro", product_id: null, parent_id: null };
    const [insert] = queueQueries({ data: general, error: null });

    const response = await post({ name: " Financeiro " });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, item: general });
    expect(fromMock).toHaveBeenCalledWith("ticket_categories");
    expect(callsOf(insert, "insert")).toEqual([
      [{ name: "Financeiro", product_id: null, parent_id: null }],
    ]);
    expect(callsOf(insert, "select")).toEqual([["id, name, product_id, parent_id, archived_at"]]);
  });

  it("subcategoria da fila: repassa a fila e a mãe", async () => {
    const [insert] = queueQueries({ data: CATEGORY, error: null });

    const response = await post({ name: "Boletos", product_id: PRODUCT_ID, parent_id: PARENT_ID });

    expect(response.status).toBe(201);
    expect(callsOf(insert, "insert")).toEqual([
      [{ name: "Boletos", product_id: PRODUCT_ID, parent_id: PARENT_ID }],
    ]);
  });

  it.each([
    ["CATEGORY_TOO_DEEP", "category_too_deep", "parent_id", "Categoria tem no máximo dois níveis."],
    [
      "CATEGORY_PRODUCT_MISMATCH",
      "category_product_mismatch",
      "parent_id",
      "A subcategoria fica na mesma fila da categoria mãe.",
    ],
    [
      "CATEGORY_ARCHIVED",
      "category_archived",
      "parent_id",
      "Categoria mãe arquivada. Reative-a antes.",
    ],
    ["PRODUCT_ARCHIVED", "product_archived", "product_id", "Fila arquivada. Reative-a antes."],
  ])("%s do trigger → 422 %s no campo %s", async (tag, code, field, message) => {
    queueQueries(tagError(tag));

    const response = await post({ name: "Boletos", product_id: PRODUCT_ID, parent_id: PARENT_ID });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      code,
      message,
      errors: { [field]: [message] },
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("mãe inexistente (FK) → 422 no campo parent_id", async () => {
    queueQueries({
      data: null,
      error: {
        code: "23503",
        message:
          'insert or update on table "ticket_categories" violates foreign key constraint "ticket_categories_parent_id_fkey"',
      },
    });

    const response = await post({ name: "Boletos", parent_id: PARENT_ID });

    expect(response.status).toBe(422);
    expect((await response.json()).errors).toEqual({ parent_id: ["Categoria mãe não encontrada."] });
  });

  it("nome repetido no mesmo lugar → 409 no campo, com a categoria que já existe", async () => {
    const [, lookup] = queueQueries(DUPLICATE, { data: [CATEGORY], error: null });

    const response = await post({ name: "boletos", product_id: PRODUCT_ID, parent_id: PARENT_ID });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toEqual({
      ok: false,
      code: "duplicate",
      message: "Já existe uma categoria com este nome.",
      errors: { name: ["Já existe uma categoria com este nome."] },
      item: CATEGORY,
    });
    expect(callsOf(lookup, "ilike")).toEqual([["name", "boletos"]]);
    expect(callsOf(lookup, "eq")).toEqual([
      ["product_id", PRODUCT_ID],
      ["parent_id", PARENT_ID],
    ]);
    expect(callsOf(lookup, "is")).toEqual([["archived_at", null]]);
  });

  it("409 da categoria geral procura com fila e mãe nulas; releitura que falha tira só o item", async () => {
    const [, lookup] = queueQueries(DUPLICATE, {
      data: null,
      error: { code: "57014", message: "timeout" },
    });

    const response = await post({ name: "Financeiro" });

    expect(response.status).toBe(409);
    expect((await response.json()).item).toBeUndefined();
    expect(callsOf(lookup, "is")).toEqual([
      ["archived_at", null],
      ["product_id", null],
      ["parent_id", null],
    ]);
  });

  it("erro inesperado → 500 logado, sem repassar a mensagem do banco", async () => {
    queueQueries({
      data: null,
      error: { code: "42501", message: "permission denied for table ticket_categories" },
    });

    const response = await post({ name: "Boletos" });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("permission");
    expect(consoleError).toHaveBeenCalledWith(
      "[POST /api/ticket-categories]",
      "42501",
      "permission denied for table ticket_categories"
    );
  });
});

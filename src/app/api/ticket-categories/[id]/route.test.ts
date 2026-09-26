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

import { PATCH } from "@/app/api/ticket-categories/[id]/route";

// Ids fictícios. Mensagens no formato do banco local.
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "8f9bc40b-8b1c-4b17-bbb8-fb6d00fc9c07";
const PARENT_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "33333333-3333-4333-8333-333333333333";
const SIBLING_ID = "44444444-4444-4444-8444-444444444444";
const params = { params: Promise.resolve({ id: CATEGORY_ID }) };

const CATEGORY = {
  id: CATEGORY_ID,
  name: "Boletos",
  product_id: PRODUCT_ID,
  parent_id: PARENT_ID,
  archived_at: null,
};
const ARCHIVED = { ...CATEGORY, archived_at: "2026-09-20T12:00:00+00:00" };

type Call = [method: string, ...args: unknown[]];

// Builder encadeável que grava cada chamada; maybeSingle e o `await` resolvem
// com `result`. O de api/customers/[id]/route.test.ts, com os métodos daqui.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "update", "eq", "neq", "is", "ilike", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = () => {
    calls.push(["maybeSingle"]);
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

function patch(body: unknown, context = params) {
  return PATCH(
    new Request(`http://x/api/ticket-categories/${CATEGORY_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    context
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

describe("PATCH /api/ticket-categories/[id]", () => {
  it("member → 403 sem criar o client", async () => {
    adminMock.mockResolvedValue({
      error: Response.json(
        { ok: false, message: "Apenas administradores podem executar esta ação." },
        { status: 403 }
      ),
    });

    expect((await patch({ name: "Cobrança" })).status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("id fora de UUID → 400 sem criar o client", async () => {
    const response = await patch({ name: "Cobrança" }, { params: Promise.resolve({ id: "x" }) });

    expect(response.status).toBe(400);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("sem Supabase admin → 500 sem criar o client", async () => {
    hasAdminEnvMock.mockReturnValue(false);

    expect((await patch({ name: "Cobrança" })).status).toBe(500);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("PATCH vazio → 400; mudar a fila ou a mãe → 400 dizendo o campo", async () => {
    const empty = await patch({});
    expect(empty.status).toBe(400);
    expect((await empty.json()).message).toBe("Nada para atualizar.");

    const moved = await patch({ parent_id: null });
    expect(moved.status).toBe(400);
    expect((await moved.json()).message).toBe(
      "Campo que não pode ser alterado por aqui: parent_id."
    );
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("renomeia: grava só o nome e devolve o item", async () => {
    const renamed = { ...CATEGORY, name: "Cobrança" };
    const [read, update] = queueQueries(
      { data: CATEGORY, error: null },
      { data: renamed, error: null }
    );

    const response = await patch({ name: " Cobrança " });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, item: renamed });
    expect(callsOf(read, "eq")).toEqual([["id", CATEGORY_ID]]);
    expect(callsOf(update, "update")).toEqual([[{ name: "Cobrança" }]]);
    expect(callsOf(update, "eq")).toEqual([["id", CATEGORY_ID]]);
  });

  it("arquiva com a data do servidor; reativa com null", async () => {
    const [, archive] = queueQueries(
      { data: CATEGORY, error: null },
      { data: ARCHIVED, error: null }
    );
    await patch({ archived: true });
    const [[values]] = callsOf(archive, "update") as [[{ archived_at: string }]];
    expect(Number.isNaN(Date.parse(values.archived_at))).toBe(false);

    const [, restore] = queueQueries(
      { data: ARCHIVED, error: null },
      { data: CATEGORY, error: null }
    );
    expect((await patch({ archived: false })).status).toBe(200);
    expect(callsOf(restore, "update")).toEqual([[{ archived_at: null }]]);
  });

  it("arquivar a já arquivada não grava: a data do 1º arquivamento fica", async () => {
    queueQueries({ data: ARCHIVED, error: null });

    const response = await patch({ archived: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, item: ARCHIVED });
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("mãe com filhas ativas → 422 no campo archived", async () => {
    queueQueries({ data: CATEGORY, error: null }, tagError("CATEGORY_HAS_ACTIVE_CHILDREN"));

    const response = await patch({ archived: true });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      code: "category_has_active_children",
      message: "Arquive as subcategorias antes da categoria.",
      errors: { archived: ["Arquive as subcategorias antes da categoria."] },
    });
  });

  it("reativar a filha de uma mãe arquivada → 422 pedindo a mãe antes", async () => {
    queueQueries({ data: ARCHIVED, error: null }, tagError("CATEGORY_ARCHIVED"));

    const response = await patch({ archived: false });
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.code).toBe("category_archived");
    expect(json.errors).toEqual({ archived: ["Categoria mãe arquivada. Reative-a antes."] });
  });

  it("categoria inexistente → 404 sem gravar", async () => {
    queueQueries({ data: null, error: null });

    const response = await patch({ name: "Cobrança" });

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("nome repetido no mesmo lugar → 409 com a OUTRA categoria ativa", async () => {
    const sibling = { ...CATEGORY, id: SIBLING_ID, name: "Cobrança" };
    const [, , lookup] = queueQueries(
      { data: CATEGORY, error: null },
      DUPLICATE,
      { data: [sibling], error: null }
    );

    const response = await patch({ name: "cobrança" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      code: "duplicate",
      message: "Já existe uma categoria com este nome.",
      errors: { name: ["Já existe uma categoria com este nome."] },
      item: sibling,
    });
    expect(callsOf(lookup, "ilike")).toEqual([["name", "cobrança"]]);
    expect(callsOf(lookup, "neq")).toEqual([["id", CATEGORY_ID]]);
    expect(callsOf(lookup, "eq")).toEqual([
      ["product_id", PRODUCT_ID],
      ["parent_id", PARENT_ID],
    ]);
  });

  it("nome repetido ao reativar a geral → procura pelo nome gravado, com fila e mãe nulas", async () => {
    const general = { ...ARCHIVED, product_id: null, parent_id: null };
    const [, , lookup] = queueQueries(
      { data: general, error: null },
      DUPLICATE,
      { data: [], error: null }
    );

    const response = await patch({ archived: false });

    expect(response.status).toBe(409);
    expect((await response.json()).item).toBeUndefined();
    expect(callsOf(lookup, "ilike")).toEqual([["name", "Boletos"]]);
    expect(callsOf(lookup, "is")).toEqual([
      ["archived_at", null],
      ["product_id", null],
      ["parent_id", null],
    ]);
  });

  it("falha ao ler → 500 logado, sem repassar a mensagem do banco", async () => {
    queueQueries({ data: null, error: { code: "57014", message: "canceling statement" } });

    const response = await patch({ name: "Cobrança" });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("canceling");
    expect(consoleError).toHaveBeenCalledWith(
      "[PATCH /api/ticket-categories/[id]]",
      "57014",
      "canceling statement"
    );
  });
});

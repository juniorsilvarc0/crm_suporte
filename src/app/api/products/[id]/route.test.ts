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

import { PATCH } from "@/app/api/products/[id]/route";

// Ids fictícios.
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "8f9bc40b-8b1c-4b17-bbb8-fb6d00fc9c07";
const OTHER_ID = "2c1e6a52-4f0b-4f7e-9d59-0b8f7d1c3a11";
const params = { params: Promise.resolve({ id: PRODUCT_ID }) };

const PRODUCT = {
  id: PRODUCT_ID,
  name: "ERP Varejo",
  niche: null,
  color: "slate",
  archived_at: null,
};
const ARCHIVED = { ...PRODUCT, archived_at: "2026-09-20T12:00:00+00:00" };

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
    new Request(`http://x/api/products/${PRODUCT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    context
  );
}

const DUPLICATE = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "products_name_active_uidx"',
  details: "Key (lower(btrim(name)))=(erp atacado) already exists.",
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

describe("PATCH /api/products/[id]", () => {
  it("member → 403 sem criar o client", async () => {
    adminMock.mockResolvedValue({
      error: Response.json(
        { ok: false, message: "Apenas administradores podem executar esta ação." },
        { status: 403 }
      ),
    });

    const response = await patch({ name: "ERP Atacado" });

    expect(response.status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("sem sessão → 401 sem criar o client", async () => {
    adminMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    expect((await patch({ name: "ERP Atacado" })).status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("id fora de UUID → 400 sem criar o client", async () => {
    const response = await patch({ name: "ERP Atacado" }, { params: Promise.resolve({ id: "1" }) });

    expect(response.status).toBe(400);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("sem Supabase admin → 500 sem criar o client", async () => {
    hasAdminEnvMock.mockReturnValue(false);

    expect((await patch({ name: "ERP Atacado" })).status).toBe(500);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("JSON inválido → 400", async () => {
    const response = await patch("{");

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("JSON inválido.");
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("PATCH vazio → 400 'Nada para atualizar.'", async () => {
    const response = await patch({});

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Nada para atualizar.");
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("archived_at no corpo → 400 dizendo o campo (a data é do servidor)", async () => {
    const response = await patch({ archived_at: null });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe(
      "Campo que não pode ser alterado por aqui: archived_at."
    );
  });

  it("cor fora da paleta → 400 no campo", async () => {
    const response = await patch({ color: "magenta" });

    expect(response.status).toBe(400);
    expect((await response.json()).errors).toEqual({ color: ["Cor inválida."] });
  });

  it("renomeia, recolore e tira o nicho: grava só as chaves enviadas", async () => {
    const updated = { ...PRODUCT, name: "ERP Atacado", color: "teal" };
    const [read, update] = queueQueries(
      { data: PRODUCT, error: null },
      { data: updated, error: null }
    );

    const response = await patch({ name: " ERP Atacado ", color: "teal", niche: "" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, item: updated });
    expect(fromMock).toHaveBeenCalledWith("products");
    expect(callsOf(read, "select")).toEqual([["id, name, niche, color, archived_at"]]);
    expect(callsOf(read, "eq")).toEqual([["id", PRODUCT_ID]]);
    expect(callsOf(update, "update")).toEqual([[{ name: "ERP Atacado", color: "teal", niche: null }]]);
    expect(callsOf(update, "eq")).toEqual([["id", PRODUCT_ID]]);
    expect(callsOf(update, "select")).toEqual([["id, name, niche, color, archived_at"]]);
  });

  it("arquiva a fila ativa com a data do servidor", async () => {
    const [, update] = queueQueries(
      { data: PRODUCT, error: null },
      { data: ARCHIVED, error: null }
    );

    const response = await patch({ archived: true });

    expect(response.status).toBe(200);
    const [[values]] = callsOf(update, "update") as [[{ archived_at: string }]];
    expect(Object.keys(values)).toEqual(["archived_at"]);
    expect(Number.isNaN(Date.parse(values.archived_at))).toBe(false);
  });

  it("reativa a arquivada (archived_at null)", async () => {
    const [, update] = queueQueries(
      { data: ARCHIVED, error: null },
      { data: PRODUCT, error: null }
    );

    const response = await patch({ archived: false });

    expect(response.status).toBe(200);
    expect(callsOf(update, "update")).toEqual([[{ archived_at: null }]]);
  });

  it("arquivar a já arquivada não grava: a data do 1º arquivamento fica", async () => {
    queueQueries({ data: ARCHIVED, error: null });

    const response = await patch({ archived: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, item: ARCHIVED });
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("renomear a arquivada grava só o nome, sem mexer na data", async () => {
    const [, update] = queueQueries(
      { data: ARCHIVED, error: null },
      { data: { ...ARCHIVED, name: "ERP Antigo" }, error: null }
    );

    await patch({ name: "ERP Antigo", archived: true });

    expect(callsOf(update, "update")).toEqual([[{ name: "ERP Antigo" }]]);
  });

  it("fila inexistente → 404 sem gravar", async () => {
    queueQueries({ data: null, error: null });

    const response = await patch({ name: "ERP Atacado" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      code: "not_found",
      message: "Fila não encontrada.",
    });
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("nome repetido ao renomear → 409 no campo, com a OUTRA fila ativa", async () => {
    const other = { ...PRODUCT, id: OTHER_ID, name: "ERP Atacado" };
    const [, , lookup] = queueQueries(
      { data: PRODUCT, error: null },
      { data: null, error: DUPLICATE },
      { data: [other], error: null }
    );

    const response = await patch({ name: "erp atacado" });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toEqual({
      ok: false,
      code: "duplicate",
      message: "Já existe uma fila com este nome.",
      errors: { name: ["Já existe uma fila com este nome."] },
      item: other,
    });
    expect(callsOf(lookup, "ilike")).toEqual([["name", "erp atacado"]]);
    expect(callsOf(lookup, "is")).toEqual([["archived_at", null]]);
    expect(callsOf(lookup, "neq")).toEqual([["id", PRODUCT_ID]]);
    expect(JSON.stringify(json)).not.toContain("btrim");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("nome repetido ao reativar → 409 procurando pelo nome gravado", async () => {
    const other = { ...PRODUCT, id: OTHER_ID };
    const [, , lookup] = queueQueries(
      { data: ARCHIVED, error: null },
      { data: null, error: DUPLICATE },
      { data: [other], error: null }
    );

    const response = await patch({ archived: false });

    expect(response.status).toBe(409);
    expect((await response.json()).item).toEqual(other);
    expect(callsOf(lookup, "ilike")).toEqual([["name", "ERP Varejo"]]);
  });

  it("409 escapa os curingas, não devolve homônimo aproximado e sobrevive à releitura que falha", async () => {
    const [, , lookup] = queueQueries(
      { data: PRODUCT, error: null },
      { data: null, error: DUPLICATE },
      { data: [{ ...PRODUCT, id: OTHER_ID, name: "ERP 10x" }], error: null }
    );

    const response = await patch({ name: "ERP 10%*" });

    expect(response.status).toBe(409);
    expect(callsOf(lookup, "ilike")).toEqual([["name", "ERP 10\\%_"]]);
    expect((await response.json()).item).toBeUndefined();

    queueQueries(
      { data: PRODUCT, error: null },
      { data: null, error: DUPLICATE },
      { data: null, error: { code: "57014", message: "timeout" } }
    );
    const failed = await patch({ name: "ERP Atacado" });

    expect(failed.status).toBe(409);
    expect((await failed.json()).item).toBeUndefined();
  });

  it("erro inesperado ao gravar → 500 logado, sem repassar a mensagem do banco", async () => {
    queueQueries(
      { data: PRODUCT, error: null },
      { data: null, error: { code: "42501", message: "permission denied for table products" } }
    );

    const response = await patch({ name: "ERP Atacado" });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("permission");
    expect(JSON.parse(text)).toEqual({
      ok: false,
      code: "internal",
      message: "Não foi possível concluir a operação.",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[PATCH /api/products/[id]]",
      "42501",
      "permission denied for table products"
    );
  });

  it("falha ao ler a fila → 500 logado, sem gravar", async () => {
    queueQueries({ data: null, error: { code: "57014", message: "canceling statement" } });

    const response = await patch({ name: "ERP Atacado" });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("canceling");
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });
});

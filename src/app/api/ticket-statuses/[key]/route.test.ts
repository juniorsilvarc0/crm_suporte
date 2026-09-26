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

import { PATCH } from "@/app/api/ticket-statuses/[key]/route";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const params = { params: Promise.resolve({ key: "novo" }) };

const NOVO = {
  key: "novo",
  label: "Novo chamado",
  color: "teal",
  position: 10,
  sla_mode: "running",
  is_terminal: false,
};
const EM_TRIAGEM = {
  key: "em_triagem",
  label: "Em triagem",
  color: "violet",
  position: 20,
  sla_mode: "running",
  is_terminal: false,
};

type Call = [method: string, ...args: unknown[]];

// Builder encadeável que grava cada chamada; maybeSingle e o `await` resolvem
// com `result`. O de api/customers/[id]/route.test.ts, com os métodos daqui.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "update", "eq", "neq"]) {
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
    new Request("http://x/api/ticket-statuses/novo", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    context
  );
}

const DUPLICATE = {
  data: null,
  error: {
    code: "23505",
    message: 'duplicate key value violates unique constraint "ticket_statuses_label_uidx"',
    details: "Key (lower(btrim(label)))=(em triagem) already exists.",
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

describe("PATCH /api/ticket-statuses/[key]", () => {
  it("member → 403 sem criar o client", async () => {
    adminMock.mockResolvedValue({
      error: Response.json(
        { ok: false, message: "Apenas administradores podem executar esta ação." },
        { status: 403 }
      ),
    });

    expect((await patch({ label: "Novo chamado" })).status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it.each(["arquivado", "constructor", "NOVO", "novo "])(
    "chave %j fora da allowlist → 400 sem criar o client",
    async (key) => {
      const response = await patch({ label: "Novo chamado" }, { params: Promise.resolve({ key }) });

      expect(response.status).toBe(400);
      expect((await response.json()).message).toBe("Status inválido.");
      expect(adminClientMock).not.toHaveBeenCalled();
    }
  );

  it("sem Supabase admin → 500 sem criar o client", async () => {
    hasAdminEnvMock.mockReturnValue(false);

    expect((await patch({ label: "Novo chamado" })).status).toBe(500);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("PATCH vazio → 400 'Nada para atualizar.'", async () => {
    const response = await patch({});

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Nada para atualizar.");
  });

  it.each([{ sla_mode: "paused" }, { is_terminal: true }, { position: 15 }])(
    "%o não é editável → 400 dizendo o campo, sem gravar",
    async (body) => {
      const response = await patch(body);

      expect(response.status).toBe(400);
      expect((await response.json()).message).toMatch(
        /^Campo que não pode ser alterado por aqui: /
      );
      expect(adminClientMock).not.toHaveBeenCalled();
    }
  );

  it("cor fora da paleta → 400 no campo", async () => {
    const response = await patch({ color: "magenta" });

    expect(response.status).toBe(400);
    expect((await response.json()).errors).toEqual({ color: ["Cor inválida."] });
  });

  it("grava rótulo aparado e cor na chave da URL e devolve o status", async () => {
    const [update] = queueQueries({ data: NOVO, error: null });

    const response = await patch({ label: "  Novo chamado ", color: "teal" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, item: NOVO });
    expect(fromMock).toHaveBeenCalledWith("ticket_statuses");
    expect(callsOf(update, "update")).toEqual([[{ label: "Novo chamado", color: "teal" }]]);
    expect(callsOf(update, "eq")).toEqual([["key", "novo"]]);
    expect(callsOf(update, "select")).toEqual([
      ["key, label, color, position, sla_mode, is_terminal"],
    ]);
  });

  it("rótulo repetido → 409 no campo, com o OUTRO status que já o usa", async () => {
    const [, lookup] = queueQueries(DUPLICATE, { data: [EM_TRIAGEM], error: null });

    const response = await patch({ label: "EM TRIAGEM" });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toEqual({
      ok: false,
      code: "duplicate",
      message: "Já existe um status com este rótulo.",
      errors: { label: ["Já existe um status com este rótulo."] },
      item: EM_TRIAGEM,
    });
    expect(callsOf(lookup, "neq")).toEqual([["key", "novo"]]);
    expect(JSON.stringify(json)).not.toContain("btrim");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("409 com releitura que falha ainda é 409, sem item", async () => {
    queueQueries(DUPLICATE, { data: null, error: { code: "57014", message: "timeout" } });

    const response = await patch({ label: "Em triagem" });

    expect(response.status).toBe(409);
    expect((await response.json()).item).toBeUndefined();
  });

  it("status sem linha no banco → 404", async () => {
    queueQueries({ data: null, error: null });

    const response = await patch({ color: "teal" });

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
  });

  it("erro inesperado → 500 logado, sem repassar a mensagem do banco", async () => {
    queueQueries({
      data: null,
      error: { code: "42501", message: "permission denied for table ticket_statuses" },
    });

    const response = await patch({ label: "Novo chamado" });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("permission");
    expect(consoleError).toHaveBeenCalledWith(
      "[PATCH /api/ticket-statuses/[key]]",
      "42501",
      "permission denied for table ticket_statuses"
    );
  });
});

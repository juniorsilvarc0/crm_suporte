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

import { PATCH } from "@/app/api/sla-policies/[priority]/route";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const params = { params: Promise.resolve({ priority: "alta" }) };

const POLICY = {
  priority: "alta",
  rank: 3,
  first_response_minutes: 45,
  resolution_minutes: 480,
  warn_pct: 75,
};

type Call = [method: string, ...args: unknown[]];

// Builder encadeável que grava cada chamada; maybeSingle resolve com `result`.
// O de api/customers/[id]/route.test.ts, com os métodos daqui.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "update", "eq"]) {
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
    new Request("http://x/api/sla-policies/alta", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    context
  );
}

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

describe("PATCH /api/sla-policies/[priority]", () => {
  it("member → 403 sem criar o client", async () => {
    adminMock.mockResolvedValue({
      error: Response.json(
        { ok: false, message: "Apenas administradores podem executar esta ação." },
        { status: 403 }
      ),
    });

    expect((await patch({ warn_pct: 75 })).status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it.each(["urgente", "constructor", "ALTA", ""])(
    "prioridade %j fora da allowlist → 400 sem criar o client",
    async (priority) => {
      const response = await patch({ warn_pct: 75 }, { params: Promise.resolve({ priority }) });

      expect(response.status).toBe(400);
      expect((await response.json()).message).toBe("Prioridade inválida.");
      expect(adminClientMock).not.toHaveBeenCalled();
    }
  );

  it("sem Supabase admin → 500 sem criar o client", async () => {
    hasAdminEnvMock.mockReturnValue(false);

    expect((await patch({ warn_pct: 75 })).status).toBe(500);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("JSON inválido → 400", async () => {
    const response = await patch("{");

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("JSON inválido.");
  });

  it("PATCH vazio → 400; rank no corpo → 400 dizendo o campo", async () => {
    const empty = await patch({});
    expect(empty.status).toBe(400);
    expect((await empty.json()).message).toBe("Nada para atualizar.");

    const rank = await patch({ rank: 1 });
    expect(rank.status).toBe(400);
    expect((await rank.json()).message).toBe("Campo que não pode ser alterado por aqui: rank.");
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("minutos fora dos limites → 400 no campo, sem gravar", async () => {
    const response = await patch({ first_response_minutes: 0, warn_pct: 100 });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors).toEqual({
      first_response_minutes: ["Use de 1 a 525.600 minutos."],
      warn_pct: ["Use de 1 a 99%."],
    });
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("1ª resposta maior que a solução, os dois no corpo → 400 sem gravar", async () => {
    const response = await patch({ first_response_minutes: 600, resolution_minutes: 480 });

    expect(response.status).toBe(400);
    expect((await response.json()).errors).toEqual({
      first_response_minutes: ["A 1ª resposta não pode ter prazo maior que a solução."],
    });
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("grava só os campos enviados na prioridade da URL e devolve a política", async () => {
    const [update] = queueQueries({ data: POLICY, error: null });

    const response = await patch({ first_response_minutes: 45, warn_pct: 75 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, item: POLICY });
    expect(fromMock).toHaveBeenCalledWith("sla_policies");
    expect(callsOf(update, "update")).toEqual([[{ first_response_minutes: 45, warn_pct: 75 }]]);
    expect(callsOf(update, "eq")).toEqual([["priority", "alta"]]);
    expect(callsOf(update, "select")).toEqual([
      ["priority, rank, first_response_minutes, resolution_minutes, warn_pct"],
    ]);
  });

  it("ordem violada contra o valor gravado (sla_policies_order_check) → 400 no campo", async () => {
    queueQueries({
      data: null,
      error: {
        code: "23514",
        message:
          'new row for relation "sla_policies" violates check constraint "sla_policies_order_check"',
        details: "Failing row contains (alta, 3, 600, 480, 80, …).",
      },
    });

    const response = await patch({ first_response_minutes: 600 });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      ok: false,
      code: "validation",
      message: "A 1ª resposta não pode ter prazo maior que a solução.",
      errors: {
        first_response_minutes: ["A 1ª resposta não pode ter prazo maior que a solução."],
      },
    });
    expect(JSON.stringify(json)).not.toContain("Failing row");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("prioridade sem linha no banco → 404", async () => {
    queueQueries({ data: null, error: null });

    const response = await patch({ warn_pct: 75 });

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
  });

  it("erro inesperado → 500 logado, sem repassar a mensagem do banco", async () => {
    queueQueries({
      data: null,
      error: { code: "42501", message: "permission denied for table sla_policies" },
    });

    const response = await patch({ warn_pct: 75 });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("permission");
    expect(consoleError).toHaveBeenCalledWith(
      "[PATCH /api/sla-policies/[priority]]",
      "42501",
      "permission denied for table sla_policies"
    );
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireAdminMock, revalidatePathMock, hasEnvMock, clientMock, randomBytesSpy } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  hasEnvMock: vi.fn(),
  clientMock: vi.fn(),
  randomBytesSpy: vi.fn(),
}));

// O gerador é o de verdade, só observado: o teste confere DE ONDE a chave vem.
vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:crypto")>();
  randomBytesSpy.mockImplementation(original.randomBytes);
  return { ...original, randomBytes: randomBytesSpy };
});
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardAdmin: requireAdminMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: hasEnvMock,
  createSupabaseAdminClient: clientMock,
}));

import * as route from "@/app/api/connection/agent/signing-secret/route";
import { DELETE, POST } from "@/app/api/connection/agent/signing-secret/route";
import { createHarness, has, where, type Call } from "@/app/api/v1/test-harness";

// As rotas da chave de assinatura contra um cofre de mentira que GUARDA o que
// recebe: a releitura depois de gravar devolve o que foi gravado, e o teste
// confere a ordem das chamadas ao banco.

const KEY = /^[0-9a-f]{64}$/;
const STAMP = "2026-10-01T12:00:00.123456+00:00";
const OTHER_STAMP = "2026-10-01T12:30:00.654321+00:00";
const STALE = "A chave mudou depois que esta tela foi carregada. Confira o estado e tente de novo.";
const ENDPOINT = "http://x/api/connection/agent/signing-secret";

const h = createHarness(clientMock);
/** O que está no cofre: o valor guardado e o carimbo da linha (`null` = sem chave). */
let vault: { value: string | null; stamp: string | null };
let consoles: ReturnType<typeof vi.spyOn>[];

function request(method: "POST" | "DELETE", body: unknown, raw?: string) {
  return new Request(ENDPOINT, {
    method,
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}
const post = (body: unknown, raw?: string) => POST(request("POST", body, raw));
const del = (body: unknown, raw?: string) => DELETE(request("DELETE", body, raw));

const forbidden = () => ({ error: NextResponse.json({ ok: false }, { status: 403 }) });
const rpcNames = () => h.rpcCalls.map(([name]) => name);
const setCall = () => h.rpcCalls.find(([name]) => name === "set_app_environment_variable")?.[1];
/** As linhas de auditoria gravadas em integration_logs. */
const audited = () =>
  (h.chains.integration_logs ?? []).map((calls: Call[]) => calls.find(([method]) => method === "insert")?.[1]);
const auditRow = (action: string, by = "admin-1") => ({
  provider: "relay",
  direction: undefined,
  action,
  status: "ok",
  payload: { by },
  error: undefined,
  api_token_id: null,
  request_id: undefined,
  route: undefined,
  http_status: undefined,
  latency_ms: undefined,
});
/** Nada foi gravado, auditado nem revalidado. */
function untouched() {
  expect(rpcNames().filter((name) => name !== "get_app_environment_variable")).toEqual([]);
  expect(audited()).toEqual([]);
  expect(revalidatePathMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.reset([]);
  vault = { value: null, stamp: null };
  h.tables.app_environment_variables = () => ({
    data: vault.stamp === null ? null : { updated_at: vault.stamp },
    error: null,
  });
  Object.assign(h.rpcs, {
    set_app_environment_variable: (args: Record<string, unknown>) => {
      if (vault.value !== null && !args.p_replace) {
        return { data: null, error: { code: "23505", message: "environment_variable_already_exists" } };
      }
      vault = { value: String(args.p_value), stamp: OTHER_STAMP };
      return { data: true, error: null };
    },
    get_app_environment_variable: () => ({ data: vault.value, error: null }),
    delete_app_environment_variable: () => {
      const existed = vault.value !== null;
      vault = { value: null, stamp: null };
      return { data: existed, error: null };
    },
  });
  requireAdminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  hasEnvMock.mockReturnValue(true);
  consoles = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined)
  );
});

afterEach(() => {
  for (const spy of consoles) spy.mockRestore();
});

describe("/api/connection/agent/signing-secret: o que a rota oferece", () => {
  it("só gera e remove: não existe leitura da chave (ela aparece uma vez, na resposta de quem gerou)", () => {
    expect(Object.keys(route).sort()).toEqual(["DELETE", "POST", "runtime"]);
  });
});

describe("POST /api/connection/agent/signing-secret: quem pode e o que entra", () => {
  it("recusa não-admin antes de ler o corpo e de tocar o cofre", async () => {
    requireAdminMock.mockResolvedValue(forbidden());

    // Corpo inválido de propósito: se a rota o lesse antes do guard, responderia 400.
    const response = await post(null, "{não é json");

    expect(response.status).toBe(403);
    expect(clientMock).not.toHaveBeenCalled();
    untouched();
  });

  it("sem o Supabase configurado: 500, sem gerar nada", async () => {
    hasEnvMock.mockReturnValue(false);

    const response = await post({});

    expect(response.status).toBe(500);
    // `applied: false`: nada foi gravado, e a tela pode dizer que falhou.
    expect(await response.json()).toEqual({
      ok: false,
      message: "O armazenamento seguro não está configurado.",
      applied: false,
    });
    expect(clientMock).not.toHaveBeenCalled();
  });

  it("corpo que não é JSON: 400, sem gerar nada", async () => {
    const response = await post(null, "{não é json");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, message: "JSON inválido." });
    untouched();
  });

  it.each([
    ["replace que não é booleano", { replace: "sim" }],
    ["replace nulo", { replace: null }],
    ["campo que a rota não conhece (a chave não vem de fora)", { replace: false, secret: "a".repeat(64) }],
    ["valor pronto no lugar do pedido", { value: "a".repeat(64) }],
    ["null", null],
    ["lista", [true]],
    ["texto", "true"],
    ["troca sem dizer qual chave", { replace: true }],
    ["carimbo sem pedir troca", { expectedUpdatedAt: STAMP }],
    ["carimbo com replace false", { replace: false, expectedUpdatedAt: STAMP }],
    ["carimbo vazio", { replace: true, expectedUpdatedAt: "" }],
    ["carimbo que não é texto", { replace: true, expectedUpdatedAt: 1790856000 }],
    ["carimbo longo demais", { replace: true, expectedUpdatedAt: "9".repeat(65) }],
  ])("pedido inválido (%s): 400, sem gerar nada", async (_label, body) => {
    vault = { value: "chave-atual", stamp: STAMP };

    const response = await post(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, message: "Pedido inválido." });
    expect(vault).toEqual({ value: "chave-atual", stamp: STAMP });
    expect(h.rpcCalls).toEqual([]);
    untouched();
  });
});

describe("POST /api/connection/agent/signing-secret: gerar a primeira chave", () => {
  it("gera 32 bytes aleatórios em hex, grava no cofre com o nome da chave e devolve o valor uma vez", async () => {
    const response = await post({});
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.secret).toMatch(KEY);
    expect(body).toEqual({ ok: true, secret: body.secret, message: "Chave gerada." });
    expect(h.rpcCalls).toEqual([
      ["set_app_environment_variable", { p_name: "RELAY_SIGNING_SECRET", p_value: body.secret, p_replace: false }],
      // Depois de gravar, confere que a chave guardada é a devolvida.
      ["get_app_environment_variable", { p_name: "RELAY_SIGNING_SECRET" }],
    ]);
    expect(vault.value).toBe(body.secret);
    // A resposta leva um segredo: nenhum intermediário a guarda.
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(revalidatePathMock.mock.calls).toEqual([["/app/configuracoes"]]);
    // A primeira chave não tem o que conferir: o `23505` do cofre é a trava.
    expect(h.chains.app_environment_variables).toBeUndefined();
  });

  it("a chave vem do gerador criptográfico do Node: 32 bytes, em hex, sem passar por mais nada", async () => {
    const body = await (await post({})).json();

    expect(randomBytesSpy.mock.calls).toEqual([[32]]);
    const bytes = randomBytesSpy.mock.results[0].value as Buffer;
    expect(bytes).toHaveLength(32);
    expect(body.secret).toBe(bytes.toString("hex"));
    expect(setCall()?.p_value).toBe(bytes.toString("hex"));
  });

  it("`replace: false` explícito é o mesmo pedido", async () => {
    const response = await post({ replace: false });

    expect(response.status).toBe(200);
    expect(setCall()).toMatchObject({ p_replace: false });
  });

  it("cada pedido gera uma chave diferente", async () => {
    const first = (await (await post({})).json()).secret;
    vault = { value: null, stamp: null };
    const second = (await (await post({})).json()).secret;

    expect(first).toMatch(KEY);
    expect(second).toMatch(KEY);
    expect(second).not.toBe(first);
  });

  it("fica registrado quem gerou, sem a chave", async () => {
    requireAdminMock.mockResolvedValue({ viewer: { id: "admin-7", role: "admin" } });

    const secret = (await (await post({})).json()).secret;

    expect(audited()).toEqual([auditRow("signing_secret.generated", "admin-7")]);
    expect(JSON.stringify(audited())).not.toContain(secret);
  });

  it("já existe chave e o pedido não é de troca: 409, e a chave guardada não muda", async () => {
    vault = { value: "chave-atual", stamp: STAMP };

    const response = await post({});
    const text = await response.text();

    expect(response.status).toBe(409);
    expect(JSON.parse(text)).toEqual({
      ok: false,
      message: "Já existe uma chave de assinatura. Para trocá-la, use Gerar nova chave.",
    });
    expect(text).not.toContain(String(setCall()?.p_value));
    expect(vault).toEqual({ value: "chave-atual", stamp: STAMP });
    expect(rpcNames()).toEqual(["set_app_environment_variable"]);
    expect(audited()).toEqual([]);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  const SET_FAILURES: Array<[string, { data: unknown; error: { code?: string; message: string } | null }]> = [
    ["o cofre devolve erro", { data: null, error: { code: "XX000", message: "vault: falha interna" } }],
    ["o cofre não confirma a gravação", { data: null, error: null }],
    ["o cofre devolve false", { data: false, error: null }],
  ];

  it.each(SET_FAILURES)(
    "quando %s e a chave NÃO ficou guardada: 500 dizendo que nada foi gravado, sem a chave e sem a mensagem crua do banco",
    async (_label, rpcResult) => {
      h.rpcs.set_app_environment_variable = () => rpcResult;

      const response = await post({});
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(JSON.parse(text)).toEqual({ ok: false, message: "Não foi possível gerar a chave.", applied: false });
      expect(text).not.toContain(String(setCall()?.p_value));
      expect(text).not.toContain("vault");
      // A rota conferiu o que ficou guardado antes de dizer que falhou.
      expect(rpcNames()).toEqual(["set_app_environment_variable", "get_app_environment_variable"]);
      expect(audited()).toEqual([]);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    }
  );

  it.each(SET_FAILURES)(
    "quando %s, mas a chave FICOU guardada (a resposta do banco se perdeu depois do commit): devolve a chave",
    async (_label, rpcResult) => {
      h.rpcs.set_app_environment_variable = (args) => {
        vault = { value: String(args.p_value), stamp: OTHER_STAMP };
        return rpcResult;
      };

      const response = await post({});
      const body = await response.json();

      // Dizer "falhou" aqui deixaria o CRM assinando com uma chave que ninguém tem.
      expect(response.status).toBe(200);
      expect(body.secret).toMatch(KEY);
      expect(body.secret).toBe(vault.value);
      expect(audited()).toEqual([auditRow("signing_secret.generated")]);
      expect(revalidatePathMock.mock.calls).toEqual([["/app/configuracoes"]]);
    }
  );

  it.each(SET_FAILURES)(
    "quando %s e nem a conferência responde: 500 SEM dizer que nada foi gravado (desfecho desconhecido)",
    async (_label, rpcResult) => {
      h.rpcs.set_app_environment_variable = () => rpcResult;
      h.rpcs.get_app_environment_variable = () => ({ data: null, error: { message: "timeout" } });

      const response = await post({});
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(JSON.parse(text)).toEqual({ ok: false, message: "Não foi possível gerar a chave." });
      expect(text).not.toContain(String(setCall()?.p_value));
      expect(audited()).toEqual([]);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    }
  );

  it("o erro do cofre ao gravar vai para o log só com o código: o pedido levava a chave", async () => {
    h.rpcs.set_app_environment_variable = () => ({
      data: null,
      error: { code: "XX000", message: "falha ao gravar, detalhe do banco" },
    });

    await post({});

    const logged = JSON.stringify(consoles.map((spy) => spy.mock.calls));
    expect(logged).toContain("[agent] gravar a chave de assinatura falhou:");
    expect(logged).toContain("XX000");
    expect(logged).not.toContain("detalhe do banco");
    expect(logged).not.toContain(String(setCall()?.p_value));
  });

  it("a chave nunca vai para o log do servidor", async () => {
    const secret = (await (await post({})).json()).secret;

    for (const spy of consoles) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    }
  });

  it("o registro de quem gerou é gravado ANTES de a resposta voltar", async () => {
    let finishInsert: ((value: { data: null; error: null }) => void) | undefined;
    h.tables.integration_logs = () =>
      new Promise((resolve) => {
        finishInsert = resolve;
      }) as never;
    let settled = false;

    const done = post({}).then((response) => {
      settled = true;
      return response;
    });
    for (let turn = 0; turn < 50 && !finishInsert; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(finishInsert).toBeDefined();
    expect(settled).toBe(false);

    finishInsert?.({ data: null, error: null });
    expect((await done).status).toBe(200);
  });

  it.each([
    ["devolve erro", () => ({ data: null, error: { message: "disco cheio" } })],
    [
      "lança",
      () => {
        throw new Error("conexão com o banco caiu");
      },
    ],
  ])("o registro de quem gerou %s: a chave já vale, e quem gerou a recebe mesmo assim", async (_label, respond) => {
    h.tables.integration_logs = respond;

    const response = await post({});

    expect(response.status).toBe(200);
    expect((await response.json()).secret).toBe(vault.value);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("POST /api/connection/agent/signing-secret: trocar", () => {
  beforeEach(() => {
    vault = { value: "chave-atual", stamp: STAMP };
  });

  it("com o carimbo da chave que a tela mostrava: troca, e a chave devolvida é a guardada", async () => {
    const response = await post({ replace: true, expectedUpdatedAt: STAMP });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.secret).toMatch(KEY);
    expect(vault.value).toBe(body.secret);
    // A conferência lê só o carimbo da linha da chave, e vem ANTES de gravar.
    const chain = h.lastChain("app_environment_variables");
    expect(has(chain, "select", "updated_at")).toBe(true);
    expect(where(chain, "name", "RELAY_SIGNING_SECRET")).toBe(true);
    expect(has(chain, "maybeSingle")).toBe(true);
    expect(h.rpcCalls).toEqual([
      ["set_app_environment_variable", { p_name: "RELAY_SIGNING_SECRET", p_value: body.secret, p_replace: true }],
      ["get_app_environment_variable", { p_name: "RELAY_SIGNING_SECRET" }],
    ]);
    expect(audited()).toEqual([auditRow("signing_secret.rotated")]);
    expect(revalidatePathMock.mock.calls).toEqual([["/app/configuracoes"]]);
  });

  it.each([
    ["outro administrador trocou a chave depois", { value: "chave-de-outro-admin", stamp: OTHER_STAMP }],
    ["a chave foi removida depois", { value: null, stamp: null }],
  ])("tela desatualizada (%s): 409, sem gravar nada", async (_label, now) => {
    vault = now;

    const response = await post({ replace: true, expectedUpdatedAt: STAMP });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, message: STALE });
    expect(vault).toEqual(now);
    expect(h.rpcCalls).toEqual([]);
    untouched();
  });

  it("o carimbo é comparado inteiro: um microssegundo de diferença é outra chave", async () => {
    const response = await post({ replace: true, expectedUpdatedAt: "2026-10-01T12:00:00.123457+00:00" });

    expect(response.status).toBe(409);
    expect(vault.value).toBe("chave-atual");
  });

  it("a leitura do carimbo falha: 500, sem trocar (não troca às cegas)", async () => {
    h.tables.app_environment_variables = () => ({ data: null, error: { message: "timeout" } });

    const response = await post({ replace: true, expectedUpdatedAt: STAMP });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      ok: false,
      message: "Não foi possível conferir a chave atual.",
      applied: false,
    });
    expect(text).not.toContain("timeout");
    expect(vault.value).toBe("chave-atual");
    expect(h.rpcCalls).toEqual([]);
    untouched();
  });

  it.each([
    ["outra troca gravou por cima", "chave-de-quem-gravou-depois"],
    ["a chave foi removida logo depois", null],
  ])("a chave guardada não é a gerada (%s): 409, e a chave morta não é devolvida", async (_label, storedNow) => {
    h.rpcs.get_app_environment_variable = () => ({ data: storedNow, error: null });

    const response = await post({ replace: true, expectedUpdatedAt: STAMP });
    const text = await response.text();

    expect(response.status).toBe(409);
    expect(JSON.parse(text)).toEqual({
      ok: false,
      message: "Outra troca da chave aconteceu ao mesmo tempo. Confira o estado e gere de novo.",
    });
    expect(text).not.toContain(String(setCall()?.p_value));
    expect(audited()).toEqual([]);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("a releitura falha: a gravação foi confirmada, e a chave é devolvida (ninguém mais a teria)", async () => {
    h.rpcs.get_app_environment_variable = () => ({ data: null, error: { message: "timeout" } });

    const response = await post({ replace: true, expectedUpdatedAt: STAMP });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.secret).toBe(vault.value);
    expect(body.secret).toMatch(KEY);
    expect(audited()).toEqual([auditRow("signing_secret.rotated")]);
    // O aviso vai para o log, sem a chave.
    const logged = JSON.stringify(consoles.map((spy) => spy.mock.calls));
    expect(logged).toContain("conferir a chave gravada falhou");
    expect(logged).not.toContain(body.secret);
  });
});

describe("DELETE /api/connection/agent/signing-secret", () => {
  beforeEach(() => {
    vault = { value: "chave-atual", stamp: STAMP };
  });

  it("recusa não-admin antes de ler o corpo e de tocar o cofre", async () => {
    requireAdminMock.mockResolvedValue(forbidden());

    const response = await del(null, "{não é json");

    expect(response.status).toBe(403);
    expect(clientMock).not.toHaveBeenCalled();
    expect(vault.value).toBe("chave-atual");
  });

  it("sem o Supabase configurado: 500, sem remover nada", async () => {
    hasEnvMock.mockReturnValue(false);

    const response = await del({ expectedUpdatedAt: STAMP });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      message: "O armazenamento seguro não está configurado.",
      applied: false,
    });
    expect(clientMock).not.toHaveBeenCalled();
  });

  it("corpo que não é JSON: 400, sem remover", async () => {
    const response = await del(null, "{não é json");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, message: "JSON inválido." });
    expect(vault.value).toBe("chave-atual");
  });

  it.each([
    ["sem o carimbo", {}],
    ["carimbo vazio", { expectedUpdatedAt: "" }],
    ["carimbo que não é texto", { expectedUpdatedAt: null }],
    ["campo que a rota não conhece", { expectedUpdatedAt: STAMP, name: "OPENAI_API_KEY" }],
    ["null", null],
  ])("pedido inválido (%s): 400, sem remover", async (_label, body) => {
    const response = await del(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, message: "Pedido inválido." });
    expect(vault.value).toBe("chave-atual");
    expect(h.rpcCalls).toEqual([]);
    untouched();
  });

  it("com o carimbo da chave que a tela mostrava: remove só a chave de assinatura e avisa o que muda no envio", async () => {
    const response = await del({ expectedUpdatedAt: STAMP });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      message: "Chave removida: os pedidos ao agente passam a sair sem assinatura.",
    });
    expect(vault).toEqual({ value: null, stamp: null });
    expect(where(h.lastChain("app_environment_variables"), "name", "RELAY_SIGNING_SECRET")).toBe(true);
    expect(h.rpcCalls).toEqual([["delete_app_environment_variable", { p_name: "RELAY_SIGNING_SECRET" }]]);
    expect(audited()).toEqual([auditRow("signing_secret.removed")]);
    expect(revalidatePathMock.mock.calls).toEqual([["/app/configuracoes"]]);
  });

  it("tela desatualizada (outro administrador trocou a chave depois): 409, sem remover a chave dele", async () => {
    vault = { value: "chave-de-outro-admin", stamp: OTHER_STAMP };

    const response = await del({ expectedUpdatedAt: STAMP });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, message: STALE });
    expect(vault.value).toBe("chave-de-outro-admin");
    expect(h.rpcCalls).toEqual([]);
    untouched();
  });

  it("não havia chave: 404, sem chamar o cofre", async () => {
    vault = { value: null, stamp: null };

    const response = await del({ expectedUpdatedAt: STAMP });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, message: "Não há chave de assinatura." });
    expect(h.rpcCalls).toEqual([]);
    untouched();
  });

  it("a chave some entre a conferência e a remoção: 404, sem registrar remoção", async () => {
    h.rpcs.delete_app_environment_variable = () => ({ data: false, error: null });

    const response = await del({ expectedUpdatedAt: STAMP });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, message: "Não há chave de assinatura." });
    expect(audited()).toEqual([]);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("a leitura do carimbo falha: 500, sem remover", async () => {
    h.tables.app_environment_variables = () => ({ data: null, error: { message: "timeout" } });

    const response = await del({ expectedUpdatedAt: STAMP });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      ok: false,
      message: "Não foi possível conferir a chave atual.",
      applied: false,
    });
    expect(text).not.toContain("timeout");
    expect(vault.value).toBe("chave-atual");
    expect(h.rpcCalls).toEqual([]);
  });

  const DELETE_ERROR = { data: null, error: { code: "XX000", message: "vault: falha interna" } };

  it("o cofre falha ao remover e a chave CONTINUA lá: 500 dizendo que nada foi removido, sem a mensagem crua do banco", async () => {
    h.rpcs.delete_app_environment_variable = () => DELETE_ERROR;

    const response = await del({ expectedUpdatedAt: STAMP });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ ok: false, message: "Não foi possível remover a chave.", applied: false });
    expect(text).not.toContain("vault");
    // A rota conferiu o carimbo de novo antes de dizer que falhou.
    expect(h.chains.app_environment_variables).toHaveLength(2);
    expect(audited()).toEqual([]);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("o cofre devolve erro, mas a chave SUMIU (a resposta do banco se perdeu depois do commit): responde que removeu", async () => {
    h.rpcs.delete_app_environment_variable = () => {
      vault = { value: null, stamp: null };
      return DELETE_ERROR;
    };

    const response = await del({ expectedUpdatedAt: STAMP });

    // Dizer "falhou" aqui deixaria a tela afirmando que os pedidos saem assinados.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      message: "Chave removida: os pedidos ao agente passam a sair sem assinatura.",
    });
    expect(audited()).toEqual([auditRow("signing_secret.removed")]);
    expect(revalidatePathMock.mock.calls).toEqual([["/app/configuracoes"]]);
  });

  it("o cofre falha ao remover e nem a conferência responde: 500 SEM dizer que nada foi removido (desfecho desconhecido)", async () => {
    h.rpcs.delete_app_environment_variable = () => DELETE_ERROR;
    let reads = 0;
    h.tables.app_environment_variables = () => {
      reads += 1;
      return reads === 1 ? { data: { updated_at: STAMP }, error: null } : { data: null, error: { message: "timeout" } };
    };

    const response = await del({ expectedUpdatedAt: STAMP });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, message: "Não foi possível remover a chave." });
    expect(audited()).toEqual([]);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("o erro do cofre ao remover vai para o log só com o código", async () => {
    h.rpcs.delete_app_environment_variable = () => DELETE_ERROR;

    await del({ expectedUpdatedAt: STAMP });

    const logged = JSON.stringify(consoles.map((spy) => spy.mock.calls));
    expect(logged).toContain("[agent] remover a chave de assinatura falhou:");
    expect(logged).toContain("XX000");
    expect(logged).not.toContain("vault: falha interna");
  });

  it("o registro de quem removeu é gravado ANTES de a resposta voltar", async () => {
    let finishInsert: ((value: { data: null; error: null }) => void) | undefined;
    h.tables.integration_logs = () =>
      new Promise((resolve) => {
        finishInsert = resolve;
      }) as never;
    let settled = false;

    const done = del({ expectedUpdatedAt: STAMP }).then((response) => {
      settled = true;
      return response;
    });
    for (let turn = 0; turn < 50 && !finishInsert; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(finishInsert).toBeDefined();
    expect(settled).toBe(false);

    finishInsert?.({ data: null, error: null });
    expect((await done).status).toBe(200);
  });

  it("o registro de quem removeu LANÇA: a chave já saiu, e a resposta diz que removeu", async () => {
    h.tables.integration_logs = () => {
      throw new Error("conexão com o banco caiu");
    };

    const response = await del({ expectedUpdatedAt: STAMP });

    expect(response.status).toBe(200);
    expect(vault).toEqual({ value: null, stamp: null });
    expect(JSON.stringify(consoles.map((spy) => spy.mock.calls))).toContain(
      "[agent] registrar a ação na chave de assinatura falhou:"
    );
  });
});

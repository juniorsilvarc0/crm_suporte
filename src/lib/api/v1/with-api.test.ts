// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import { hashApiToken } from "@/lib/security/api-token";

const { adminClientMock } = vi.hoisted(() => ({ adminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: adminClientMock }));

import {
  API_DEFAULT_MAX_BODY_BYTES,
  API_IP_LIMIT_PER_MIN,
  withApi,
} from "@/lib/api/v1/with-api";
import { canonicalJson, sha256Hex } from "@/lib/api/v1/idempotency";

type TokenRow = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  actor_type: string;
  rate_limit_per_min: number;
  expires_at: string | null;
  last_used_at: string | null;
};

const TOKEN = "crmsuporte_segredo-de-teste";
const baseRow = (over: Partial<TokenRow> = {}): TokenRow => ({
  id: "tok-1",
  name: "IA de triagem",
  token_prefix: "crmsuporte_s",
  scopes: ["tickets:*", "context:read"],
  actor_type: "ai",
  rate_limit_per_min: 120,
  expires_at: null,
  last_used_at: new Date().toISOString(),
  ...over,
});

// Banco falso: o SELECT do token, o UPDATE preguiçoso do last_used_at (só
// executa com .then, como o supabase-js), o INSERT do log e as RPCs.
function fakeDb(row: TokenRow | null) {
  const state = {
    selectedHash: null as string | null,
    lastUsed: vi.fn(),
    logs: [] as Record<string, unknown>[],
    rpc: vi.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>(
      async () => ({ data: null, error: null })
    ),
  };
  const client = {
    from(table: string) {
      if (table === "api_tokens") {
        return {
          select: () => ({
            eq: (_col: string, hash: string) => ({
              is: () => ({
                maybeSingle: async () => {
                  state.selectedHash = hash;
                  return { data: row, error: null };
                },
              }),
            }),
          }),
          update: (values: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => ({
              then(onOk: (v: unknown) => unknown, onErr: (e: unknown) => unknown) {
                state.lastUsed(values, id);
                return Promise.resolve({ error: null }).then(onOk, onErr);
              },
            }),
          }),
        };
      }
      if (table === "integration_logs") {
        return {
          insert: async (values: Record<string, unknown>) => {
            state.logs.push(values);
            return { error: null };
          },
        };
      }
      throw new Error(`tabela inesperada: ${table}`);
    },
    rpc: (fn: string, args: Record<string, unknown>) => state.rpc(fn, args),
  };
  adminClientMock.mockReturnValue(client);
  return state;
}

let ip = 0;
function request(
  init: { auth?: string | null; method?: string; body?: string; headers?: Record<string, string>; url?: string } = {}
) {
  ip += 1;
  const headers: Record<string, string> = { "x-forwarded-for": `10.0.${Math.floor(ip / 250)}.${ip % 250}` };
  if (init.auth !== null) headers.authorization = init.auth ?? `Bearer ${TOKEN}`;
  return new Request(init.url ?? "http://crm.test/api/v1/tickets?x=1", {
    method: init.method ?? "GET",
    headers: { ...headers, ...(init.headers ?? {}) },
    body: init.body,
  });
}
const ctx = <P extends Record<string, string>>(params: P = {} as P) => ({ params: Promise.resolve(params) });

beforeEach(() => {
  adminClientMock.mockReset();
});

describe("withApi — autenticação", () => {
  const route = withApi({ route: "/api/v1/tickets", scopes: ["tickets:read"] }, async () =>
    NextResponse.json({ ok: true })
  );

  it("sem Authorization responde 401 sem tocar o banco (nem para logar)", async () => {
    const response = await route(request({ auth: null }), ctx());

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthorized");
    expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("Authorization que não é Bearer é 401 sem banco", async () => {
    const response = await route(request({ auth: "Basic abc" }), ctx());

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("procura pelo hash do token, nunca pelo token", async () => {
    const db = fakeDb(baseRow());

    await route(request(), ctx());

    expect(db.selectedHash).toBe(hashApiToken(TOKEN));
  });

  it("token desconhecido ou revogado é 401, e a tentativa fica no log sem token", async () => {
    const db = fakeDb(null);

    const response = await route(request(), ctx());

    expect(response.status).toBe(401);
    expect(db.logs).toHaveLength(1);
    expect(db.logs[0]).toMatchObject({ provider: "api_v1", api_token_id: null, http_status: 401, status: "error" });
  });

  it("rajada de token desconhecido: o log fica em no máximo 10 linhas por minuto por IP", async () => {
    const db = fakeDb(null);
    const sameIp = () =>
      new Request("http://crm.test/api/v1/me", {
        headers: { authorization: "Bearer lixo", "x-forwarded-for": "203.0.113.200" },
      });

    const statuses = [];
    for (let i = 0; i < 15; i += 1) statuses.push((await route(sameIp(), ctx())).status);

    expect(new Set(statuses)).toEqual(new Set([401]));
    expect(db.logs).toHaveLength(10);
  });

  it("token vencido é 401 token_expired", async () => {
    const db = fakeDb(baseRow({ expires_at: new Date(Date.now() - 1000).toISOString() }));

    const response = await route(request(), ctx());

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("token_expired");
    expect(db.logs[0]).toMatchObject({ api_token_id: "tok-1", http_status: 401 });
  });

  it("escopo que falta é 403 com a lista do que falta", async () => {
    fakeDb(baseRow({ scopes: ["context:read"] }));
    const strict = withApi({ route: "/api/v1/x", scopes: ["tickets:read", "context:read"] }, async () =>
      NextResponse.json({ ok: true })
    );

    const response = await strict(request(), ctx());

    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatchObject({ code: "insufficient_scope", required: ["tickets:read"] });
  });

  it("recurso:* cobre a ação exigida", async () => {
    fakeDb(baseRow({ scopes: ["tickets:*"] }));

    const response = await route(request(), ctx());

    expect(response.status).toBe(200);
  });
});

describe("withApi — chamada autorizada", () => {
  it("entrega token, params e request_id ao handler e loga sem o corpo", async () => {
    const db = fakeDb(baseRow());
    const handler = vi.fn(async () => NextResponse.json({ ok: true }, { status: 200 }));
    const route = withApi<{ id: string }>({ route: "/api/v1/tickets/[id]", scopes: ["tickets:read"] }, handler);

    const response = await route(request(), ctx({ id: "t-9" }));

    expect(response.status).toBe(200);
    const [arg] = handler.mock.calls[0] as unknown as [
      { params: { id: string }; token: { id: string; actorType: string }; requestId: string },
    ];
    expect(arg.params).toEqual({ id: "t-9" });
    expect(arg.token).toMatchObject({ id: "tok-1", actorType: "ai" });
    expect(response.headers.get("X-Request-Id")).toBe(arg.requestId);
    expect(db.logs[0]).toMatchObject({
      provider: "api_v1",
      direction: "inbound",
      action: "GET",
      status: "ok",
      api_token_id: "tok-1",
      request_id: arg.requestId,
      route: "/api/v1/tickets/[id]",
      http_status: 200,
    });
    expect(typeof db.logs[0].latency_ms).toBe("number");
    expect(db.logs[0].payload).toBeUndefined();
  });

  it("last_used_at recente não gera UPDATE; antigo ou nulo gera um", async () => {
    const route = withApi({ route: "/api/v1/me", scopes: [] }, async () => NextResponse.json({ ok: true }));

    const fresh = fakeDb(baseRow({ last_used_at: new Date().toISOString() }));
    await route(request(), ctx());
    expect(fresh.lastUsed).not.toHaveBeenCalled();

    const stale = fakeDb(baseRow({ last_used_at: new Date(Date.now() - 120_000).toISOString() }));
    await route(request(), ctx());
    expect(stale.lastUsed).toHaveBeenCalledWith(expect.objectContaining({ last_used_at: expect.any(String) }), "tok-1");

    const never = fakeDb(baseRow({ id: "tok-2", last_used_at: null }));
    await route(request(), ctx());
    expect(never.lastUsed).toHaveBeenCalledTimes(1);
  });

  it("estourar o limite do token dá 429 com Retry-After", async () => {
    fakeDb(baseRow({ id: "tok-limite", rate_limit_per_min: 2 }));
    const route = withApi({ route: "/api/v1/me", scopes: [] }, async () => NextResponse.json({ ok: true }));

    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await route(request(), ctx())).status);
    const blocked = await route(request(), ctx());

    expect(statuses).toEqual([200, 200, 429]);
    expect(blocked.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect((await blocked.json()).error.code).toBe("rate_limited");
  });

  it("o limite por IP corta antes do banco", async () => {
    const route = withApi({ route: "/api/v1/me", scopes: [] }, async () => NextResponse.json({ ok: true }));
    const sameIp = () =>
      new Request("http://crm.test/api/v1/me", { headers: { "x-forwarded-for": "203.0.113.77" } });

    for (let i = 0; i < API_IP_LIMIT_PER_MIN; i += 1) await route(sameIp(), ctx());
    const blocked = await route(sameIp(), ctx());

    expect(blocked.status).toBe(429);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("exceção no handler vira 500 com o request_id, e fica no log", async () => {
    const db = fakeDb(baseRow());
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const route = withApi({ route: "/api/v1/me", scopes: [] }, async () => {
      throw new Error("falhou");
    });

    const response = await route(request(), ctx());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(body.request_id).toBe(response.headers.get("X-Request-Id"));
    expect(db.logs[0]).toMatchObject({ http_status: 500, status: "error" });
    errorLog.mockRestore();
  });
});

describe("withApi — Idempotency-Key", () => {
  const post = (body: string, key: string | null = "chave-0001", type = "application/json") =>
    request({
      method: "POST",
      body,
      url: "http://crm.test/api/v1/tickets?origem=teste",
      headers: { "content-type": type, ...(key ? { "Idempotency-Key": key } : {}) },
    });

  type Handler = () => Promise<Response>;
  function idempotentRoute(
    handler = vi.fn<Handler>(async () => NextResponse.json({ ok: true, id: "t1" }, { status: 201 }))
  ) {
    return {
      handler,
      route: withApi({ route: "/api/v1/tickets", scopes: ["tickets:write"], idempotency: "required" }, handler),
    };
  }

  it("sem a chave é 400 e não chega ao handler nem à RPC", async () => {
    const db = fakeDb(baseRow());
    const { route, handler } = idempotentRoute();

    const response = await route(post('{"a":1}', null), ctx());

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("idempotency_key_required");
    expect(handler).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("chave fora do formato é 400; corpo não JSON é 415; JSON inválido é 400", async () => {
    fakeDb(baseRow());
    const { route } = idempotentRoute();

    expect((await (await route(post('{"a":1}', "curta"), ctx())).json()).error.code).toBe("invalid_idempotency_key");
    expect((await route(post("a=1", "chave-0001", "text/plain"), ctx())).status).toBe(415);
    expect((await (await route(post("{nao-json", "chave-0001"), ctx())).json()).error.code).toBe("invalid_json");
  });

  describe("multipart (rota que declara body: multipart)", () => {
    let seq = 0;
    type Part = [name: string, value: string | File];
    const pdf = (bytes: string, name = "nota.pdf", type = "application/pdf") => new File([bytes], name, { type });
    const multipart = (parts: Part[], headers: Record<string, string> = {}) => {
      seq += 1;
      const form = new FormData();
      for (const [name, value] of parts) form.append(name, value);
      // O Request monta o boundary: cada envio tem um diferente.
      return new Request("http://crm.test/api/v1/tickets/1/attachments", {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-forwarded-for": `10.9.0.${seq}`,
          "Idempotency-Key": "anexo-000001",
          ...headers,
        },
        body: form,
      });
    };
    type FormHandler = (ctx: { form: FormData | null; request: Request }) => Promise<Response>;
    function uploadRoute(
      handler = vi.fn<FormHandler>(async () => NextResponse.json({ ok: true, id: "a1" }, { status: 201 }))
    ) {
      return {
        handler,
        route: withApi(
          {
            route: "/api/v1/tickets/[ref]/attachments",
            scopes: ["tickets:write"],
            idempotency: "required",
            body: "multipart",
            maxBodyBytes: 4096,
          },
          handler
        ),
      };
    }
    const started = (db: ReturnType<typeof fakeDb>) =>
      db.rpc.mockImplementation(async (fn) =>
        fn === "api_idempotency_begin"
          ? { data: { outcome: "started", attempt_id: "att-1" }, error: null }
          : { data: null, error: null }
      );
    const hashOf = (db: ReturnType<typeof fakeDb>) =>
      db.rpc.mock.calls.find(([fn]) => fn === "api_idempotency_begin")?.[1].p_request_hash;
    async function hashFor(request: Request) {
      const db = fakeDb(baseRow());
      started(db);
      await uploadRoute().route(request, ctx());
      return hashOf(db);
    }

    it("o mesmo arquivo reenviado, com OUTRO boundary, tem o mesmo hash", async () => {
      const first = multipart([["file", pdf("%PDF-1")]]);
      const second = multipart([["file", pdf("%PDF-1")]]);
      // A premissa do teste: os dois corpos crus são diferentes.
      expect(first.headers.get("content-type")).not.toBe(second.headers.get("content-type"));

      const hash = await hashFor(first);

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(await hashFor(second)).toBe(hash);
    });

    it.each([
      ["outro conteúdo", [["file", pdf("%PDF-2")]]],
      ["outro nome de arquivo", [["file", pdf("%PDF-1", "outra.pdf")]]],
      ["outro tipo", [["file", pdf("%PDF-1", "nota.pdf", "image/png")]]],
      ["outro nome de campo", [["arquivo", pdf("%PDF-1")]]],
      ["um campo a mais", [["file", pdf("%PDF-1")], ["descricao", "x"]]],
      ["as partes em outra ordem", [["descricao", "x"], ["file", pdf("%PDF-1")]]],
    ] as [string, Part[]][])("%s muda o hash", async (_label, parts) => {
      const base = await hashFor(multipart([["file", pdf("%PDF-1")]]));
      const withExtra = await hashFor(multipart([["file", pdf("%PDF-1")], ["descricao", "x"]]));

      const hash = await hashFor(multipart(parts));

      expect(hash).not.toBe(base);
      if (_label !== "um campo a mais") expect(hash).not.toBe(withExtra);
    });

    it("o corpo é lido UMA vez: o handler recebe o FormData pronto", async () => {
      const db = fakeDb(baseRow());
      started(db);
      const { route, handler } = uploadRoute();

      await route(multipart([["file", pdf("%PDF-1")]]), ctx());

      const context = handler.mock.calls[0][0];
      const file = context.form?.get("file");
      expect(file).toBeInstanceOf(File);
      expect(await (file as File).text()).toBe("%PDF-1");
      // Já consumido aqui: quem chamasse request.formData() de novo quebraria.
      expect(context.request.bodyUsed).toBe(true);
    });

    it("multipart malformado é 400 invalid_multipart com a dica das aspas, sem reservar a chave", async () => {
      const db = fakeDb(baseRow());
      const { route, handler } = uploadRoute();

      const response = await route(
        post("isto não é multipart", "anexo-000001", "multipart/form-data; boundary=xyz"),
        ctx()
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("invalid_multipart");
      expect(body.error.message).toContain("aspas");
      expect(db.rpc).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });

    it("falha que não é de parse (ex.: memória) é 500, não 'multipart inválido'", async () => {
      const db = fakeDb(baseRow());
      const { route, handler } = uploadRoute();
      const request = multipart([["file", pdf("%PDF-1")]]);
      vi.spyOn(request, "formData").mockRejectedValue(new RangeError("Array buffer allocation failed"));
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const response = await route(request, ctx());

      expect(response.status).toBe(500);
      expect((await response.json()).error.code).toBe("internal_error");
      expect(db.rpc).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
      errorLog.mockRestore();
    });

    it("JSON na rota de anexo é 415, sem ler o corpo nem reservar a chave", async () => {
      const db = fakeDb(baseRow());
      const { route, handler } = uploadRoute();
      const request = post('{"file":"x"}', "anexo-000001");

      const response = await route(request, ctx());
      const body = await response.json();

      expect(response.status).toBe(415);
      expect(body.error.message).toContain("multipart/form-data");
      expect(request.bodyUsed).toBe(false);
      expect(db.rpc).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });

    it("Content-Length acima do teto da rota é 413 antes de ler o corpo", async () => {
      const db = fakeDb(baseRow());
      const { route, handler } = uploadRoute();
      const request = multipart([["file", pdf("%PDF-1")]], { "content-length": "4097" });

      const response = await route(request, ctx());

      expect(response.status).toBe(413);
      expect((await response.json()).error.code).toBe("payload_too_large");
      expect(request.bodyUsed).toBe(false);
      expect(db.rpc).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
      expect(db.logs[0]).toMatchObject({ http_status: 413 });
    });

    it("body multipart sem idempotência é erro de quem escreve a rota, na definição", () => {
      expect(() =>
        withApi({ route: "/api/v1/x", scopes: [], body: "multipart" }, async () => NextResponse.json({}))
      ).toThrow(/multipart/);
    });
  });

  describe("corpo: tipo e teto nas rotas JSON", () => {
    it("multipart numa rota JSON é 415, sem ler o corpo nem reservar a chave", async () => {
      const db = fakeDb(baseRow());
      const { route, handler } = idempotentRoute();
      const form = new FormData();
      form.set("file", new File(["%PDF-1"], "nota.pdf"));
      const request = new Request("http://crm.test/api/v1/tickets", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "x-forwarded-for": "10.8.0.1", "Idempotency-Key": "chave-0001" },
        body: form,
      });

      // Nem a cópia é lida: o tipo errado sai pelo cabeçalho.
      const clone = vi.spyOn(request, "clone");

      const response = await route(request, ctx());
      const body = await response.json();

      expect(response.status).toBe(415);
      expect(body.error.message).not.toContain("multipart");
      expect(clone).not.toHaveBeenCalled();
      expect(request.bodyUsed).toBe(false);
      expect(db.rpc).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });

    it("Content-Length acima de 1 MB é 413 antes de ler, também em rota sem idempotência", async () => {
      fakeDb(baseRow());
      const handler = vi.fn(async () => NextResponse.json({ ok: true }));
      const route = withApi({ route: "/api/v1/tickets/[ref]", scopes: [] }, handler);
      const request = new Request("http://crm.test/api/v1/tickets/1", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-forwarded-for": "10.8.0.2",
          "content-type": "application/json",
          "content-length": String(API_DEFAULT_MAX_BODY_BYTES + 1),
        },
        body: "{}",
      });

      const response = await route(request, ctx());

      expect(response.status).toBe(413);
      expect((await response.json()).error.message).toContain("1 MB");
      expect(handler).not.toHaveBeenCalled();
    });

    it("sem Content-Length (chunked), a leitura para no teto: 413 sem reservar a chave", async () => {
      const db = fakeDb(baseRow());
      const { route, handler } = idempotentRoute();
      const big = JSON.stringify({ texto: "x".repeat(API_DEFAULT_MAX_BODY_BYTES) });

      const response = await route(post(big), ctx());

      expect(response.status).toBe(413);
      expect(db.rpc).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });

    it("caminho que não cabe na chave de idempotência é 404, sem ir ao banco", async () => {
      const db = fakeDb(baseRow());
      const { route, handler } = idempotentRoute();
      const request = new Request(`http://crm.test/api/v1/tickets/${"9".repeat(520)}/comments`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-forwarded-for": "10.8.0.3",
          "content-type": "application/json",
          "Idempotency-Key": "chave-0001",
        },
        body: "{}",
      });

      const response = await route(request, ctx());

      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe("not_found");
      expect(db.rpc).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  it("número fora do intervalo (1e400) é JSON inválido, sem reservar a chave", async () => {
    const db = fakeDb(baseRow());
    const { route, handler } = idempotentRoute();

    const response = await route(post('{"n":1e400}'), ctx());

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_json");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("started: roda o handler e guarda a resposta com o attempt_id", async () => {
    const db = fakeDb(baseRow());
    db.rpc.mockImplementation(async (fn) =>
      fn === "api_idempotency_begin"
        ? { data: { outcome: "started", attempt_id: "att-1" }, error: null }
        : { data: null, error: null }
    );
    const { route, handler } = idempotentRoute();

    const response = await route(post('{"b":2,"a":1}'), ctx());

    expect(response.status).toBe(201);
    expect(handler).toHaveBeenCalledTimes(1);
    const begin = db.rpc.mock.calls.find(([fn]) => fn === "api_idempotency_begin")?.[1];
    expect(begin).toMatchObject({
      p_token_id: "tok-1",
      p_key: "chave-0001",
      p_method: "POST",
      p_route: "/api/v1/tickets",
      p_request_hash: sha256Hex(canonicalJson({ a: 1, b: 2 })),
    });
    const finish = db.rpc.mock.calls.find(([fn]) => fn === "api_idempotency_finish")?.[1];
    expect(finish).toMatchObject({ p_attempt_id: "att-1", p_status: 201, p_body: { ok: true, id: "t1" } });
  });

  it("replay: devolve a resposta guardada sem rodar o handler", async () => {
    const db = fakeDb(baseRow());
    db.rpc.mockResolvedValue({ data: { outcome: "replay", status: 201, body: { ok: true, id: "t1" } }, error: null });
    const { route, handler } = idempotentRoute();

    const response = await route(post('{"a":1}'), ctx());

    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, id: "t1" });
    expect(response.headers.get("Idempotent-Replayed")).toBe("true");
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("reused é 422 e in_progress é 409", async () => {
    const db = fakeDb(baseRow());
    const { route } = idempotentRoute();

    db.rpc.mockResolvedValueOnce({ data: { outcome: "reused" }, error: null });
    const reused = await route(post('{"a":1}'), ctx());
    db.rpc.mockResolvedValueOnce({ data: { outcome: "in_progress" }, error: null });
    const inProgress = await route(post('{"a":1}'), ctx());

    expect(reused.status).toBe(422);
    expect((await reused.json()).error.code).toBe("idempotency_key_reused");
    expect(inProgress.status).toBe(409);
    expect((await inProgress.json()).error.code).toBe("idempotency_in_progress");
  });

  it.each([
    ["5xx", 503],
    ["4xx que não se guarda", 400],
  ])("%s libera a chave (release, não finish)", async (_label, status) => {
    const db = fakeDb(baseRow());
    db.rpc.mockImplementation(async (fn) =>
      fn === "api_idempotency_begin"
        ? { data: { outcome: "started", attempt_id: "att-2" }, error: null }
        : { data: null, error: null }
    );
    const { route } = idempotentRoute(vi.fn<Handler>(async () => NextResponse.json({ ok: false }, { status })));

    await route(post('{"a":1}'), ctx());

    const fns = db.rpc.mock.calls.map(([fn]) => fn);
    expect(fns).toContain("api_idempotency_release");
    expect(fns).not.toContain("api_idempotency_finish");
    expect(db.rpc.mock.calls.find(([fn]) => fn === "api_idempotency_release")?.[1]).toMatchObject({
      p_attempt_id: "att-2",
    });
  });

  it("422 de regra de negócio fica guardado: a repetição recebe a mesma recusa", async () => {
    const db = fakeDb(baseRow());
    db.rpc.mockImplementation(async (fn) =>
      fn === "api_idempotency_begin"
        ? { data: { outcome: "started", attempt_id: "att-5" }, error: null }
        : { data: null, error: null }
    );
    const body = { ok: false, error: { code: "invalid_transition", message: "Transição não permitida." } };
    const { route } = idempotentRoute(vi.fn<Handler>(async () => NextResponse.json(body, { status: 422 })));

    const response = await route(post('{"a":1}'), ctx());

    expect(response.status).toBe(422);
    const fns = db.rpc.mock.calls.map(([fn]) => fn);
    expect(fns).not.toContain("api_idempotency_release");
    expect(db.rpc.mock.calls.find(([fn]) => fn === "api_idempotency_finish")?.[1]).toMatchObject({
      p_attempt_id: "att-5",
      p_status: 422,
      p_body: body,
    });
  });

  it("422 de chave reusada, vindo do handler, libera a chave: a recusa não toma a chave da requisição dona", async () => {
    const db = fakeDb(baseRow());
    db.rpc.mockImplementation(async (fn) =>
      fn === "api_idempotency_begin"
        ? { data: { outcome: "started", attempt_id: "att-6" }, error: null }
        : { data: null, error: null }
    );
    const body = { ok: false, error: { code: "idempotency_key_reused", message: "Já usada." }, request_id: "r" };
    const { route } = idempotentRoute(vi.fn<Handler>(async () => NextResponse.json(body, { status: 422 })));

    const response = await route(post('{"a":1}'), ctx());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual(body);
    const fns = db.rpc.mock.calls.map(([fn]) => fn);
    expect(fns).not.toContain("api_idempotency_finish");
    expect(db.rpc.mock.calls.find(([fn]) => fn === "api_idempotency_release")?.[1]).toMatchObject({
      p_attempt_id: "att-6",
    });
  });

  it.each([
    ["o código está fora de `error`", { ok: false, code: "idempotency_key_reused" }],
    ["`error` é uma lista", { ok: false, error: ["idempotency_key_reused"] }],
    ["`error` é nulo", { ok: false, error: null }],
    ["o corpo é uma lista", [{ error: { code: "idempotency_key_reused" } }]],
    ["o corpo é nulo", null],
  ])("422 em que %s é guardado como qualquer outro", async (_label, body) => {
    const db = fakeDb(baseRow());
    db.rpc.mockImplementation(async (fn) =>
      fn === "api_idempotency_begin"
        ? { data: { outcome: "started", attempt_id: "att-7" }, error: null }
        : { data: null, error: null }
    );
    const { route } = idempotentRoute(vi.fn<Handler>(async () => NextResponse.json(body, { status: 422 })));

    await route(post('{"a":1}'), ctx());

    expect(db.rpc.mock.calls.map(([fn]) => fn)).toContain("api_idempotency_finish");
  });

  it("exceção no handler libera a chave e responde 500", async () => {
    const db = fakeDb(baseRow());
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.rpc.mockImplementation(async (fn) =>
      fn === "api_idempotency_begin"
        ? { data: { outcome: "started", attempt_id: "att-3" }, error: null }
        : { data: null, error: null }
    );
    const { route } = idempotentRoute(
      vi.fn<Handler>(async () => {
        throw new Error("falhou");
      })
    );

    const response = await route(post('{"a":1}'), ctx());

    expect(response.status).toBe(500);
    expect(db.rpc.mock.calls.map(([fn]) => fn)).toContain("api_idempotency_release");
    errorLog.mockRestore();
  });

  it("lease perdida (P0002 no finish): a resposta vai ao cliente mesmo assim", async () => {
    const db = fakeDb(baseRow());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    db.rpc.mockImplementation(async (fn) =>
      fn === "api_idempotency_begin"
        ? { data: { outcome: "started", attempt_id: "att-4" }, error: null }
        : { data: null, error: { code: "P0002", message: "IDEMPOTENCY_NOT_IN_PROGRESS" } }
    );
    const { route } = idempotentRoute();

    const response = await route(post('{"a":1}'), ctx());

    expect(response.status).toBe(201);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

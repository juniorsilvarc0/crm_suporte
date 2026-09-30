// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock } = vi.hoisted(() => ({ adminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: adminClientMock, hasSupabaseAdminEnv: () => true }));

import { GET as getContact, PATCH as patchContact } from "@/app/api/v1/contacts/[id]/route";
import { GET as listContacts, POST as createContact } from "@/app/api/v1/contacts/route";
import { GET as getContract } from "@/app/api/v1/customers/[id]/contract/route";
import { GET as getCustomer } from "@/app/api/v1/customers/[id]/route";
import { GET as listCustomers } from "@/app/api/v1/customers/route";
import { contactSchema, contractSchema, customerSchema, itemOf, pageOf } from "@/lib/api/v1/cadastros";
import { decodeCursor, encodeCursor } from "@/lib/api/v1/cursor";

// Empresas e contatos da v1 (PR 6b). O banco é um builder falso que grava a
// cadeia de cada `from()`: os testes conferem os FILTROS que chegam ao
// PostgREST, não só a resposta.

type Call = [string, ...unknown[]];
type Result = { data: unknown; error: { message: string; code?: string } | null };
type Responder = (calls: Call[]) => Result;

const CONTACT_ID = "0f8e7d6c-5b4a-4938-8271-605f4e3d2c1b";
const CUSTOMER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

const contactRow = (overrides: Record<string, unknown> = {}) => ({
  id: CONTACT_ID,
  name: "Maria",
  phone: "5527999990000",
  normalized_phone: "27999990000",
  email: null,
  notes: null,
  source: "whatsapp",
  customer_id: null,
  last_message_at: null,
  archived_at: null,
  created_at: "2026-09-01T00:00:00+00:00",
  updated_at: "2026-09-29T12:00:00.123456+00:00",
  ...overrides,
});

const customerRow = (overrides: Record<string, unknown> = {}) => ({
  id: CUSTOMER_ID,
  legal_name: "Padaria Pão Quente LTDA",
  trade_name: "Pão Quente",
  cnpj: "11222333000181",
  contract_status: "ativo",
  notes: null,
  archived_at: null,
  created_at: "2026-09-01T00:00:00+00:00",
  updated_at: "2026-09-29T12:00:00+00:00",
  ...overrides,
});

const contractRow = (overrides: Record<string, unknown> = {}) => ({
  id: "c0000000-0000-4000-8000-000000000001",
  status: "ativo",
  starts_on: "2026-01-01",
  ends_on: null,
  created_at: "2026-01-01T00:00:00+00:00",
  plan: { id: "p1", name: "Ouro", archived_at: null },
  products: [
    { product: { id: "q2", name: "PDV", niche: null, color: "red", archived_at: null } },
    { product: { id: "q1", name: "ERP", niche: "varejo", color: "blue", archived_at: null } },
  ],
  ...overrides,
});

let tables: Record<string, Responder>;
let rpcs: Record<string, (args: Record<string, unknown>) => Result>;
/** Cada `from(tabela)` vira uma cadeia de chamadas aqui. */
let chains: Record<string, Call[][]>;
let rpcCalls: [string, Record<string, unknown>][];
let tokenScopes: string[];

function builder(table: string): unknown {
  const calls: Call[] = [];
  (chains[table] ??= []).push(calls);
  const respond = () => (tables[table] ?? (() => ({ data: null, error: null })))(calls);
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(respond()).then(resolve, reject);
        }
        if (prop === "maybeSingle" || prop === "single") {
          return async () => {
            calls.push([String(prop)]);
            return respond();
          };
        }
        return (...args: unknown[]) => {
          calls.push([String(prop), ...args]);
          return chain;
        };
      },
    }
  );
  return chain;
}

const has = (calls: Call[], ...call: unknown[]) =>
  calls.some((c) => c.length === call.length && c.every((v, i) => Object.is(v, call[i]) || JSON.stringify(v) === JSON.stringify(call[i])));
const lastChain = (table: string) => chains[table]?.at(-1) ?? [];

beforeEach(() => {
  vi.clearAllMocks();
  chains = {};
  rpcCalls = [];
  tokenScopes = ["contacts:read", "contacts:write", "customers:read"];
  tables = {
    api_tokens: () => ({
      data: {
        id: "tok-1",
        name: "IA",
        token_prefix: "crmsuporte_a",
        scopes: tokenScopes,
        actor_type: "ai",
        rate_limit_per_min: 100_000,
        expires_at: null,
        last_used_at: new Date().toISOString(),
      },
      error: null,
    }),
    integration_logs: () => ({ data: null, error: null }),
  };
  rpcs = {
    api_idempotency_begin: () => ({ data: { outcome: "started", attempt_id: "att-1" }, error: null }),
    api_idempotency_finish: () => ({ data: null, error: null }),
    api_idempotency_release: () => ({ data: null, error: null }),
  };
  adminClientMock.mockImplementation(() => ({
    from: (table: string) => builder(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args]);
      return (rpcs[name] ?? (() => ({ data: null, error: { message: `rpc ${name} não mockada` } })))(args);
    },
  }));
});

let ip = 0;
type Handler<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;
function call<P extends object>(
  handler: Handler<P>,
  options: { path?: string; method?: string; body?: unknown; rawBody?: string; params?: P; headers?: Record<string, string> } = {}
) {
  ip += 1;
  const hasBody = options.body !== undefined || options.rawBody !== undefined;
  return handler(
    new Request(`http://crm.test/api/v1${options.path ?? "/x"}`, {
      method: options.method ?? "GET",
      headers: {
        authorization: "Bearer crmsuporte_x",
        "x-forwarded-for": `203.0.113.${ip % 250}`,
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
      body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    }),
    { params: Promise.resolve((options.params ?? {}) as P) }
  );
}

const json = async (response: Response) => response.json();

// ─── GET /contacts ───────────────────────────────────────────────────────────

describe("GET /api/v1/contacts", () => {
  it("responde no schema publicado, só ativos e não anonimizados, em updated_at crescente", async () => {
    tables.contacts = () => ({ data: [contactRow({ search_name: "maria", avatar_key: "x" })], error: null });

    const response = await call(listContacts, { path: "/contacts" });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(pageOf(contactSchema).safeParse(body).success).toBe(true);
    expect(body.meta.next_cursor).toBeNull();
    expect(body.data[0]).not.toHaveProperty("search_name");
    const calls = lastChain("contacts");
    expect(has(calls, "is", "anonymized_at", null)).toBe(true);
    expect(has(calls, "is", "archived_at", null)).toBe(true);
    expect(has(calls, "order", "updated_at", { ascending: true })).toBe(true);
    expect(has(calls, "order", "id", { ascending: true })).toBe(true);
    expect(has(calls, "limit", 51)).toBe(true);
  });

  it("include_archived=true tira só o filtro de arquivado (anonimizado continua fora)", async () => {
    tables.contacts = () => ({ data: [], error: null });

    await call(listContacts, { path: "/contacts?include_archived=true" });

    const calls = lastChain("contacts");
    expect(has(calls, "is", "archived_at", null)).toBe(false);
    expect(has(calls, "is", "anonymized_at", null)).toBe(true);
  });

  it("pagina pelo cursor: next_cursor da última devolvida, e o .or() keyset na volta", async () => {
    const rows = [1, 2, 3].map((n) =>
      contactRow({ id: `${n}f8e7d6c-5b4a-4938-8271-605f4e3d2c1b`, updated_at: `2026-09-29T12:00:0${n}.5+00:00` })
    );
    tables.contacts = () => ({ data: rows, error: null });

    const first = await json(await call(listContacts, { path: "/contacts?limit=2" }));

    expect(first.data).toHaveLength(2);
    expect(decodeCursor(first.meta.next_cursor)).toEqual({ updatedAt: rows[1].updated_at, id: rows[1].id });
    expect(has(lastChain("contacts"), "limit", 3)).toBe(true);

    await call(listContacts, { path: `/contacts?limit=2&cursor=${first.meta.next_cursor}` });

    expect(
      has(
        lastChain("contacts"),
        "or",
        `updated_at.gt.${rows[1].updated_at},and(updated_at.eq.${rows[1].updated_at},id.gt.${rows[1].id})`
      )
    ).toBe(true);
  });

  it("phone: normaliza e procura pelo alias primeiro", async () => {
    tables.contact_phone_identities = () => ({ data: { contact_id: CONTACT_ID }, error: null });
    tables.contacts = () => ({ data: [contactRow()], error: null });

    await call(listContacts, { path: `/contacts?phone=${encodeURIComponent("+55 (27) 99999-0000")}` });

    expect(has(lastChain("contact_phone_identities"), "eq", "normalized_phone", "27999990000")).toBe(true);
    expect(has(lastChain("contacts"), "eq", "id", CONTACT_ID)).toBe(true);
  });

  it("phone sem alias cai na coluna do contato; o GET nunca cria", async () => {
    tables.contact_phone_identities = () => ({ data: null, error: null });
    tables.contacts = (calls) =>
      calls.some(([method]) => method === "maybeSingle")
        ? { data: { id: CONTACT_ID }, error: null }
        : { data: [contactRow()], error: null };

    const body = await json(await call(listContacts, { path: "/contacts?phone=27999990000" }));

    expect(body.data).toHaveLength(1);
    const [lookup, list] = chains.contacts;
    expect(has(lookup, "eq", "normalized_phone", "27999990000")).toBe(true);
    expect(has(list, "eq", "id", CONTACT_ID)).toBe(true);
    expect(rpcCalls.some(([name]) => name === "resolve_contact_identity")).toBe(false);
  });

  it("número sem dono: página vazia, sem consultar a lista", async () => {
    tables.contact_phone_identities = () => ({ data: null, error: null });
    tables.contacts = () => ({ data: null, error: null });

    const body = await json(await call(listContacts, { path: "/contacts?phone=27999990000" }));

    expect(body).toEqual({ ok: true, data: [], meta: { next_cursor: null } });
    expect(chains.contacts).toHaveLength(1);
  });

  it("q vira um ilike por token no search_name; customer_id e updated_since filtram", async () => {
    tables.contacts = () => ({ data: [], error: null });

    await call(listContacts, {
      path: `/contacts?q=${encodeURIComponent("João  Silva")}&customer_id=${CUSTOMER_ID}&updated_since=2026-09-29T09:00:00-03:00`,
    });

    const calls = lastChain("contacts");
    expect(has(calls, "ilike", "search_name", "%joao%")).toBe(true);
    expect(has(calls, "ilike", "search_name", "%silva%")).toBe(true);
    expect(has(calls, "eq", "customer_id", CUSTOMER_ID)).toBe(true);
    expect(has(calls, "gte", "updated_at", "2026-09-29T12:00:00.000Z")).toBe(true);
  });

  it.each([
    ["phone curto", "/contacts?phone=123", "phone"],
    ["customer_id fora de UUID", "/contacts?customer_id=abc", "customer_id"],
    ["cursor adulterado", "/contacts?cursor=lixo", "cursor"],
    ["limit acima do teto", "/contacts?limit=500", "limit"],
    ["parâmetro desconhecido", "/contacts?cnpj=11222333000181", "cnpj"],
    ["chave com nome de Object.prototype", "/contacts?constructor=1", "constructor"],
    ["q de uma letra só (viraria a base inteira)", "/contacts?q=a", "q"],
    ["q só com pontuação", "/contacts?q=%21%21", "q"],
  ])("%s é 400 validation_error no campo, sem consultar", async (_label, path, field) => {
    const response = await call(listContacts, { path });
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("validation_error");
    expect(body.error.fields).toHaveProperty(field);
    expect(chains.contacts).toBeUndefined();
  });

  it("q vazio é 'sem busca': 200, sem ilike", async () => {
    tables.contacts = () => ({ data: [], error: null });

    expect((await call(listContacts, { path: "/contacts?q=" })).status).toBe(200);
    expect(lastChain("contacts").some(([method]) => method === "ilike")).toBe(false);
  });

  it("leitura que falhou é 503, nunca lista vazia", async () => {
    tables.contacts = () => ({ data: null, error: { message: "boom" } });

    const response = await call(listContacts, { path: "/contacts" });

    expect(response.status).toBe(503);
    expect((await json(response)).error.code).toBe("unavailable");
  });

  it("alias que falhou também é 503", async () => {
    tables.contact_phone_identities = () => ({ data: null, error: { message: "boom" } });

    expect((await call(listContacts, { path: "/contacts?phone=27999990000" })).status).toBe(503);
  });

  it("exige contacts:read (contacts:write sozinho não lê)", async () => {
    tokenScopes = ["contacts:write", "customers:read"];

    const response = await call(listContacts, { path: "/contacts" });

    expect(response.status).toBe(403);
    expect((await json(response)).error.required).toEqual(["contacts:read"]);
    expect(chains.contacts).toBeUndefined();
  });

  it("o curinga contacts:* lê", async () => {
    tokenScopes = ["contacts:*"];
    tables.contacts = () => ({ data: [], error: null });

    expect((await call(listContacts, { path: "/contacts" })).status).toBe(200);
  });
});

// ─── POST /contacts ──────────────────────────────────────────────────────────

describe("POST /api/v1/contacts", () => {
  const post = (body: unknown, headers: Record<string, string> = { "idempotency-key": "chave-0001" }) =>
    call(createContact, { path: "/contacts", method: "POST", body, headers });

  beforeEach(() => {
    rpcs.resolve_contact_identity = () => ({
      data: { contactId: CONTACT_ID, normalizedPhone: "27999990000", created: true },
      error: null,
    });
    tables.contacts = () => ({ data: contactRow({ source: "api" }), error: null });
  });

  it("cria com source api, sem reativar, e responde 201 no schema publicado", async () => {
    const response = await post({ phone: "+55 27 99999-0000", name: "Maria" });
    const body = await json(response);

    expect(response.status).toBe(201);
    expect(itemOf(contactSchema).safeParse(body).success).toBe(true);
    const resolve = rpcCalls.find(([name]) => name === "resolve_contact_identity");
    // Só os dígitos, DDI incluso (como o WhatsApp grava); a RPC normaliza.
    expect(resolve?.[1]).toMatchObject({
      p_phone: "5527999990000",
      p_source: "api",
      p_reactivate: false,
      p_name: "Maria",
    });
    expect(has(lastChain("contacts"), "is", "anonymized_at", null)).toBe(true);
    expect(rpcCalls.map(([name]) => name)).toContain("api_idempotency_finish");
  });

  it("telefone que já existe (arquivado) volta 200 como está, sem desarquivar", async () => {
    rpcs.resolve_contact_identity = () => ({
      data: { contactId: CONTACT_ID, normalizedPhone: "27999990000", created: false },
      error: null,
    });
    tables.contacts = () => ({ data: contactRow({ archived_at: "2026-09-10T00:00:00+00:00" }), error: null });

    const response = await post({ phone: "27999990000" });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.data.archived_at).toBe("2026-09-10T00:00:00+00:00");
    expect(rpcCalls.find(([name]) => name === "resolve_contact_identity")?.[1].p_reactivate).toBe(false);
  });

  it("sem Idempotency-Key é 400 e a RPC nem é chamada", async () => {
    const response = await post({ phone: "27999990000" }, {});

    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("idempotency_key_required");
    expect(rpcCalls).toEqual([]);
  });

  it.each([
    ["telefone inválido", { phone: "123" }, "phone"],
    ["sem telefone", { name: "Maria" }, "phone"],
    ["nome vazio", { phone: "27999990000", name: "   " }, "name"],
    ["campo fora do contrato", { phone: "27999990000", email: "a@b.co" }, "email"],
    ["nome com NUL (o text do Postgres recusa)", { phone: "27999990000", name: "Ana\u0000" }, "name"],
    ["corpo que não é objeto", [], "body"],
  ])("%s é 400 no campo, sem criar, e a chave é liberada", async (_label, body, field) => {
    const response = await post(body);
    const payload = await json(response);

    expect(response.status).toBe(400);
    expect(payload.error.fields).toHaveProperty(field);
    expect(rpcCalls.map(([name]) => name)).not.toContain("resolve_contact_identity");
    expect(rpcCalls.map(([name]) => name)).toContain("api_idempotency_release");
  });

  it("JSON inválido é 400 invalid_json", async () => {
    const response = await call(createContact, {
      path: "/contacts",
      method: "POST",
      rawBody: "{",
      headers: { "idempotency-key": "chave-0002" },
    });

    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("invalid_json");
  });

  it("valor que o banco recusou (classe 22) é 400, não 500", async () => {
    rpcs.resolve_contact_identity = () => ({ data: null, error: { message: "invalid byte sequence", code: "22P05" } });

    const response = await post({ phone: "27999990000" });

    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("validation_error");
  });

  it("número que é alias de outra pessoa é 409 phone_conflict", async () => {
    rpcs.resolve_contact_identity = () => ({ data: null, error: { message: "contact_phone_identity_conflict", code: "23505" } });

    const response = await post({ phone: "27999990000" });

    expect(response.status).toBe(409);
    expect((await json(response)).error.code).toBe("phone_conflict");
  });

  it("contato anonimizado não volta: 409 contact_anonymized", async () => {
    rpcs.resolve_contact_identity = () => ({
      data: { contactId: CONTACT_ID, normalizedPhone: "27999990000", created: false },
      error: null,
    });
    tables.contacts = () => ({ data: null, error: null });

    const response = await post({ phone: "27999990000" });

    expect(response.status).toBe(409);
    expect((await json(response)).error.code).toBe("contact_anonymized");
  });

  it("falha da RPC é 500 com request_id, sem vazar a mensagem do banco", async () => {
    rpcs.resolve_contact_identity = () => ({ data: null, error: { message: "segredo do banco", code: "XX000" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await post({ phone: "27999990000" });
    const body = await json(response);

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("segredo do banco");
    spy.mockRestore();
  });

  it("repetição com a mesma chave devolve a resposta guardada, sem chamar a RPC", async () => {
    rpcs.api_idempotency_begin = () => ({
      data: { outcome: "replay", status: 201, body: { ok: true, data: contactRow() } },
      error: null,
    });

    const response = await post({ phone: "27999990000" });

    expect(response.status).toBe(201);
    expect(response.headers.get("Idempotent-Replayed")).toBe("true");
    expect(rpcCalls.map(([name]) => name)).not.toContain("resolve_contact_identity");
  });

  it("exige contacts:write", async () => {
    tokenScopes = ["contacts:read"];

    const response = await post({ phone: "27999990000" });

    expect(response.status).toBe(403);
    expect(rpcCalls).toEqual([]);
  });
});

// ─── GET/PATCH /contacts/{id} ────────────────────────────────────────────────

describe("GET /api/v1/contacts/{id}", () => {
  it("devolve o contato no schema publicado, sem anonimizado", async () => {
    tables.contacts = () => ({ data: contactRow(), error: null });

    const response = await call(getContact, { params: { id: CONTACT_ID } });

    expect(response.status).toBe(200);
    expect(itemOf(contactSchema).safeParse(await json(response)).success).toBe(true);
    expect(has(lastChain("contacts"), "eq", "id", CONTACT_ID)).toBe(true);
    expect(has(lastChain("contacts"), "is", "anonymized_at", null)).toBe(true);
  });

  it("inexistente é 404; id fora de UUID é 404 sem consultar", async () => {
    tables.contacts = () => ({ data: null, error: null });

    expect((await call(getContact, { params: { id: CONTACT_ID } })).status).toBe(404);
    chains = {};
    const response = await call(getContact, { params: { id: "abc" } });
    expect(response.status).toBe(404);
    expect((await json(response)).error.code).toBe("not_found");
    expect(chains.contacts).toBeUndefined();
  });

  it("leitura que falhou é 503", async () => {
    tables.contacts = () => ({ data: null, error: { message: "boom" } });

    expect((await call(getContact, { params: { id: CONTACT_ID } })).status).toBe(503);
  });
});

describe("PATCH /api/v1/contacts/{id}", () => {
  const patch = (body: unknown, id = CONTACT_ID) =>
    call(patchContact, { method: "PATCH", body, params: { id } });
  const updateArg = () => lastChain("contacts").find(([method]) => method === "update")?.[1];

  beforeEach(() => {
    tables.contacts = () => ({ data: contactRow({ name: "Maria Souza" }), error: null });
  });

  it("altera só o que veio e devolve o contato no schema publicado", async () => {
    const response = await patch({ name: "Maria Souza", customer_id: CUSTOMER_ID });

    expect(response.status).toBe(200);
    expect(itemOf(contactSchema).safeParse(await json(response)).success).toBe(true);
    expect(updateArg()).toEqual({ name: "Maria Souza", customer_id: CUSTOMER_ID });
    expect(has(lastChain("contacts"), "eq", "id", CONTACT_ID)).toBe(true);
    expect(has(lastChain("contacts"), "is", "anonymized_at", null)).toBe(true);
  });

  it("null limpa", async () => {
    await patch({ email: null, customer_id: null });

    expect(updateArg()).toEqual({ email: null, customer_id: null });
  });

  it("telefone no corpo é 422 phone_immutable, sem gravar", async () => {
    const response = await patch({ phone: "27988887777", name: "x" });
    const body = await json(response);

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({ code: "phone_immutable", fields: { phone: expect.any(String) } });
    expect(chains.contacts).toBeUndefined();
  });

  it.each([
    ["nada para alterar", {}, null],
    ["chave desconhecida", { nome: "x" }, "nome"],
    ["e-mail inválido", { email: "maria" }, "email"],
    ["nome vazio", { name: "" }, "name"],
    ["observação longa", { notes: "x".repeat(2001) }, "notes"],
    ["empresa fora de UUID", { customer_id: "abc" }, "customer_id"],
    ["corpo que não é objeto", [1], "body"],
    ["NUL nas observações", { notes: "linha\u0000" }, "notes"],
    ["surrogate solto no nome", { name: "x\ud800y" }, "name"],
    ["chave com nome de Object.prototype", { toString: 1 }, "toString"],
  ])("%s é 400 validation_error, sem gravar", async (_label, body, field) => {
    const response = await patch(body);
    const payload = await json(response);

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("validation_error");
    if (field) expect(payload.error.fields).toHaveProperty(field);
    expect(chains.contacts).toBeUndefined();
  });

  it.each([
    ["arquivada (trigger)", { message: "CUSTOMER_ARCHIVED" }],
    ["inexistente (FK)", { message: 'violates foreign key constraint "contacts_customer_id_fkey"', code: "23503" }],
  ])("empresa %s é 422 invalid_customer no campo", async (_label, error) => {
    tables.contacts = () => ({ data: null, error });

    const response = await patch({ customer_id: CUSTOMER_ID });
    const body = await json(response);

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({ code: "invalid_customer", fields: { customer_id: expect.any(String) } });
  });

  it.each([null, [1], "x", 42])("corpo %j que não é objeto: a mensagem é em português", async (body) => {
    const payload = await json(await patch(body));

    expect(payload.error.fields).toEqual({ body: "Envie um objeto JSON." });
  });

  it("valor que o banco recusou pelo tipo é 400, não 500", async () => {
    tables.contacts = () => ({ data: null, error: { message: "invalid input syntax", code: "22P02" } });

    const response = await patch({ name: "x" });

    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("validation_error");
  });

  it("outro erro do banco é 500, sem a mensagem do banco", async () => {
    tables.contacts = () => ({ data: null, error: { message: "segredo do banco", code: "XX000" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await patch({ name: "x" });

    expect(response.status).toBe(500);
    expect(JSON.stringify(await json(response))).not.toContain("segredo do banco");
    spy.mockRestore();
  });

  it("inexistente ou anonimizado é 404; id fora de UUID também", async () => {
    tables.contacts = () => ({ data: null, error: null });

    expect((await patch({ name: "x" })).status).toBe(404);
    chains = {};
    expect((await patch({ name: "x" }, "abc")).status).toBe(404);
    expect(chains.contacts).toBeUndefined();
  });

  it("exige contacts:write", async () => {
    tokenScopes = ["contacts:read"];

    expect((await patch({ name: "x" })).status).toBe(403);
    expect(chains.contacts).toBeUndefined();
  });
});

// ─── Empresas ────────────────────────────────────────────────────────────────

describe("GET /api/v1/customers", () => {
  it("responde no schema publicado, só ativas, em updated_at crescente", async () => {
    tables.customers = () => ({ data: [customerRow({ search_name: "pao", created_by_user_id: "u1" })], error: null });

    const response = await call(listCustomers, { path: "/customers" });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(pageOf(customerSchema).safeParse(body).success).toBe(true);
    expect(body.data[0]).not.toHaveProperty("created_by_user_id");
    const calls = lastChain("customers");
    expect(has(calls, "is", "archived_at", null)).toBe(true);
    expect(has(calls, "order", "updated_at", { ascending: true })).toBe(true);
    expect(has(calls, "order", "id", { ascending: true })).toBe(true);
  });

  it("cnpj com máscara vira igualdade exata sem máscara", async () => {
    tables.customers = () => ({ data: [], error: null });

    await call(listCustomers, { path: `/customers?cnpj=${encodeURIComponent("11.222.333/0001-81")}` });

    expect(has(lastChain("customers"), "eq", "cnpj", "11222333000181")).toBe(true);
  });

  it("cnpj com dígito verificador errado é 400 no campo, sem consultar", async () => {
    const response = await call(listCustomers, { path: "/customers?cnpj=11222333000182" });

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields).toHaveProperty("cnpj");
    expect(chains.customers).toBeUndefined();
  });

  it("selo desconhecido vira null; include_archived tira o filtro", async () => {
    tables.customers = () => ({ data: [customerRow({ contract_status: "outro" })], error: null });

    const body = await json(await call(listCustomers, { path: "/customers?include_archived=true" }));

    expect(body.data[0].contract_status).toBeNull();
    expect(has(lastChain("customers"), "is", "archived_at", null)).toBe(false);
  });

  it("q busca por token; o cursor vira o .or() keyset", async () => {
    tables.customers = () => ({ data: [], error: null });
    const cursor = encodeCursor({ updated_at: "2026-09-29T12:00:00+00:00", id: CUSTOMER_ID });

    await call(listCustomers, { path: `/customers?q=padaria&cursor=${cursor}` });

    const calls = lastChain("customers");
    expect(has(calls, "ilike", "search_name", "%padaria%")).toBe(true);
    expect(calls.some(([method]) => method === "or")).toBe(true);
  });

  it("q de uma letra só é 400 no campo, sem consultar", async () => {
    const response = await call(listCustomers, { path: "/customers?q=x" });

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields).toHaveProperty("q");
    expect(chains.customers).toBeUndefined();
  });

  it("phone não é filtro de empresa: 400 no campo", async () => {
    const response = await call(listCustomers, { path: "/customers?phone=27999990000" });

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields).toHaveProperty("phone");
  });

  it("leitura que falhou é 503", async () => {
    tables.customers = () => ({ data: null, error: { message: "boom" } });

    expect((await call(listCustomers, { path: "/customers" })).status).toBe(503);
  });

  it("exige customers:read", async () => {
    tokenScopes = ["contacts:read"];

    expect((await call(listCustomers, { path: "/customers" })).status).toBe(403);
    expect(chains.customers).toBeUndefined();
  });
});

describe("GET /api/v1/customers/{id}", () => {
  it("devolve a empresa, arquivada inclusive, no schema publicado", async () => {
    tables.customers = () => ({ data: customerRow({ archived_at: "2026-09-20T00:00:00+00:00" }), error: null });

    const response = await call(getCustomer, { params: { id: CUSTOMER_ID } });

    expect(response.status).toBe(200);
    expect(itemOf(customerSchema).safeParse(await json(response)).success).toBe(true);
    expect(has(lastChain("customers"), "is", "archived_at", null)).toBe(false);
  });

  it("inexistente é 404; falha é 503", async () => {
    tables.customers = () => ({ data: null, error: null });
    const missing = await call(getCustomer, { params: { id: CUSTOMER_ID } });
    expect(missing.status).toBe(404);
    expect((await json(missing)).error.message).toBe("Empresa não encontrada.");

    tables.customers = () => ({ data: null, error: { message: "boom" } });
    expect((await call(getCustomer, { params: { id: CUSTOMER_ID } })).status).toBe(503);
  });

  it("id fora de UUID é 404 sem consultar", async () => {
    const response = await call(getCustomer, { params: { id: "abc" } });

    expect(response.status).toBe(404);
    expect((await json(response)).error.code).toBe("not_found");
    expect(chains.customers).toBeUndefined();
  });
});

describe("GET /api/v1/customers/{id}/contract", () => {
  beforeEach(() => {
    tables.customers = () => ({ data: { id: CUSTOMER_ID }, error: null });
  });

  it("o vigente, sem valor, cor nem dia de vencimento, no schema publicado", async () => {
    // Na ordem do banco (ends_on desc, nulos primeiro): o encerrado sem término
    // vem antes, e mesmo assim o vigente vence.
    tables.support_contracts = () => ({
      data: [
        contractRow({ id: "velho", status: "encerrado", ends_on: null }),
        contractRow({ status: "suspenso", ends_on: "2027-01-01", billing_day: 10, monthly_amount: 999 }),
      ],
      error: null,
    });

    const response = await call(getContract, { params: { id: CUSTOMER_ID } });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(itemOf(contractSchema).safeParse(body).success).toBe(true);
    expect(body.data).toMatchObject({ status: "suspenso", plan: { id: "p1", name: "Ouro" } });
    expect(body.data.products).toEqual([
      { id: "q1", name: "ERP" },
      { id: "q2", name: "PDV" },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/billing_day|monthly_amount|color/);
  });

  it("uma consulta só (um snapshot), na ordem do selo", async () => {
    tables.support_contracts = () => ({ data: [], error: null });

    await call(getContract, { params: { id: CUSTOMER_ID } });

    expect(chains.support_contracts).toHaveLength(1);
    const calls = lastChain("support_contracts");
    expect(has(calls, "eq", "customer_id", CUSTOMER_ID)).toBe(true);
    expect(has(calls, "order", "ends_on", { ascending: false, nullsFirst: true })).toBe(true);
    expect(has(calls, "order", "created_at", { ascending: false })).toBe(true);
  });

  it("sem vigente, o primeiro encerrado na ordem do banco (a regra do selo)", async () => {
    tables.support_contracts = () => ({
      data: [
        contractRow({ id: "recente", status: "encerrado", ends_on: "2026-06-30" }),
        contractRow({ id: "antigo", status: "encerrado", ends_on: "2025-12-31" }),
      ],
      error: null,
    });

    const body = await json(await call(getContract, { params: { id: CUSTOMER_ID } }));

    expect(body.data).toMatchObject({ id: "recente", status: "encerrado" });
  });

  it("empresa que nunca teve contrato: data null", async () => {
    tables.support_contracts = () => ({ data: [], error: null });

    const response = await call(getContract, { params: { id: CUSTOMER_ID } });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: null });
  });

  it("empresa inexistente é 404; id fora de UUID é 404 sem consultar", async () => {
    tables.customers = () => ({ data: null, error: null });
    tables.support_contracts = () => ({ data: [], error: null });

    expect((await call(getContract, { params: { id: CUSTOMER_ID } })).status).toBe(404);
    chains = {};
    expect((await call(getContract, { params: { id: "abc" } })).status).toBe(404);
    expect(chains.customers).toBeUndefined();
    expect(chains.support_contracts).toBeUndefined();
  });

  it.each([
    ["dos contratos", "support_contracts"],
    ["da empresa", "customers"],
  ])("leitura %s que falhou é 503, nunca 'sem contrato' nem 404", async (_label, table) => {
    tables.support_contracts = () => ({ data: [], error: null });
    tables[table] = () => ({ data: null, error: { message: "boom" } });

    const response = await call(getContract, { params: { id: CUSTOMER_ID } });

    expect(response.status).toBe(503);
    expect((await json(response)).error.code).toBe("unavailable");
  });

  it("situação fora do vocabulário é 503, nunca 'sem contrato'", async () => {
    tables.support_contracts = () => ({ data: [contractRow({ status: "outro" })], error: null });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await call(getContract, { params: { id: CUSTOMER_ID } })).status).toBe(503);
    spy.mockRestore();
  });

  it("exige customers:read", async () => {
    tokenScopes = ["contacts:read"];

    expect((await call(getContract, { params: { id: CUSTOMER_ID } })).status).toBe(403);
    expect(chains.support_contracts).toBeUndefined();
  });
});

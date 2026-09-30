// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock } = vi.hoisted(() => ({ adminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: adminClientMock, hasSupabaseAdminEnv: () => true }));

import { GET as getContext } from "@/app/api/v1/context/route";
import { itemOf } from "@/lib/api/v1/cadastros";
import { triageContextSchema } from "@/lib/api/v1/context";

import { createHarness, has, where } from "./test-harness";

// GET /api/v1/context (PR 7, D11), com o Supabase falso de test-harness.ts.
// O responder de cada tabela olha a cadeia para saber QUAL consulta é.

const CONTACT_ID = "0f8e7d6c-5b4a-4938-8271-605f4e3d2c1b";
const CUSTOMER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CONVERSATION_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const PAST = "2026-01-01T00:00:00+00:00";
const FUTURE = "2099-01-01T00:00:00+00:00";

const contactRow = (overrides: Record<string, unknown> = {}) => ({
  id: CONTACT_ID,
  name: "Maria",
  phone: "5527999990000",
  normalized_phone: "27999990000",
  email: null,
  notes: null,
  source: "whatsapp",
  customer_id: CUSTOMER_ID,
  last_message_at: PAST,
  archived_at: null,
  created_at: PAST,
  updated_at: PAST,
  ...overrides,
});

const customerRow = {
  id: CUSTOMER_ID,
  legal_name: "Padaria LTDA",
  trade_name: "Padaria",
  cnpj: null,
  contract_status: "ativo",
  notes: null,
  archived_at: null,
  created_at: PAST,
  updated_at: PAST,
};

const contractRow = (status: string) => ({
  id: "c0000000-0000-4000-8000-000000000001",
  status,
  starts_on: "2026-01-01",
  ends_on: null,
  created_at: PAST,
  plan: { id: "p1", name: "Ouro", archived_at: null },
  products: [{ product: { id: "q1", name: "ERP", niche: null, color: "blue", archived_at: null } }],
});

const conversationRow = (status = "bot") => ({
  id: CONVERSATION_ID,
  status,
  active_ticket_id: "t1",
  last_message_at: PAST,
  archived_at: null,
  created_at: PAST,
});

const ticketRow = (overrides: Record<string, unknown> = {}) => ({
  id: "t1",
  number: 101,
  title: "Nota não sai",
  status: "em_atendimento",
  priority: "alta",
  version: 3,
  source: "ai",
  conversation_id: CONVERSATION_ID,
  is_terminal: false,
  reopened_count: 0,
  sla_mode: "running",
  sla_first_response_minutes: 30,
  sla_resolution_minutes: 240,
  sla_warn_pct: 80,
  first_response_due_at: FUTURE,
  resolution_due_at: FUTURE,
  first_responded_at: PAST,
  sla_paused_at: null,
  resolved_at: null,
  closed_at: null,
  next_due_at: FUTURE,
  last_inbound_at: PAST,
  replied_after_resolve: false,
  created_at: PAST,
  updated_at: PAST,
  customer: null,
  contact: { id: CONTACT_ID, name: "Maria", phone: "5527999990000" },
  product: { id: "q1", name: "ERP", color: "blue" },
  assignee: { id: "u1", name: "Ana", avatar_color: "blue", avatar_url: null },
  ...overrides,
});

const messageRow = (id: string, created_at: string, overrides: Record<string, unknown> = {}) => ({
  id,
  direction: "inbound",
  sender_type: "contact",
  type: "text",
  content: `mensagem ${id}`,
  media_mime_type: null,
  is_deleted: false,
  delivery_status: "delivered",
  ticket_id: "t1",
  quoted_message_id: null,
  created_at,
  ...overrides,
});

const h = createHarness(adminClientMock);

beforeEach(() => {
  vi.clearAllMocks();
  h.reset(["context:read"]);
  Object.assign(h.tables, {
    contact_phone_identities: () => ({ data: { contact_id: CONTACT_ID }, error: null }),
    contacts: () => ({ data: contactRow(), error: null }),
    customers: () => ({ data: customerRow, error: null }),
    support_contracts: () => ({ data: [contractRow("ativo")], error: null }),
    chat_conversations: (calls) =>
      where(calls, "contact_id", CONTACT_ID)
        ? { data: conversationRow(), error: null }
        : { data: { active_ticket_id: "t1" }, error: null },
    ticket_queue: (calls) =>
      where(calls, "is_terminal", true)
        ? {
            data: [ticketRow({ id: "t0", number: 90, status: "fechado", is_terminal: true, sla_mode: "stopped", next_due_at: null, closed_at: PAST })],
            error: null,
          }
        : { data: [ticketRow()], error: null },
    ticket_status_transitions: () => ({
      data: [
        { from_status: "em_atendimento", to_status: "resolvido" },
        { from_status: "em_atendimento", to_status: "aguardando_cliente" },
        { from_status: "novo", to_status: "em_triagem" },
      ],
      error: null,
    }),
    // O banco entrega da mais nova para a mais antiga (desc).
    chat_messages: () => ({
      data: [messageRow("m2", "2026-01-01T00:02:00+00:00"), messageRow("m1", "2026-01-01T00:01:00+00:00")],
      error: null,
    }),
  } satisfies typeof h.tables);
});

function call(path = "/context?phone=5527999990000") {
  return getContext(h.request(path), { params: Promise.resolve({}) });
}

const body = async (path?: string) => (await call(path)).json();

describe("GET /api/v1/context", () => {
  it("contexto completo, no schema publicado no OpenAPI", async () => {
    const response = await call();
    const payload = await response.json();

    expect(response.status).toBe(200);
    const parsed = itemOf(triageContextSchema).safeParse(payload);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(payload.data).toMatchObject({
      contact: { id: CONTACT_ID },
      customer: { id: CUSTOMER_ID },
      contract: { status: "ativo", plan: { id: "p1", name: "Ouro" }, products: [{ id: "q1", name: "ERP" }] },
      contract_alert: null,
      conversation: { id: CONVERSATION_ID, status: "bot", active_ticket_id: "t1" },
      open_tickets_truncated: false,
      ai_may_reply: true,
    });
    // Cada parte lida pela entidade CERTA: a empresa e o contrato do contato,
    // os tickets da conversa escolhida.
    expect(where(h.chains.customers[0], "id", CUSTOMER_ID)).toBe(true);
    expect(where(h.chains.support_contracts[0], "customer_id", CUSTOMER_ID)).toBe(true);
    const open = h.chains.ticket_queue.find((calls) => where(calls, "is_terminal", false)) ?? [];
    expect(where(open, "conversation_id", CONVERSATION_ID)).toBe(true);
  });

  it("a conversa é a mais recente do contato (sem mensagem ainda fica por último)", async () => {
    await call();

    const conversation = h.chains.chat_conversations.find((calls) => where(calls, "contact_id", CONTACT_ID)) ?? [];
    expect(has(conversation, "order", "last_message_at", { ascending: false, nullsFirst: false })).toBe(true);
    expect(has(conversation, "order", "created_at", { ascending: false })).toBe(true);
    expect(has(conversation, "limit", 1)).toBe(true);
  });

  it("acha pelo alias exato, com o telefone normalizado (sem o 55 e sem máscara)", async () => {
    await call(`/context?phone=${encodeURIComponent("+55 (27) 99999-0000")}`);

    expect(where(h.chains.contact_phone_identities[0], "normalized_phone", "27999990000")).toBe(true);
  });

  it("telefone desconhecido: 200 com contact null e o resto vazio (D11), sem criar nada", async () => {
    h.tables.contact_phone_identities = () => ({ data: null, error: null });
    h.tables.contacts = () => ({ data: null, error: null });

    const response = await call();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual({
      contact: null,
      customer: null,
      contract: null,
      contract_alert: "sem_empresa",
      conversation: null,
      open_tickets: [],
      open_tickets_truncated: false,
      recent_tickets: [],
      messages: [],
      ai_may_reply: false,
    });
    expect(itemOf(triageContextSchema).safeParse(payload).success).toBe(true);
    expect(h.chains.chat_conversations).toBeUndefined();
  });

  it("contato anonimizado é tratado como desconhecido", async () => {
    h.tables.contacts = () => ({ data: null, error: null });

    const payload = await body();

    expect(payload.data.contact).toBeNull();
    expect(has(h.chains.contacts[0], "is", "anonymized_at", null)).toBe(true);
  });

  it("só lê: nenhuma escrita em tabela nenhuma (não zera as não lidas)", async () => {
    await call();

    for (const [table, list] of Object.entries(h.chains)) {
      if (table === "integration_logs") continue;
      for (const calls of list) {
        expect(
          calls.some(([method]) => ["insert", "update", "upsert", "delete"].includes(method)),
          `${table} escreveu`
        ).toBe(false);
      }
    }
  });

  it("mensagens: as 20 últimas sem nota interna, da mais antiga para a mais nova", async () => {
    const payload = await body();

    expect(payload.data.messages.map((m: { id: string }) => m.id)).toEqual(["m1", "m2"]);
    const [messages] = h.chains.chat_messages;
    expect(where(messages, "conversation_id", CONVERSATION_ID)).toBe(true);
    expect(has(messages, "neq", "type", "note")).toBe(true);
    expect(has(messages, "order", "created_at", { ascending: false })).toBe(true);
    // Desempate: mensagens da mesma transação têm o mesmo created_at.
    expect(has(messages, "order", "id", { ascending: false })).toBe(true);
    expect(has(messages, "limit", 20)).toBe(true);
  });

  it("tickets abertos da conversa com as transições permitidas; últimos encerrados do contato", async () => {
    const payload = await body();

    expect(payload.data.open_tickets).toHaveLength(1);
    expect(payload.data.open_tickets[0]).toMatchObject({
      id: "t1",
      number: 101,
      allowed_transitions: ["aguardando_cliente", "resolvido"],
      product: { id: "q1", name: "ERP" },
      assignee: { id: "u1", name: "Ana" },
    });
    expect(payload.data.open_tickets[0].assignee).not.toHaveProperty("avatar_color");
    expect(payload.data.recent_tickets).toMatchObject([{ id: "t0", status: "fechado" }]);
    expect(payload.data.recent_tickets[0]).not.toHaveProperty("allowed_transitions");
    const recent = h.chains.ticket_queue.find((calls) => where(calls, "is_terminal", true)) ?? [];
    expect(where(recent, "contact_id", CONTACT_ID)).toBe(true);
    expect(has(recent, "limit", 5)).toBe(true);
    // Pelo encerramento: updated_at muda quando um analista é excluído.
    expect(has(recent, "order", "closed_at", { ascending: false })).toBe(true);
    expect(has(recent, "order", "number", { ascending: false })).toBe(true);
  });

  it("SLA calculado pela regra da view: prazo de 1ª resposta vencido sem resposta = breached", async () => {
    h.tables.ticket_queue = (calls) =>
      where(calls, "is_terminal", true)
        ? { data: [], error: null }
        : { data: [ticketRow({ first_response_due_at: PAST, first_responded_at: null })], error: null };

    const payload = await body();

    expect(payload.data.open_tickets[0].sla).toMatchObject({ breached: true, first_responded_at: null });
  });

  it("matriz de transições indisponível: allowed_transitions null (nunca []), o resto sai", async () => {
    h.tables.ticket_status_transitions = () => ({ data: null, error: { message: "boom" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await call();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.open_tickets[0].allowed_transitions).toBeNull();
    spy.mockRestore();
  });

  it("mais de 20 tickets abertos: open_tickets_truncated avisa o corte", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ticketRow({ id: index === 0 ? "t1" : `t${index + 1}`, number: 200 + index }));
    h.tables.ticket_queue = (calls) => (where(calls, "is_terminal", true) ? { data: [], error: null } : { data: rows, error: null });

    const payload = await body();

    expect(payload.data.open_tickets).toHaveLength(20);
    expect(payload.data.open_tickets_truncated).toBe(true);
  });

  it.each([
    ["destino desconhecido", { from_status: "em_atendimento", to_status: "arquivado" }],
    ["origem desconhecida", { from_status: "arquivado", to_status: "resolvido" }],
  ])("matriz com status %s: allowed_transitions null, nunca uma lista parcial", async (_label, bad) => {
    h.tables.ticket_status_transitions = () => ({
      data: [{ from_status: "em_atendimento", to_status: "resolvido" }, bad],
      error: null,
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await call();

    expect(response.status).toBe(200);
    expect((await response.json()).data.open_tickets[0].allowed_transitions).toBeNull();
    spy.mockRestore();
  });

  it.each([
    ["humano assumiu", "human"],
    ["encerrada", "resolved"],
  ])("conversa %s: ai_may_reply false", async (_label, status) => {
    h.tables.chat_conversations = (calls) =>
      where(calls, "contact_id", CONTACT_ID)
        ? { data: conversationRow(status), error: null }
        : { data: { active_ticket_id: null }, error: null };

    expect((await body()).data.ai_may_reply).toBe(false);
  });

  it("sem conversa: sem mensagens nem tickets abertos, e a IA não responde", async () => {
    h.tables.chat_conversations = () => ({ data: null, error: null });

    const payload = await body();

    expect(payload.data).toMatchObject({ conversation: null, messages: [], open_tickets: [], ai_may_reply: false });
    expect(h.chains.chat_messages).toBeUndefined();
  });

  it("contato sem empresa: alerta sem_empresa, sem consultar empresa nem contrato", async () => {
    h.tables.contacts = () => ({ data: contactRow({ customer_id: null }), error: null });

    const payload = await body();

    expect(payload.data).toMatchObject({ customer: null, contract: null, contract_alert: "sem_empresa" });
    expect(h.chains.customers).toBeUndefined();
    expect(h.chains.support_contracts).toBeUndefined();
  });

  it.each([
    ["nunca teve contrato", [], "sem_contrato"],
    ["contrato suspenso", [contractRow("suspenso")], "suspenso"],
    ["só contrato encerrado", [contractRow("encerrado")], "encerrado"],
  ])("empresa com %s: alerta %s", async (_label, rows, alert) => {
    h.tables.support_contracts = () => ({ data: rows, error: null });

    expect((await body()).data.contract_alert).toBe(alert);
  });

  it.each([
    ["o alias", "contact_phone_identities"],
    ["o contato", "contacts"],
    ["a conversa", "chat_conversations"],
    ["a empresa", "customers"],
    ["o contrato", "support_contracts"],
    ["as mensagens", "chat_messages"],
  ])("leitura d%s que falhou é 503 inteiro, nunca contexto pela metade", async (_label, table) => {
    h.tables[table] = () => ({ data: null, error: { message: "boom" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await call();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("unavailable");
    expect(payload).not.toHaveProperty("data");
    spy.mockRestore();
  });

  it.each([
    ["dos tickets encerrados do contato", true],
    ["dos tickets abertos da conversa", false],
  ])("leitura %s que falhou é 503", async (_label, terminal) => {
    const base = h.tables.ticket_queue;
    h.tables.ticket_queue = (calls) =>
      where(calls, "is_terminal", terminal) ? { data: null, error: { message: "boom" } } : base(calls);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await call()).status).toBe(503);
    spy.mockRestore();
  });

  it("empresa do contato que some entre as leituras é 503, não 'sem empresa'", async () => {
    h.tables.customers = () => ({ data: null, error: null });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await call()).status).toBe(503);
    spy.mockRestore();
  });

  it("mensagem fora do vocabulário do banco é 503, não some", async () => {
    h.tables.chat_messages = () => ({ data: [messageRow("m1", PAST, { sender_type: "robo" })], error: null });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await call()).status).toBe(503);
    spy.mockRestore();
  });

  it.each([
    ["sem telefone", "/context", "phone"],
    ["telefone curto", "/context?phone=123", "phone"],
    ["parâmetro desconhecido", "/context?phone=27999990000&contact_id=x", "contact_id"],
  ])("%s é 400 no campo, sem consultar", async (_label, path, field) => {
    const response = await call(path);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.fields).toHaveProperty(field);
    expect(h.chains.contact_phone_identities).toBeUndefined();
  });

  it("exige context:read (contacts:read sozinho não basta)", async () => {
    h.scopes = ["contacts:read", "customers:read"];

    const response = await call();

    expect(response.status).toBe(403);
    expect((await response.json()).error.required).toEqual(["context:read"]);
    expect(h.chains.contact_phone_identities).toBeUndefined();
  });
});

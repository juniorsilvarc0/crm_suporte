// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signMock } = vi.hoisted(() => ({ signMock: vi.fn() }));
vi.mock("@/lib/storage/chat-media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/chat-media")>()),
  signStorageObject: signMock,
}));

import { createHarness, where } from "@/app/api/v1/test-harness";
import {
  buildRelayFields,
  relayEnvelope,
  relayFieldsSchema,
  type RelayMessage,
} from "@/features/integrations/server/relay-envelope";
import { CONTACT_API_SELECT, CUSTOMER_API_SELECT } from "@/lib/api/v1/cadastros";

// O envelope do relay v1: o que o CRM lê para montar os campos, e o que sai no
// corpo. O Supabase é o falso de test-harness.ts, que grava os filtros de cada
// consulta.

const CONTACT_ID = "0f8e7d6c-5b4a-4938-8271-605f4e3d2c1b";
const CUSTOMER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CONVERSATION_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const MESSAGE_ID = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f";
const PAST = "2026-01-01T00:00:00+00:00";
const FUTURE = "2099-01-01T00:00:00+00:00";
const NOW = new Date("2026-10-01T12:00:00Z");
const SIGNED_URL = "https://crm.exemplo.com/storage/v1/object/sign/chat-media/chat/abc.jpg?token=assinatura";

/** O contato como o contrato o publica. */
const contactDto = (overrides: Record<string, unknown> = {}) => ({
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

// A linha do banco tem MAIS do que o contrato: o que está a mais não pode sair.
const contactRow = (overrides: Record<string, unknown> = {}) => ({
  ...contactDto(overrides),
  search_name: "maria",
  avatar_bucket: "chat-media",
  avatar_key: "avatars/foto.jpg",
  anonymized_at: null,
});

const customerDto = {
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

const customerRow = { ...customerDto, search_name: "padaria ltda", created_by_user_id: "u9" };

const contractRow = (status: string) => ({
  id: "c0000000-0000-4000-8000-000000000001",
  status,
  starts_on: "2026-01-01",
  ends_on: status === "encerrado" ? "2026-06-30" : null,
  created_at: PAST,
  plan: { id: "p1", name: "Ouro", archived_at: null },
  products: [{ product: { id: "q1", name: "ERP", niche: null, color: "blue", archived_at: null } }],
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

// O envelope real da uazapi (raiz conferida no OpenAPI dela), com ids fictícios.
const payload = {
  BaseUrl: "https://inst.uazapi.test",
  EventType: "messages",
  instanceName: "suporte",
  owner: "5511900000000",
  token: "token-da-instancia",
  chat: { name: "Maria" },
  message: {
    messageid: "WA-IN-1",
    chatid: "5527999990000@s.whatsapp.net",
    fromMe: false,
    messageType: "Conversation",
    text: "O sistema voltou a travar",
  },
};

const adminClientMock = vi.fn();
const h = createHarness(adminClientMock);
let supabase: Parameters<typeof buildRelayFields>[0];

const message = (overrides: Partial<RelayMessage> = {}): RelayMessage => ({
  payload,
  conversationId: CONVERSATION_ID,
  contactId: CONTACT_ID,
  messageId: MESSAGE_ID,
  media: null,
  ...overrides,
});

const build = (overrides: Partial<RelayMessage> = {}) => buildRelayFields(supabase, message(overrides), NOW);

/** A linha da conversa que o envelope lê: o status e o foco, juntos. */
const conversation = (status: string, activeTicketId: string | null = "t1") => () => ({
  data: { status, active_ticket_id: activeTicketId },
  error: null,
});

afterEach(() => {
  // Um espião de console que ficou para trás calaria o resto do arquivo.
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  h.reset([]);
  Object.assign(h.tables, {
    contacts: () => ({ data: contactRow(), error: null }),
    customers: () => ({ data: customerRow, error: null }),
    support_contracts: () => ({ data: [contractRow("ativo")], error: null }),
    chat_conversations: conversation("bot"),
    ticket_queue: () => ({ data: ticketRow(), error: null }),
  } satisfies typeof h.tables);
  supabase = adminClientMock();
  signMock.mockResolvedValue(SIGNED_URL);
});

describe("buildRelayFields", () => {
  it("monta os campos do CRM no schema do contrato, com o contato, a empresa, o contrato e o ticket em foco", async () => {
    const fields = await build();

    expect(relayFieldsSchema.safeParse(fields).error?.issues ?? []).toEqual([]);
    expect(fields).toMatchObject({
      relay_version: 1,
      conversation_id: CONVERSATION_ID,
      conversation_status: "bot",
      message_id: MESSAGE_ID,
      contact: { id: CONTACT_ID, name: "Maria", normalized_phone: "27999990000", customer_id: CUSTOMER_ID },
      customer: { id: CUSTOMER_ID, legal_name: "Padaria LTDA", contract_status: "ativo" },
      contract: { status: "ativo", alert: null },
      active_ticket: {
        id: "t1",
        number: 101,
        status: "em_atendimento",
        priority: "alta",
        version: 3,
        product: { id: "q1", name: "ERP" },
        assignee: { id: "u1", name: "Ana" },
        sla: { breached: false },
      },
      media_url: null,
    });
    // Exatamente os campos do contrato: nada a mais sai na raiz.
    expect(Object.keys(fields).sort()).toEqual(Object.keys(relayFieldsSchema.shape).sort());
  });

  it("o contato e a empresa saem só com os campos do contrato, mesmo que o banco devolva mais", async () => {
    const fields = await build();

    expect(fields.contact).toEqual(contactDto());
    expect(fields.customer).toEqual(customerDto);
    expect(JSON.stringify(fields)).not.toMatch(/search_name|avatar_key|avatar_bucket|anonymized_at|created_by_user_id/);
  });

  it("lê cada parte pela entidade certa, com as colunas do contrato e nenhum filtro a mais ou a menos", async () => {
    await build();

    // A consulta INTEIRA de cada leitura: coluna a mais vazaria ao agente, e
    // filtro a mais (arquivado, por exemplo) faria o repasse falhar sem motivo.
    expect(h.chains.chat_conversations).toEqual([
      [["select", "status, active_ticket_id"], ["eq", "id", CONVERSATION_ID], ["maybeSingle"]],
    ]);
    expect(h.chains.contacts).toEqual([
      [["select", CONTACT_API_SELECT], ["eq", "id", CONTACT_ID], ["is", "anonymized_at", null], ["maybeSingle"]],
    ]);
    expect(h.chains.customers).toEqual([[["select", CUSTOMER_API_SELECT], ["eq", "id", CUSTOMER_ID], ["maybeSingle"]]]);
    expect(where(h.chains.support_contracts[0], "customer_id", CUSTOMER_ID)).toBe(true);
    // Um ticket, o do foco, com os filtros do invariante: desta conversa e não terminal.
    expect(h.chains.ticket_queue).toHaveLength(1);
    expect(h.chains.ticket_queue[0].slice(1)).toEqual([
      ["eq", "id", "t1"],
      ["eq", "conversation_id", CONVERSATION_ID],
      ["eq", "is_terminal", false],
      ["maybeSingle"],
    ]);
    expect(h.chains.ticket_queue[0][0][0]).toBe("select");
  });

  it("só lê: nenhuma escrita em tabela nenhuma", async () => {
    await build();

    const writes = Object.values(h.chains)
      .flat(2)
      .filter(([method]) => ["insert", "update", "upsert", "delete"].includes(method));
    expect(writes).toEqual([]);
    expect(h.rpcCalls).toEqual([]);
  });

  it.each(["human", "resolved"])("leva o status que a conversa tem AGORA (%s), sem supor `bot`", async (status) => {
    h.tables.chat_conversations = conversation(status);

    const fields = await build();

    expect(fields.conversation_status).toBe(status);
  });

  it.each(["", "paused", "BOT"])("status desconhecido (%j) derruba o envelope: nunca vira `bot`", async (status) => {
    h.tables.chat_conversations = conversation(status);

    await expect(build()).rejects.toThrow("chat_conversations: status inesperado");
  });

  it("contato sem empresa: customer null, alerta `sem_empresa`, e nada é lido de empresa nem de contrato", async () => {
    h.tables.contacts = () => ({ data: contactRow({ customer_id: null }), error: null });

    const fields = await build();

    expect(fields.customer).toBeNull();
    expect(fields.contract).toEqual({ status: null, alert: "sem_empresa" });
    expect(h.chains.customers).toBeUndefined();
    expect(h.chains.support_contracts).toBeUndefined();
    // O ticket em foco não depende da empresa.
    expect(fields.active_ticket).toMatchObject({ id: "t1" });
  });

  it("empresa que nunca teve contrato: status null e alerta `sem_contrato`", async () => {
    h.tables.support_contracts = () => ({ data: [], error: null });

    const fields = await build();

    expect(fields.customer).toMatchObject({ id: CUSTOMER_ID });
    expect(fields.contract).toEqual({ status: null, alert: "sem_contrato" });
  });

  it.each(["suspenso", "encerrado"])("contrato %s: o status e o alerta dizem o mesmo", async (status) => {
    h.tables.support_contracts = () => ({ data: [contractRow(status)], error: null });

    const fields = await build();

    expect(fields.contract).toEqual({ status, alert: status });
  });

  it("o ticket do envelope é o que a conversa tem em foco", async () => {
    h.tables.chat_conversations = conversation("bot", "t2");
    h.tables.ticket_queue = (calls) =>
      where(calls, "id", "t2")
        ? { data: ticketRow({ id: "t2", number: 102, title: "Boleto" }), error: null }
        : { data: ticketRow(), error: null };

    const fields = await build();

    expect(fields.active_ticket).toMatchObject({ id: "t2", number: 102 });
  });

  it("conversa sem foco: active_ticket null, sem ler ticket nenhum", async () => {
    h.tables.chat_conversations = conversation("bot", null);

    const fields = await build();

    expect(fields.active_ticket).toBeNull();
    expect(h.chains.ticket_queue).toBeUndefined();
  });

  it("foco que terminou entre as leituras: active_ticket null", async () => {
    // Com os filtros do invariante, o ticket já terminal não volta.
    h.tables.ticket_queue = () => ({ data: null, error: null });

    const fields = await build();

    expect(fields.active_ticket).toBeNull();
    expect(fields.contact.id).toBe(CONTACT_ID);
  });

  it("o SLA do ticket é calculado no instante do repasse", async () => {
    const dueSoon = "2026-10-01T12:30:00+00:00";
    h.tables.ticket_queue = () => ({
      data: ticketRow({ first_responded_at: null, first_response_due_at: dueSoon, next_due_at: dueSoon }),
      error: null,
    });

    const before = await build();
    const after = await buildRelayFields(supabase, message(), new Date("2026-10-01T13:00:00Z"));

    expect(before.active_ticket?.sla.breached).toBe(false);
    expect(after.active_ticket?.sla.breached).toBe(true);
  });

  describe("tudo ou nada: leitura que falha derruba o envelope", () => {
    const failing = { data: null, error: { message: "timeout" } };

    it.each([
      ["chat_conversations", "chat_conversations: timeout"],
      ["contacts", "contacts: timeout"],
      ["customers", "customers: timeout"],
      ["support_contracts", "support_contracts: timeout"],
      ["ticket_queue", "ticket_queue: timeout"],
    ])("%s", async (table, expected) => {
      h.tables[table] = () => failing;

      await expect(build()).rejects.toThrow(expected);
    });

    it("conversa que não é achada é falha, não um status suposto", async () => {
      h.tables.chat_conversations = () => ({ data: null, error: null });

      await expect(build()).rejects.toThrow("chat_conversations: conversa não encontrada");
    });

    it("contato que não é achado é falha: a mensagem acabou de ser gravada para ele", async () => {
      h.tables.contacts = () => ({ data: null, error: null });

      await expect(build()).rejects.toThrow("contacts: contato da conversa não encontrado");
    });

    it("empresa que sumiu entre as leituras é falha, não `sem empresa`", async () => {
      h.tables.customers = () => ({ data: null, error: null });

      await expect(build()).rejects.toThrow("customers: empresa do contato não encontrada");
    });

    it("ticket em foco fora do formato esperado é falha, não `sem ticket`", async () => {
      h.tables.ticket_queue = () => ({ data: ticketRow({ status: "inexistente" }), error: null });

      await expect(build()).rejects.toThrow("ticket_queue: linha inesperada");
    });
  });

  describe("mídia", () => {
    // Um bucket que não é o padrão: o que vale é o da mídia, não uma constante.
    const media = { bucket: "outro-bucket", key: "chat/2026/10/abc.jpg" };

    it("assina por 10 minutos a mídia DESTA mensagem, no bucket dela", async () => {
      const fields = await build({ media });

      expect(fields.media_url).toBe(SIGNED_URL);
      expect(signMock).toHaveBeenCalledTimes(1);
      expect(signMock).toHaveBeenCalledWith(supabase, "outro-bucket", "chat/2026/10/abc.jpg", 600);
    });

    it("mensagem sem mídia não assina nada, e não é uma falha", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const fields = await build();

      expect(fields.media_url).toBeNull();
      expect(signMock).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("storage que não assina: a mensagem segue, com media_url null", async () => {
      signMock.mockResolvedValue(null);

      const fields = await build({ media });

      expect(fields.media_url).toBeNull();
      expect(fields.contact.id).toBe(CONTACT_ID);
    });

    it("storage que lança: a mensagem segue, com media_url null, e fica o aviso", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const failure = new Error("storage fora");
      signMock.mockRejectedValue(failure);

      const fields = await build({ media });

      expect(fields.media_url).toBeNull();
      expect(fields.active_ticket).toMatchObject({ id: "t1" });
      expect(warn).toHaveBeenCalledWith("[relay] assinar a mídia falhou:", failure);
      warn.mockRestore();
    });
  });
});

describe("relayEnvelope", () => {
  const crmKeys = Object.keys(relayFieldsSchema.shape);
  const withoutToken = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "token"));

  it("o payload da uazapi sem o token, mais os campos do CRM na raiz", async () => {
    const crm = await build();

    const body = relayEnvelope(payload, crm);

    expect(body).toEqual({ ...withoutToken, ...crm });
    expect(body).not.toHaveProperty("token");
    expect(JSON.stringify(body)).not.toContain("token-da-instancia");
  });

  it("não mexe no payload recebido: o webhook segue com ele", async () => {
    const original = structuredClone(payload);

    relayEnvelope(payload, await build());

    expect(payload).toEqual(original);
    expect(payload.token).toBe("token-da-instancia");
  });

  it("os campos do CRM vencem: chave do provedor com o mesmo nome não se passa por eles", async () => {
    h.tables.chat_conversations = conversation("human");
    const crm = await build();
    const forged = {
      ...payload,
      relay_version: 99,
      conversation_status: "bot",
      conversation_id: "outra-conversa",
      message_id: "outra-mensagem",
      contact: { id: "outro" },
      customer: { id: "outra" },
      contract: { status: "ativo", alert: null },
      active_ticket: { id: "outro" },
      media_url: "https://evil.example/x",
    };

    const body = relayEnvelope(forged, crm);

    for (const key of crmKeys) {
      expect(body[key], key).toEqual(crm[key as keyof typeof crm]);
    }
    expect(body.conversation_status).toBe("human");
    expect(body).toEqual({ ...withoutToken, ...crm });
  });

  it("chave do provedor que só difere na caixa ou no espaço não passa: há leitor de JSON que as confunde", async () => {
    h.tables.chat_conversations = conversation("human");
    const crm = await build();
    const forged = {
      // A chave exata primeiro fixaria o campo do CRM no começo do corpo...
      conversation_status: "bot",
      ...payload,
      // ...e as variantes viriam depois dele: um leitor que ignora caixa ficaria com a última.
      Conversation_Status: "bot",
      CONVERSATION_STATUS: "bot",
      "conversation_status ": "bot",
      " Relay_Version": 99,
      Media_URL: "https://evil.example/x",
      Token: "token-da-instancia",
      " TOKEN ": "token-da-instancia",
    };

    const body = relayEnvelope(forged, crm);

    expect(body).toEqual({ ...withoutToken, ...crm });
    expect(JSON.stringify(body)).not.toContain("token-da-instancia");
    expect(JSON.stringify(body).toLowerCase().match(/conversation_status/g)).toHaveLength(1);
  });

  it("os campos do CRM vão no fim do corpo, depois de tudo o que veio do provedor", async () => {
    const crm = await build();

    const body = relayEnvelope({ conversation_status: "bot", ...payload } as typeof payload, crm);

    expect(Object.keys(body).slice(-crmKeys.length)).toEqual(Object.keys(crm));
    expect(Object.keys(body).slice(0, -crmKeys.length)).toEqual(Object.keys(withoutToken));
  });

  it("chave do provedor que não colide segue como veio, na caixa dela", async () => {
    const crm = await build();

    const body = relayEnvelope({ ...payload, Owner: "x", chatSource: "live", Contacts: [] } as typeof payload, crm);

    expect(body).toMatchObject({ Owner: "x", chatSource: "live", Contacts: [], owner: "5511900000000" });
  });

  it("`__proto__` no payload segue como chave comum, sem trocar o protótipo de nada", async () => {
    h.tables.chat_conversations = conversation("human");
    const crm = await build();
    const hostile = JSON.parse(`{"__proto__":{"conversation_status":"bot","polluted":true},"EventType":"messages"}`);

    const body = relayEnvelope(hostile, crm);

    expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(body.conversation_status).toBe("human");
    expect(Object.prototype.hasOwnProperty.call(body, "__proto__")).toBe(true);
    expect(JSON.parse(JSON.stringify(body)).conversation_status).toBe("human");
  });
});

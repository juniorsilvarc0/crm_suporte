import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

import { compareTimelineItems } from "@/features/tickets/lib/ticket-timeline";
import {
  getTicketTimeline,
  TIMELINE_ATTACHMENT_SELECT,
  TIMELINE_COMMENT_SELECT,
  TIMELINE_EVENT_SELECT,
  TIMELINE_MESSAGE_SELECT,
  TIMELINE_STATUS_SELECT,
} from "@/features/tickets/queries/get-ticket-timeline";
import type { TicketTimelinePage } from "@/features/tickets/types";

const TICKET = "11111111-1111-4111-8111-111111111111";
const OTHER_TICKET = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

type Row = Record<string, unknown>;
type Call = [method: string, ...args: unknown[]];

// Instantes gerados a partir de microssegundos inteiros, no texto que o
// PostgREST devolve (fração sem zeros à direita, ou nenhuma). O banco falso
// compara pelo número guardado aqui, sem usar o comparador que está em teste.
const MICROS = new Map<string, number>();
const BASE_MS = Date.UTC(2026, 8, 25, 12, 0, 0);

function iso(micros: number): string {
  const seconds = Math.floor(micros / 1_000_000);
  const fraction = micros % 1_000_000;
  const clock = new Date(BASE_MS + seconds * 1000).toISOString().slice(0, 19);
  const text = fraction
    ? `${clock}.${String(fraction).padStart(6, "0").replace(/0+$/, "")}+00:00`
    : `${clock}+00:00`;
  MICROS.set(text, micros);
  return text;
}

function microsOf(value: unknown): number {
  const micros = typeof value === "string" ? MICROS.get(value) : undefined;
  if (micros === undefined) throw new Error(`instante fora do banco falso: ${String(value)}`);
  return micros;
}

// PostgREST falso: aplica de verdade eq, lt, order e limit sobre as linhas de
// cada tabela, e grava as chamadas. Linhas levam colunas que a query NÃO pode
// repassar (actor_token_id, object_key, media_url…): o teste confere que não saem.
const INSTANT_COLUMNS = new Set(["occurred_at", "created_at"]);
let db: Record<string, Row[]>;
let failing: Set<string>;
let calls: { table: string; calls: Call[] }[];

function fakeFrom(table: string) {
  const recorded: Call[] = [];
  calls.push({ table, calls: recorded });
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "lt", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      recorded.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(execute(table, recorded)).then(resolve, reject);
  return builder;
}

function execute(table: string, recorded: Call[]) {
  if (failing.has(table)) return { data: null, error: { message: `${table} indisponível` } };

  let rows = [...(db[table] ?? [])];
  const orders: [string, boolean][] = [];
  let limit = Infinity;
  for (const [method, column, value] of recorded) {
    if (method === "eq") rows = rows.filter((row) => row[column as string] === value);
    if (method === "lt") rows = rows.filter((row) => microsOf(row[column as string]) < microsOf(value));
    if (method === "order") orders.push([column as string, (value as { ascending: boolean }).ascending]);
    if (method === "limit") limit = column as number;
  }
  rows.sort((a, b) => {
    for (const [column, ascending] of orders) {
      const left = INSTANT_COLUMNS.has(column) ? microsOf(a[column]) : a[column];
      const right = INSTANT_COLUMNS.has(column) ? microsOf(b[column]) : b[column];
      if (left === right) continue;
      const sign = (left as number | string) < (right as number | string) ? -1 : 1;
      return ascending ? sign : -sign;
    }
    return 0;
  });
  return { data: rows.slice(0, limit), error: null };
}

let seq = 0;
let uid = 0;
const nextId = (prefix: string) => `${prefix}-${String(++uid).padStart(5, "0")}`;

const statusRow = (micros: number, overrides: Row = {}): Row => ({
  id: nextId("status"),
  ticket_id: TICKET,
  from_status: "novo",
  to_status: "em_atendimento",
  actor_type: "agent",
  actor_user_id: USER,
  actor_token_id: null,
  reason: null,
  occurred_at: iso(micros),
  seq: ++seq,
  ...overrides,
});

const eventRow = (micros: number, overrides: Row = {}): Row => ({
  id: nextId("event"),
  ticket_id: TICKET,
  event_type: "ticket.assigned",
  actor_type: "agent",
  actor_user_id: USER,
  actor_token_id: null,
  event_key: null,
  metadata: { from: null, to: USER },
  occurred_at: iso(micros),
  seq: ++seq,
  ...overrides,
});

const commentRow = (micros: number, overrides: Row = {}): Row => ({
  id: nextId("comment"),
  ticket_id: TICKET,
  author_user_id: USER,
  author_token_id: null,
  body: "Pedi o print do erro.",
  created_at: iso(micros),
  edited_at: null,
  deleted_at: null,
  ...overrides,
});

const messageRow = (micros: number, overrides: Row = {}): Row => ({
  id: nextId("message"),
  ticket_id: TICKET,
  conversation_id: "conv-1",
  external_id: "wamid-1",
  direction: "inbound",
  sender_type: "contact",
  type: "text",
  content: "O sistema travou na emissão.",
  media_url: "/api/chat/media/x",
  media_key: "chat/x",
  file_name: null,
  delivery_status: "delivered",
  sent_by_user_id: null,
  is_deleted: false,
  created_at: iso(micros),
  ...overrides,
});

const attachmentRow = (micros: number, overrides: Row = {}): Row => ({
  id: nextId("attachment"),
  ticket_id: TICKET,
  bucket: "ticket-attachments",
  object_key: `tickets/${TICKET}/x`,
  sha256: "0".repeat(64),
  file_name: "erro.png",
  mime: "image/png",
  size_bytes: 2048,
  uploaded_by_user_id: USER,
  uploaded_by_token_id: null,
  created_at: iso(micros),
  ...overrides,
});

function seed(rows: {
  status?: Row[];
  events?: Row[];
  comments?: Row[];
  messages?: Row[];
  attachments?: Row[];
}) {
  db = {
    ticket_status_history: rows.status ?? [],
    ticket_events: rows.events ?? [],
    ticket_comments: rows.comments ?? [],
    chat_messages: rows.messages ?? [],
    ticket_attachments: rows.attachments ?? [],
  };
}

const callsOf = (table: string) => calls.filter((entry) => entry.table === table).map((entry) => entry.calls);

// Pagina como a tela faria, até acabar. Guarda cada página para as asserções.
async function readAll(): Promise<TicketTimelinePage[]> {
  const pages: TicketTimelinePage[] = [];
  let before: string | undefined;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = await getTicketTimeline(TICKET, before ? { before } : {});
    pages.push(page);
    if (!page.hasMore) return pages;
    expect(page.nextBefore).not.toBeNull();
    before = page.nextBefore ?? undefined;
  }
  throw new Error("paginação não terminou");
}

// O que nenhuma paginação pode quebrar: todo item uma vez só, cada página do
// mais novo para o mais antigo, e nenhum instante dividido entre páginas.
function expectLosslessPaging(pages: TicketTimelinePage[], totalRows: number) {
  const all = pages.flatMap((page) => page.items);
  expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
  expect(all).toHaveLength(totalRows);
  for (let i = 1; i < all.length; i += 1) {
    expect(compareTimelineItems(all[i - 1], all[i])).toBeGreaterThan(0);
  }
  const seen = new Map<number, number>();
  pages.forEach((page, index) => {
    for (const item of page.items) {
      const micros = microsOf(item.at);
      expect(seen.get(micros) ?? index).toBe(index);
      seen.set(micros, index);
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fromMock.mockImplementation(fakeFrom);
  failing = new Set();
  calls = [];
  seq = 0;
  uid = 0;
  seed({});
});

describe("getTicketTimeline: leitura", () => {
  it("lê as cinco fontes do ticket, na ordem dos índices, até 100 cada", async () => {
    await getTicketTimeline(TICKET);

    expect(callsOf("ticket_status_history")).toEqual([
      [
        ["select", TIMELINE_STATUS_SELECT],
        ["eq", "ticket_id", TICKET],
        ["order", "occurred_at", { ascending: false }],
        ["order", "seq", { ascending: false }],
        ["limit", 100],
      ],
    ]);
    expect(callsOf("ticket_events")).toEqual([
      [
        ["select", TIMELINE_EVENT_SELECT],
        ["eq", "ticket_id", TICKET],
        ["order", "occurred_at", { ascending: false }],
        ["order", "seq", { ascending: false }],
        ["limit", 100],
      ],
    ]);
    for (const [table, select] of [
      ["ticket_comments", TIMELINE_COMMENT_SELECT],
      ["chat_messages", TIMELINE_MESSAGE_SELECT],
      ["ticket_attachments", TIMELINE_ATTACHMENT_SELECT],
    ]) {
      expect(callsOf(table)).toEqual([
        [
          ["select", select],
          ["eq", "ticket_id", TICKET],
          ["order", "created_at", { ascending: false }],
          ["order", "id", { ascending: false }],
          ["limit", 100],
        ],
      ]);
    }
  });

  it("com before, filtra cada fonte por instante estritamente anterior", async () => {
    const before = "2026-09-26T02:45:57.194405+00:00";

    await getTicketTimeline(TICKET, { before });

    for (const table of ["ticket_status_history", "ticket_events"]) {
      expect(callsOf(table)[0]).toContainEqual(["lt", "occurred_at", before]);
    }
    for (const table of ["ticket_comments", "chat_messages", "ticket_attachments"]) {
      expect(callsOf(table)[0]).toContainEqual(["lt", "created_at", before]);
    }
  });

  it("before fora do formato: RangeError sem ir ao banco", async () => {
    await expect(getTicketTimeline(TICKET, { before: "2026-09-26 02:45:57+00" })).rejects.toThrow(
      RangeError
    );
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("os selects são explícitos e não pedem o que não sai do servidor", () => {
    const selects = [
      TIMELINE_STATUS_SELECT,
      TIMELINE_EVENT_SELECT,
      TIMELINE_COMMENT_SELECT,
      TIMELINE_MESSAGE_SELECT,
      TIMELINE_ATTACHMENT_SELECT,
    ];
    for (const select of selects) {
      expect(select).not.toMatch(
        /\*|actor_token_id|event_key|object_key|bucket|sha256|media_|external_id|ai_triage|idempotency_key/
      );
    }
    // Do metadata da mensagem, só o nome do arquivo.
    expect(TIMELINE_MESSAGE_SELECT).toContain("file_name:metadata->>fileName");
    expect(TIMELINE_MESSAGE_SELECT.replace("metadata->>fileName", "")).not.toContain("metadata");
  });
});

describe("getTicketTimeline: união", () => {
  it("junta as fontes do mais novo para o mais antigo, campo a campo", async () => {
    // Mesmo instante (5 s): a mensagem chegou, a nota foi escrita, o anexo
    // subiu, e a trilha registrou status e evento na ordem do seq.
    seed({
      messages: [messageRow(5_000_000, { id: "m" }), messageRow(1_000_000, { id: "m-old" })],
      comments: [commentRow(5_000_000, { id: "c" })],
      attachments: [attachmentRow(5_000_000, { id: "a" })],
      status: [statusRow(5_000_000, { id: "s", seq: 20 })],
      events: [eventRow(5_000_000, { id: "e", seq: 21 }), eventRow(9_000_000, { id: "e-new" })],
    });

    const page = await getTicketTimeline(TICKET);

    expect(page.items.map((item) => item.id)).toEqual(["e-new", "e", "s", "a", "c", "m", "m-old"]);
    expect(page.hasMore).toBe(false);
    expect(page.nextBefore).toBeNull();
    expect(page.items.find((item) => item.id === "m")).toEqual({
      kind: "message",
      id: "m",
      at: iso(5_000_000),
      direction: "inbound",
      sender_type: "contact",
      type: "text",
      content: "O sistema travou na emissão.",
      file_name: null,
      delivery_status: "delivered",
      sent_by_user_id: null,
      is_deleted: false,
    });
    expect(page.items.find((item) => item.id === "a")).toEqual({
      kind: "attachment",
      id: "a",
      at: iso(5_000_000),
      file_name: "erro.png",
      mime: "image/png",
      size_bytes: 2048,
      uploaded_by_user_id: USER,
      uploaded_by_token_id: null,
    });
    expect(page.items.find((item) => item.id === "e")).toEqual({
      kind: "event",
      id: "e",
      at: iso(5_000_000),
      seq: 21,
      event_type: "ticket.assigned",
      actor_type: "agent",
      actor_user_id: USER,
      metadata: { from: null, to: USER },
    });
  });

  it("só lê o que é deste ticket", async () => {
    seed({ messages: [messageRow(1, { id: "mine" }), messageRow(2, { ticket_id: OTHER_TICKET })] });

    const page = await getTicketTimeline(TICKET);

    expect(page.items.map((item) => item.id)).toEqual(["mine"]);
  });

  it("comentário e mensagem apagados continuam, sem o conteúdo", async () => {
    seed({
      comments: [commentRow(2, { id: "c", body: null, deleted_at: iso(3) })],
      messages: [messageRow(1, { id: "m", content: null, is_deleted: true })],
    });

    const page = await getTicketTimeline(TICKET);

    expect(page.items).toEqual([
      expect.objectContaining({ kind: "comment", id: "c", body: null, deleted_at: iso(3) }),
      expect.objectContaining({ kind: "message", id: "m", content: null, is_deleted: true }),
    ]);
  });

  it("nota no chat e nome do arquivo da mídia vêm na mensagem", async () => {
    seed({
      messages: [
        messageRow(2, {
          id: "note",
          direction: "outbound",
          sender_type: "agent",
          type: "note",
          sent_by_user_id: USER,
        }),
        messageRow(1, { id: "doc", type: "document", content: null, file_name: "boleto.pdf" }),
      ],
    });

    const page = await getTicketTimeline(TICKET);

    expect(page.items).toEqual([
      expect.objectContaining({ id: "note", type: "note", sent_by_user_id: USER }),
      expect.objectContaining({ id: "doc", type: "document", file_name: "boleto.pdf" }),
    ]);
  });
});

describe("getTicketTimeline: paginação sem perda", () => {
  it("fonte no limite: a página para antes do piso, e as seguintes trazem o resto", async () => {
    // 150 mensagens (a cada 10 µs) enchem o limite de 100 da 1ª leitura. Os
    // comentários e a trilha caem ENTRE elas e também no mesmo instante delas;
    // um par status+evento divide o instante com uma mensagem.
    const messages = Array.from({ length: 150 }, (_, i) => messageRow(1_000_000 + i * 10));
    const comments = Array.from({ length: 30 }, (_, i) =>
      commentRow(1_000_000 + i * 50 + (i % 2 ? 0 : 5))
    );
    const status = [statusRow(1_000_990), statusRow(1_001_000)];
    const events = [eventRow(1_001_000), eventRow(1_000_000)];
    const attachments = [attachmentRow(999_999), attachmentRow(1_001_490)];
    seed({ messages, comments, status, events, attachments });

    const pages = await readAll();

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.items.length <= 100)).toBe(true);
    expectLosslessPaging(pages, 150 + 30 + 2 + 2 + 2);
    expect(pages.at(-1)?.hasMore).toBe(false);
    expect(pages.at(-1)?.nextBefore).toBeNull();
  });

  it("instantes repetidos em todas as fontes nunca são divididos", async () => {
    // 12 instantes, cada um com vários itens de várias fontes: 360 itens.
    const rows: Required<Parameters<typeof seed>[0]> = {
      status: [],
      events: [],
      comments: [],
      messages: [],
      attachments: [],
    };
    for (let t = 0; t < 12; t += 1) {
      const micros = 2_000_000 + t * 7;
      for (let k = 0; k < 10; k += 1) rows.messages.push(messageRow(micros));
      for (let k = 0; k < 8; k += 1) rows.comments.push(commentRow(micros));
      for (let k = 0; k < 4; k += 1) rows.attachments.push(attachmentRow(micros));
      for (let k = 0; k < 4; k += 1) {
        rows.status.push(statusRow(micros));
        rows.events.push(eventRow(micros));
      }
    }
    seed(rows);

    const pages = await readAll();

    expectLosslessPaging(pages, 12 * 30);
  });

  it("álbum com mais de 100 mensagens no mesmo instante: relê só essa fonte e entrega o instante inteiro", async () => {
    const album = Array.from({ length: 130 }, () => messageRow(5_000_000));
    seed({
      messages: [...album, messageRow(4_000_000, { id: "m-old" })],
      comments: [commentRow(5_000_000, { id: "c-same" }), commentRow(3_000_000, { id: "c-old" })],
    });

    const first = await getTicketTimeline(TICKET);

    expect(first.items).toHaveLength(131);
    expect(first.items[0].id).toBe("c-same");
    expect(first.hasMore).toBe(true);
    expect(first.nextBefore).toBe(iso(5_000_000));
    // 5 leituras + a releitura só de chat_messages, até 1000.
    expect(fromMock).toHaveBeenCalledTimes(6);
    expect(callsOf("chat_messages").map((recorded) => recorded.at(-1))).toEqual([
      ["limit", 100],
      ["limit", 1000],
    ]);

    const second = await getTicketTimeline(TICKET, { before: first.nextBefore ?? undefined });
    expect(second.items.map((item) => item.id)).toEqual(["m-old", "c-old"]);
    expect(second.hasMore).toBe(false);
  });

  it("mais de 1000 no mesmo instante: falha explícita, sem página parcial", async () => {
    seed({ messages: Array.from({ length: 1001 }, () => messageRow(5_000_000)) });

    await expect(getTicketTimeline(TICKET)).rejects.toThrow(/mesmo instante/);
  });
});

describe("getTicketTimeline: falha", () => {
  it.each(["ticket_status_history", "ticket_events", "ticket_comments", "chat_messages", "ticket_attachments"])(
    "%s falhou: a timeline inteira falha",
    async (table) => {
      seed({ messages: [messageRow(1)], status: [statusRow(2)] });
      failing.add(table);

      await expect(getTicketTimeline(TICKET)).rejects.toThrow(`${table} failed`);
    }
  );

  it.each<[string, Parameters<typeof seed>[0]]>([
    ["sender_type fora do check", { messages: [messageRow(1, { sender_type: "bot" })] }],
    ["type fora do check", { messages: [messageRow(1, { type: "poll" })] }],
    ["status desconhecido", { status: [statusRow(1, { to_status: "pendente" })] }],
    ["actor_type desconhecido", { events: [eventRow(1, { actor_type: "robot" })] }],
    ["metadata que não é objeto", { events: [eventRow(1, { metadata: ["x"] })] }],
    ["seq que não é inteiro", { status: [statusRow(1, { seq: "12" })] }],
    ["instante fora do formato", { comments: [{ ...commentRow(1), created_at: "ontem" }] }],
  ])("%s: lança em vez de entregar um tipo que mente", async (_label, rows) => {
    seed(rows);

    await expect(getTicketTimeline(TICKET)).rejects.toThrow(/valor inesperado/);
  });
});

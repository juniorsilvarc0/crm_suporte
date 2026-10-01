// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock, putMock, removeMock, signMock, timelineMock } = vi.hoisted(() => ({
  adminClientMock: vi.fn(),
  putMock: vi.fn(),
  removeMock: vi.fn(),
  signMock: vi.fn(),
  timelineMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: adminClientMock, hasSupabaseAdminEnv: () => true }));
vi.mock("@/lib/storage/ticket-attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/ticket-attachments")>()),
  // Teto pequeno: o 413 sem montar um arquivo de 50 MB no teste.
  TICKET_ATTACHMENT_MAX_BYTES: 16,
  putTicketAttachment: putMock,
  removeTicketAttachment: removeMock,
  signTicketAttachment: signMock,
}));
vi.mock("@/features/tickets/queries/get-ticket-timeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/tickets/queries/get-ticket-timeline")>()),
  getTicketTimeline: timelineMock,
}));

import { GET as getAttachmentLink } from "@/app/api/v1/tickets/[ref]/attachments/[attachment_id]/route";
import { POST as postAttachment } from "@/app/api/v1/tickets/[ref]/attachments/route";
import { POST as postComment } from "@/app/api/v1/tickets/[ref]/comments/route";
import { GET as getTimeline } from "@/app/api/v1/tickets/[ref]/timeline/route";
import { itemOf, pageOf } from "@/lib/api/v1/cadastros";
import {
  attachmentLinkSchema,
  attachmentSchema,
  commentSchema,
  decodeTimelineCursor,
  encodeTimelineCursor,
  timelineItemSchema,
} from "@/lib/api/v1/ticket-activity";

import { createHarness, has, where, type Responder } from "./test-harness";

// Comentário, anexo e timeline da v1 (PR 8b). Supabase falso de
// test-harness.ts; o storage e a leitura da timeline são mocks (os deles têm
// testes próprios): aqui se confere o que a rota manda e devolve.

const TICKET_ID = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const ATTACHMENT_ID = "6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e";
const OBJECT_KEY = `tickets/${TICKET_ID}/0f8e7d6c-5b4a-4938-8271-605f4e3d2c1b`;
const PAST = "2026-09-29T12:00:00.123456+00:00";

const commentRow = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  author_user_id: null,
  author_token_id: "tok-1",
  body: "Cliente mandou o XML",
  created_at: PAST,
  edited_at: null,
  deleted_at: null,
  ...overrides,
});

// A linha como o banco a tem, com o que NÃO pode sair na resposta.
const attachmentRow = {
  id: ATTACHMENT_ID,
  file_name: "nota.pdf",
  mime: "application/pdf",
  size_bytes: 6,
  uploaded_by_user_id: null,
  uploaded_by_token_id: "tok-1",
  created_at: PAST,
  bucket: "ticket-attachments",
  object_key: OBJECT_KEY,
  sha256: "a".repeat(64),
};

const dbError: Responder = () => ({ data: null, error: { message: "segredo do banco", code: "XX000" } });

const h = createHarness(adminClientMock);

beforeEach(() => {
  vi.clearAllMocks();
  h.reset(["tickets:read", "comments:write", "attachments:read", "attachments:write"]);
  h.tables.tickets = () => ({ data: { id: TICKET_ID }, error: null });
  h.tables.ticket_comments = () => ({ data: commentRow(), error: null });
  h.tables.ticket_attachments = () => ({ data: attachmentRow, error: null });
  putMock.mockResolvedValue({
    bucket: "ticket-attachments",
    objectKey: OBJECT_KEY,
    mime: "application/pdf",
    sizeBytes: 6,
    sha256: "a".repeat(64),
  });
  removeMock.mockResolvedValue(true);
  signMock.mockResolvedValue("https://api.test/storage/v1/object/sign/ticket-attachments/x?token=abc");
  timelineMock.mockResolvedValue({ items: [], hasMore: false, nextBefore: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Handler<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;
function call<P extends object>(
  handler: Handler<P>,
  options: { path?: string; method?: string; body?: unknown; rawBody?: string; params: P; headers?: Record<string, string> }
) {
  return handler(h.request(options.path ?? "/x", options), { params: Promise.resolve(options.params) });
}
const json = async (response: Response) => response.json();
const insertArg = (table: string) => h.lastChain(table).find(([method]) => method === "insert")?.[1];
const rpcNames = () => h.rpcCalls.map(([name]) => name);
const silence = () => vi.spyOn(console, "error").mockImplementation(() => undefined);

// ─── Comentário ──────────────────────────────────────────────────────────────

describe("POST /api/v1/tickets/{ref}/comments", () => {
  const comment = (body: unknown, ref = TICKET_ID, headers: Record<string, string> = { "idempotency-key": "coment-0001" }) =>
    call(postComment, { method: "POST", body, headers, params: { ref } });

  it("grava com o token como autor (nunca usuário) e devolve 201 no schema publicado", async () => {
    const response = await comment({ body: "  Cliente mandou o XML  " });
    const payload = await json(response);

    expect(response.status).toBe(201);
    expect(itemOf(commentSchema).safeParse(payload).error?.issues ?? []).toEqual([]);
    expect(insertArg("ticket_comments")).toEqual({ ticket_id: TICKET_ID, author_token_id: "tok-1", body: "Cliente mandou o XML" });
    expect(rpcNames()).toContain("api_idempotency_finish");
  });

  it("pelo protocolo: acha o id antes de gravar", async () => {
    await comment({ body: "Oi" }, "1424");

    expect(where(h.chains.tickets[0], "number", 1424)).toBe(true);
    expect(insertArg("ticket_comments")).toMatchObject({ ticket_id: TICKET_ID });
  });

  it.each([
    ["uuid que não existe", TICKET_ID],
    ["protocolo que não existe", "1424"],
    ["ref que não é uuid nem número", "SUP-1424"],
  ])("%s é 404 sem gravar", async (_label, ref) => {
    h.tables.tickets = () => ({ data: null, error: null });

    const response = await comment({ body: "Oi" }, ref);

    expect(response.status).toBe(404);
    expect((await json(response)).error.code).toBe("not_found");
    expect(h.chains.ticket_comments).toBeUndefined();
  });

  it.each([
    ["pelo uuid", TICKET_ID],
    ["pelo protocolo", "1424"],
  ])("leitura do ticket que falhou %s é 503 com Retry-After, não 500", async (_label, ref) => {
    h.tables.tickets = dbError;
    silence();

    const response = await comment({ body: "Oi" }, ref);
    const payload = await json(response);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(payload.error.code).toBe("unavailable");
    expect(JSON.stringify(payload)).not.toContain("segredo do banco");
    expect(h.chains.ticket_comments).toBeUndefined();
  });

  it.each([
    ["vazio", { body: "   " }, "body", "Escreva o comentário."],
    ["campo a mais (autor não vem do corpo)", { body: "Oi", author_user_id: "x" }, "author_user_id", "Campo não aceito."],
    // A raiz também sai em `fields.body`: a mensagem é o que diz qual dos dois.
    ["corpo que não é objeto", [], "body", "Envie um objeto JSON."],
  ])("comentário %s é 400 no campo, sem gravar", async (_label, body, field, message) => {
    const response = await comment(body);

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields).toMatchObject({ [field]: message });
    expect(h.chains.ticket_comments).toBeUndefined();
  });

  it("corpo vazio é 400 invalid_json", async () => {
    const response = await call(postComment, {
      method: "POST",
      rawBody: "",
      headers: { "idempotency-key": "coment-0003" },
      params: { ref: TICKET_ID },
    });

    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("invalid_json");
  });

  it("multipart no lugar do JSON é 415, sem reservar a chave", async () => {
    const form = new FormData();
    form.set("body", "Oi");
    const response = await postComment(
      new Request("http://crm.test/api/v1/tickets/x/comments", {
        method: "POST",
        headers: { authorization: "Bearer crmsuporte_x", "x-forwarded-for": "198.51.100.250", "Idempotency-Key": "coment-0004" },
        body: form,
      }),
      { params: Promise.resolve({ ref: TICKET_ID }) }
    );

    expect(response.status).toBe(415);
    expect(rpcNames()).not.toContain("api_idempotency_begin");
  });

  it("check do banco é 400 validation_error; erro sem TAG é 500 sem a mensagem do banco", async () => {
    h.tables.ticket_comments = () => ({
      data: null,
      error: { message: 'violates check constraint "ticket_comments_body_check"', code: "23514" },
    });
    const check = await comment({ body: "Oi" });
    expect(check.status).toBe(400);
    expect((await json(check)).error.code).toBe("validation_error");

    silence();
    h.tables.ticket_comments = dbError;
    const failed = await comment({ body: "Oi" }, TICKET_ID, { "idempotency-key": "coment-0002" });
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await json(failed))).not.toContain("segredo do banco");
  });

  it("exige Idempotency-Key e comments:write", async () => {
    expect((await comment({ body: "Oi" }, TICKET_ID, {})).status).toBe(400);

    h.scopes = ["tickets:write", "comments:read"];
    expect((await comment({ body: "Oi" })).status).toBe(403);
    expect(h.chains.ticket_comments).toBeUndefined();
  });
});

// ─── Anexo ───────────────────────────────────────────────────────────────────

describe("POST /api/v1/tickets/{ref}/attachments", () => {
  let seq = 0;
  function upload(
    entries: [string, string | File][],
    options: { ref?: string; key?: string; headers?: Record<string, string> } = {}
  ) {
    seq += 1;
    const ref = options.ref ?? TICKET_ID;
    const key = options.key ?? "anexo-000001";
    const form = new FormData();
    for (const [name, value] of entries) form.append(name, value);
    const request = new Request(`http://crm.test/api/v1/tickets/${ref}/attachments`, {
      method: "POST",
      headers: {
        authorization: "Bearer crmsuporte_x",
        "x-forwarded-for": `198.51.100.${(seq % 200) + 1}`,
        ...(key ? { "Idempotency-Key": key } : {}),
        ...options.headers,
      },
      body: form,
    });
    return postAttachment(request, { params: Promise.resolve({ ref }) });
  }
  const pdf = (content = "%PDF-1", name = "nota.pdf") => new File([content], name, { type: "application/pdf" });

  it("guarda e grava com o token como autor; 201 no schema publicado, sem bucket, chave nem sha256", async () => {
    const response = await upload([["file", pdf()]]);
    const payload = await json(response);

    expect(response.status).toBe(201);
    expect(itemOf(attachmentSchema).safeParse(payload).error?.issues ?? []).toEqual([]);
    // A linha falsa do banco TEM esses campos: se a rota os repassasse, apareceriam.
    expect(JSON.stringify(payload)).not.toMatch(/object_key|sha256|bucket|tickets\//);
    const put = putMock.mock.calls[0][0];
    expect(put).toMatchObject({ ticketId: TICKET_ID, mime: "application/pdf" });
    expect(Buffer.from(put.body).toString("utf8")).toBe("%PDF-1");
    expect(insertArg("ticket_attachments")).toMatchObject({
      ticket_id: TICKET_ID,
      uploaded_by_token_id: "tok-1",
      file_name: "nota.pdf",
      object_key: OBJECT_KEY,
    });
    expect(insertArg("ticket_attachments")).not.toHaveProperty("uploaded_by_user_id");
  });

  it("pelo protocolo: acha o id antes de guardar", async () => {
    const response = await upload([["file", pdf()]], { ref: "1424" });

    expect(response.status).toBe(201);
    expect(where(h.chains.tickets[0], "number", 1424)).toBe(true);
    expect(putMock.mock.calls[0][0]).toMatchObject({ ticketId: TICKET_ID });
  });

  it.each([
    ["campo a mais", [["file", pdf()], ["descricao", "x"]] as [string, string | File][], "descricao"],
    ["dois arquivos", [["file", pdf()], ["file", pdf("%PDF-2")]] as [string, string | File][], "file"],
    ["texto no lugar do arquivo", [["file", "não é arquivo"]] as [string, string | File][], "file"],
    ["nenhum arquivo", [] as [string, string | File][], "file"],
    ["arquivo vazio", [["file", pdf("")]] as [string, string | File][], "file"],
  ])("%s é 400 no campo, sem tocar no storage", async (_label, entries, field) => {
    const response = await upload(entries);

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields).toHaveProperty(field);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("arquivo acima do teto é 413 payload_too_large no campo", async () => {
    const response = await upload([["file", pdf("x".repeat(17))]]);
    const payload = await json(response);

    expect(response.status).toBe(413);
    expect(payload.error).toMatchObject({ code: "payload_too_large", fields: { file: expect.any(String) } });
    expect(putMock).not.toHaveBeenCalled();
  });

  it("arquivo no teto exato passa: a folga do Content-Length cobre o envelope do multipart", async () => {
    const form = new FormData();
    form.set("file", pdf("x".repeat(16)));
    // O corpo de verdade, para o Content-Length ser o real (arquivo + envelope).
    const probe = new Request("http://crm.test/x", { method: "POST", body: form });
    const bytes = Buffer.from(await probe.arrayBuffer());
    const request = new Request(`http://crm.test/api/v1/tickets/${TICKET_ID}/attachments`, {
      method: "POST",
      headers: {
        authorization: "Bearer crmsuporte_x",
        "x-forwarded-for": "198.51.100.240",
        "Idempotency-Key": "anexo-000009",
        "content-type": probe.headers.get("content-type") ?? "",
        "content-length": String(bytes.byteLength),
      },
      body: bytes,
    });

    const response = await postAttachment(request, { params: Promise.resolve({ ref: TICKET_ID }) });

    expect(bytes.byteLength).toBeGreaterThan(16);
    expect(response.status).toBe(201);
  });

  it("Content-Length acima do teto é 413 ANTES de ler o corpo e de reservar a chave", async () => {
    const response = await upload([["file", pdf()]], { headers: { "content-length": String(16 + 64 * 1024 + 1) } });

    expect(response.status).toBe(413);
    expect((await json(response)).error.code).toBe("payload_too_large");
    expect(rpcNames()).not.toContain("api_idempotency_begin");
    expect(putMock).not.toHaveBeenCalled();
  });

  it("JSON no lugar do multipart é 415, sem reservar a chave", async () => {
    const response = await call(postAttachment, {
      method: "POST",
      body: { file: "x" },
      headers: { "idempotency-key": "anexo-000002" },
      params: { ref: TICKET_ID },
    });

    expect(response.status).toBe(415);
    expect((await json(response)).error.code).toBe("unsupported_media_type");
    expect(rpcNames()).not.toContain("api_idempotency_begin");
  });

  it.each([
    ["uuid que não existe", TICKET_ID],
    ["protocolo que não existe", "1424"],
    ["ref que não é uuid nem número", "abc"],
  ])("%s é 404 sem copiar o arquivo nem tocar no storage", async (_label, ref) => {
    h.tables.tickets = () => ({ data: null, error: null });
    const copy = vi.spyOn(Blob.prototype, "arrayBuffer");

    expect((await upload([["file", pdf()]], { ref })).status).toBe(404);
    expect(copy).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it.each([
    ["pelo uuid", TICKET_ID],
    ["pelo protocolo", "1424"],
  ])("leitura do ticket que falhou %s é 503, sem tocar no storage", async (_label, ref) => {
    h.tables.tickets = dbError;
    silence();

    const response = await upload([["file", pdf()]], { ref });

    expect(response.status).toBe(503);
    expect(JSON.stringify(await json(response))).not.toContain("segredo do banco");
    expect(putMock).not.toHaveBeenCalled();
  });

  it("storage que falhou é 502 storage_unavailable com Retry-After, e libera a chave (repetir é seguro)", async () => {
    putMock.mockResolvedValue(null);

    const response = await upload([["file", pdf()]]);

    expect(response.status).toBe(502);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect((await json(response)).error.code).toBe("storage_unavailable");
    expect(rpcNames()).toContain("api_idempotency_release");
  });

  it("INSERT que falhou apaga o objeto: nenhum arquivo fica sem linha", async () => {
    h.tables.ticket_attachments = () => ({
      data: null,
      error: { message: 'violates check constraint "ticket_attachments_mime_check"', code: "23514" },
    });

    const response = await upload([["file", pdf()]]);

    expect(response.status).toBe(400);
    expect(removeMock).toHaveBeenCalledWith(expect.anything(), OBJECT_KEY);
  });

  it("INSERT com erro inesperado é 500 sem a mensagem do banco, e o objeto sai", async () => {
    h.tables.ticket_attachments = dbError;
    silence();

    const response = await upload([["file", pdf()]]);

    expect(response.status).toBe(500);
    expect(JSON.stringify(await json(response))).not.toContain("segredo do banco");
    expect(removeMock).toHaveBeenCalledWith(expect.anything(), OBJECT_KEY);
  });

  it("exige attachments:write e Idempotency-Key", async () => {
    expect((await upload([["file", pdf()]], { key: "" })).status).toBe(400);

    h.scopes = ["attachments:read"];
    expect((await upload([["file", pdf()]])).status).toBe(403);
    expect(putMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/tickets/{ref}/attachments/{attachment_id}", () => {
  const link = (ref = TICKET_ID, attachment_id = ATTACHMENT_ID) =>
    call(getAttachmentLink, { params: { ref, attachment_id } });

  it("devolve a URL assinada curta com nome, tipo e tamanho, sem cache", async () => {
    const response = await link();
    const payload = await json(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(itemOf(attachmentLinkSchema).safeParse(payload).error?.issues ?? []).toEqual([]);
    expect(payload.data).toMatchObject({ url: expect.stringContaining("token="), file_name: "nota.pdf", size_bytes: 6 });
    const read = h.lastChain("ticket_attachments");
    expect(where(read, "id", ATTACHMENT_ID)).toBe(true);
    expect(where(read, "ticket_id", TICKET_ID)).toBe(true);
    expect(signMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ file_name: "nota.pdf" }), 600);
  });

  it("o vencimento informado conta de ANTES da assinatura: nunca passa do real", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
    signMock.mockImplementation(async () => {
      vi.setSystemTime(new Date("2026-10-01T12:00:07.000Z"));
      return "https://api.test/x?token=abc";
    });

    const payload = await json(await link());

    expect(payload.data.expires_at).toBe("2026-10-01T12:10:00.000Z");
  });

  it("anexo de outro ticket (ou inexistente) é 404; id malformado também, sem consultar", async () => {
    h.tables.ticket_attachments = () => ({ data: null, error: null });
    expect((await link()).status).toBe(404);

    h.clearChains();
    expect((await link(TICKET_ID, "abc")).status).toBe(404);
    expect((await link("SUP-1", ATTACHMENT_ID)).status).toBe(404);
    expect(h.chains.ticket_attachments).toBeUndefined();
    expect(h.chains.tickets).toBeUndefined();
  });

  it("linha com outro bucket não vira link (só o dos anexos é assinado)", async () => {
    h.tables.ticket_attachments = () => ({
      data: { bucket: "chat-media", object_key: "x", file_name: "a", mime: "image/png", size_bytes: 1 },
      error: null,
    });

    expect((await link()).status).toBe(404);
    expect(signMock).not.toHaveBeenCalled();
  });

  it("ticket inexistente é 404", async () => {
    h.tables.tickets = () => ({ data: null, error: null });

    expect((await link("1424")).status).toBe(404);
    expect(where(h.chains.tickets[0], "number", 1424)).toBe(true);
  });

  it.each([
    ["do ticket", "tickets"],
    ["do anexo", "ticket_attachments"],
  ])("leitura %s que falhou é 503, sem a mensagem do banco", async (_label, table) => {
    h.tables[table] = dbError;
    silence();

    const response = await link();

    expect(response.status).toBe(503);
    expect(JSON.stringify(await json(response))).not.toContain("segredo do banco");
    expect(signMock).not.toHaveBeenCalled();
  });

  it("assinatura que falhou é 502 storage_unavailable com Retry-After", async () => {
    signMock.mockResolvedValue(null);

    const response = await link();

    expect(response.status).toBe(502);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect((await json(response)).error.code).toBe("storage_unavailable");
  });

  it("exige attachments:read (attachments:write sozinho não baixa)", async () => {
    h.scopes = ["attachments:write"];

    expect((await link()).status).toBe(403);
    expect(signMock).not.toHaveBeenCalled();
  });
});

// ─── Timeline ────────────────────────────────────────────────────────────────

describe("GET /api/v1/tickets/{ref}/timeline", () => {
  const timeline = (path = "", ref = TICKET_ID) => call(getTimeline, { path: `/tickets/${ref}/timeline${path}`, params: { ref } });

  // Um de cada tipo, como getTicketTimeline devolve (a trilha com o seq interno).
  const items = [
    { kind: "comment", id: "c1", at: PAST, author_user_id: "u1", author_token_id: null, body: "Olhando", edited_at: null, deleted_at: null },
    {
      kind: "status",
      id: "s1",
      at: PAST,
      seq: 7,
      from_status: "novo",
      to_status: "em_triagem",
      actor_type: "ai",
      actor_user_id: null,
      reason: null,
    },
    { kind: "event", id: "e1", at: PAST, seq: 8, event_type: "ticket.assigned", actor_type: "agent", actor_user_id: "u1", metadata: { to: "u2" } },
    {
      kind: "message",
      id: "m1",
      at: PAST,
      direction: "outbound",
      sender_type: "agent",
      type: "note",
      content: "nota interna",
      file_name: null,
      delivery_status: "sent",
      sent_by_user_id: "u1",
      is_deleted: false,
    },
    { kind: "attachment", id: "a1", at: PAST, file_name: "nota.pdf", mime: "application/pdf", size_bytes: 6, uploaded_by_user_id: "u1", uploaded_by_token_id: null },
  ];

  it("página no schema publicado (os 5 tipos), sem o seq interno, e o next_cursor da página seguinte", async () => {
    timelineMock.mockResolvedValue({ items, hasMore: true, nextBefore: "2026-09-29T11:00:00.5+00:00" });

    const response = await timeline();
    const payload = await json(response);

    expect(response.status).toBe(200);
    expect(pageOf(timelineItemSchema).safeParse(payload).error?.issues ?? []).toEqual([]);
    expect(payload.data.map((item: { kind: string }) => item.kind)).toEqual(["comment", "status", "event", "message", "attachment"]);
    expect(JSON.stringify(payload)).not.toContain('"seq"');
    expect(decodeTimelineCursor(payload.meta.next_cursor)).toBe("2026-09-29T11:00:00.5+00:00");
  });

  it.each([
    [["tickets:read"], { comments: false, messages: false, notes: false }],
    [["tickets:read", "conversations:read"], { comments: false, messages: true, notes: false }],
    [["tickets:read", "comments:read"], { comments: true, messages: false, notes: false }],
    [["tickets:read", "conversations:read", "comments:read"], { comments: true, messages: true, notes: true }],
    [["tickets:read", "conversations:*", "comments:*"], { comments: true, messages: true, notes: true }],
    // comments:write (o do preset da IA) escreve, mas não lê o que é do time.
    [["tickets:read", "conversations:read", "comments:write"], { comments: false, messages: true, notes: false }],
  ])("escopos %j: cada parte da timeline só entra com o escopo dela", async (scopes, sources) => {
    h.scopes = scopes;

    await timeline();

    expect(timelineMock).toHaveBeenCalledWith(TICKET_ID, { before: undefined, sources });
  });

  it("o cursor volta ao instante cru; sem mais páginas, next_cursor null", async () => {
    const cursor = encodeTimelineCursor("2026-09-29T11:00:00.5+00:00");

    const payload = await json(await timeline(`?cursor=${cursor}`));

    expect(timelineMock).toHaveBeenCalledWith(TICKET_ID, expect.objectContaining({ before: "2026-09-29T11:00:00.5+00:00" }));
    expect(payload.meta.next_cursor).toBeNull();
  });

  it("é o hasMore que decide o fim: sem mais páginas, next_cursor null mesmo com um instante", async () => {
    timelineMock.mockResolvedValue({ items, hasMore: false, nextBefore: "2026-09-29T11:00:00.5+00:00" });

    expect((await json(await timeline())).meta.next_cursor).toBeNull();
  });

  it.each([
    ["cursor adulterado", "?cursor=lixo", "cursor"],
    ["cursor com instante impossível", `?cursor=${Buffer.from("t1|2026-02-30T00:00:00Z").toString("base64url")}`, "cursor"],
    ["cursor com o ano 0000 (o Postgres não tem)", `?cursor=${Buffer.from("t1|0000-01-01T00:00:00Z").toString("base64url")}`, "cursor"],
    ["cursor com vírgula (injeção)", `?cursor=${Buffer.from(`t1|${PAST},x`).toString("base64url")}`, "cursor"],
    ["parâmetro desconhecido", "?limit=10", "limit"],
  ])("%s é 400 no campo, sem ler", async (_label, path, field) => {
    const response = await timeline(path);

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields).toHaveProperty(field);
    expect(timelineMock).not.toHaveBeenCalled();
  });

  it("ticket inexistente é 404 (timeline vazia não diz nada), pelo uuid, pelo protocolo e com ref inválido", async () => {
    h.tables.tickets = () => ({ data: null, error: null });

    expect((await timeline()).status).toBe(404);
    expect(where(h.chains.tickets[0], "id", TICKET_ID)).toBe(true);
    h.clearChains();
    expect((await timeline("", "1424")).status).toBe(404);
    expect(has(h.chains.tickets[0], "eq", "number", 1424)).toBe(true);
    h.clearChains();
    expect((await timeline("", "SUP-1424")).status).toBe(404);
    expect(h.chains.tickets).toBeUndefined();
    expect(timelineMock).not.toHaveBeenCalled();
  });

  it.each([
    ["do ticket", () => (h.tables.tickets = dbError)],
    ["da timeline", () => timelineMock.mockRejectedValue(new Error("boom"))],
  ])("leitura %s que falhou é 503, nunca página vazia", async (_label, breakIt) => {
    breakIt();
    silence();

    const response = await timeline();

    expect(response.status).toBe(503);
    expect((await json(response)).error.code).toBe("unavailable");
  });

  it("exige tickets:read", async () => {
    h.scopes = ["comments:read", "conversations:read"];

    expect((await timeline()).status).toBe(403);
    expect(timelineMock).not.toHaveBeenCalled();
  });
});

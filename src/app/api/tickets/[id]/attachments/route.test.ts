// @vitest-environment node
import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { userMock, hasAdminEnvMock, adminClientMock } = vi.hoisted(() => ({
  userMock: vi.fn(),
  hasAdminEnvMock: vi.fn(),
  adminClientMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: userMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: hasAdminEnvMock,
  createSupabaseAdminClient: adminClientMock,
}));

import { POST } from "@/app/api/tickets/[id]/attachments/route";
import { TIMELINE_ATTACHMENT_SELECT } from "@/features/tickets/queries/get-ticket-timeline";
import { TICKET_ATTACHMENT_MAX_BYTES } from "@/lib/storage/ticket-attachments";

// Ids fictícios. O storage e o PostgREST são mocks: a lib de storage é a real,
// e o que se confere é o que ela manda ao client.
const VIEWER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
const ATTACHMENT_ID = "55555555-5555-4555-8555-555555555555";
const CREATED_AT = "2026-09-26T03:10:00.1944+00:00";

type Call = [method: string, ...args: unknown[]];

let ticketRead: { data: unknown; error: unknown };
let insertResult: { data: unknown; error: unknown };
let ticketCalls: Call[];
let insertCalls: Call[];
const upload = vi.fn();
const remove = vi.fn();
const storageFrom = vi.fn();
const fromMock = vi.fn();

function ticketBuilder() {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    builder[method] = (...args: unknown[]) => {
      ticketCalls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = () => Promise.resolve(ticketRead);
  return builder;
}

function insertBuilder() {
  const builder: Record<string, unknown> = {};
  for (const method of ["insert", "select"]) {
    builder[method] = (...args: unknown[]) => {
      insertCalls.push([method, ...args]);
      return builder;
    };
  }
  builder.single = () => Promise.resolve(insertResult);
  return builder;
}

// A linha como o RETURNING devolve: o que não foi inserido vem do default.
function insertedRow(payload: Record<string, unknown>) {
  return { uploaded_by_token_id: null, ...payload, id: ATTACHMENT_ID, created_at: CREATED_AT };
}

function send(form: FormData | string, id = TICKET_ID, headers: Record<string, string> = {}) {
  return POST(
    new Request(`http://x/api/tickets/${id}/attachments`, { method: "POST", body: form, headers }),
    { params: Promise.resolve({ id }) }
  );
}

function formWith(file: File | string | null, extra: Record<string, string> = {}) {
  const form = new FormData();
  if (file !== null) form.append("file", file);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return form;
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  userMock.mockResolvedValue({ viewer: { id: VIEWER_ID, role: "member", is_active: true } });
  hasAdminEnvMock.mockReturnValue(true);
  ticketRead = { data: { id: TICKET_ID }, error: null };
  insertResult = { data: null, error: null };
  ticketCalls = [];
  insertCalls = [];
  upload.mockResolvedValue({ data: { path: "x" }, error: null });
  remove.mockResolvedValue({ data: [], error: null });
  storageFrom.mockReturnValue({ upload, remove });
  fromMock.mockImplementation((table: string) =>
    table === "tickets" ? ticketBuilder() : insertBuilder()
  );
  adminClientMock.mockReturnValue({ from: fromMock, storage: { from: storageFrom } });
});

afterEach(() => {
  consoleError.mockRestore();
});

// O INSERT devolve o que recebeu, como o banco faria no caminho feliz.
function echoInsert() {
  fromMock.mockImplementation((table: string) => {
    if (table === "tickets") return ticketBuilder();
    const builder = insertBuilder();
    const insert = builder.insert as (payload: Record<string, unknown>) => unknown;
    builder.insert = (payload: Record<string, unknown>) => {
      insertResult = { data: insertedRow(payload), error: null };
      return insert(payload);
    };
    return builder;
  });
}

function insertPayload() {
  const call = insertCalls.find(([method]) => method === "insert");
  return call?.[1] as Record<string, unknown>;
}

describe("POST /api/tickets/[id]/attachments", () => {
  it("sem sessão → 401 sem criar o client", async () => {
    userMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await send(formWith(new File(["abc"], "a.txt")));

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("id fora de UUID → 400 sem tocar no storage", async () => {
    const response = await send(formWith(new File(["abc"], "a.txt")), "1024");

    expect(response.status).toBe(400);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("sem Supabase admin → 500 sem criar o client", async () => {
    hasAdminEnvMock.mockReturnValue(false);

    const response = await send(formWith(new File(["abc"], "a.txt")));

    expect(response.status).toBe(500);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("Content-Length acima do teto → 413 antes de ler o corpo", async () => {
    const response = await send("x", TICKET_ID, {
      "content-length": String(TICKET_ATTACHMENT_MAX_BYTES * 2),
      "content-type": "multipart/form-data; boundary=x",
    });

    expect(response.status).toBe(413);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("corpo que não é multipart → 400 no campo file", async () => {
    const response = await send(JSON.stringify({ file: "x" }), TICKET_ID, {
      "content-type": "application/json",
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors.file).toHaveLength(1);
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([
    ["sem o campo file", formWith(null)],
    ["file como texto", formWith("abc")],
    ["arquivo vazio", formWith(new File([], "vazio.txt"))],
  ])("%s → 400 no campo file, sem storage nem banco", async (_label, form) => {
    const response = await send(form);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.errors.file).toHaveLength(1);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("arquivo acima de 50 MB → 413 sem storage nem banco", async () => {
    const big = new File([new Uint8Array(TICKET_ATTACHMENT_MAX_BYTES + 1)], "grande.zip");

    const response = await send(formWith(big));

    expect(response.status).toBe(413);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("ticket inexistente → 404 sem upload", async () => {
    ticketRead = { data: null, error: null };

    const response = await send(formWith(new File(["abc"], "a.txt")));
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.code).toBe("not_found");
    expect(upload).not.toHaveBeenCalled();
    expect(ticketCalls).toEqual([
      ["select", "id"],
      ["eq", "id", TICKET_ID],
    ]);
  });

  it("falha ao ler o ticket → 500 genérico, sem upload e sem repassar o erro do banco", async () => {
    ticketRead = { data: null, error: { code: "08006", message: "connection refused" } };

    const response = await send(formWith(new File(["abc"], "a.txt")));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain("connection refused");
    expect(upload).not.toHaveBeenCalled();
  });

  it("201: upload antes do INSERT, ator da sessão e resposta sem bucket, chave nem sha256", async () => {
    echoInsert();
    const bytes = "<h1>oi</h1>";

    const response = await send(
      formWith(new File([bytes], "C:\\fakepath\\página.html", { type: "text/html" }), {
        uploaded_by_user_id: OTHER_USER_ID,
      })
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    const [key, body, options] = upload.mock.calls[0] as [string, Buffer, Record<string, unknown>];
    expect(storageFrom).toHaveBeenCalledWith("ticket-attachments");
    expect(key).toMatch(new RegExp(`^tickets/${TICKET_ID}/[0-9a-f-]{36}$`));
    expect(body.toString()).toBe(bytes);
    // Pronto do PR 3: .html guardado como octet-stream.
    expect(options).toEqual({ contentType: "application/octet-stream", upsert: false });

    expect(insertPayload()).toEqual({
      ticket_id: TICKET_ID,
      bucket: "ticket-attachments",
      object_key: key,
      file_name: "página.html",
      mime: "application/octet-stream",
      size_bytes: Buffer.byteLength(bytes),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      uploaded_by_user_id: VIEWER_ID,
    });
    expect(insertCalls.find(([method]) => method === "select")).toEqual([
      "select",
      TIMELINE_ATTACHMENT_SELECT,
    ]);

    expect(json).toEqual({
      ok: true,
      attachment: {
        id: ATTACHMENT_ID,
        file_name: "página.html",
        mime: "application/octet-stream",
        size_bytes: Buffer.byteLength(bytes),
        uploaded_by_user_id: VIEWER_ID,
        uploaded_by_token_id: null,
        created_at: CREATED_AT,
      },
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("id em maiúsculas: chave e ticket_id saem do id do banco, em minúsculas", async () => {
    echoInsert();

    const response = await send(
      formWith(new File(["%PDF-1.7"], "nota.pdf", { type: "application/pdf" })),
      TICKET_ID.toUpperCase()
    );

    expect(response.status).toBe(201);
    expect(insertPayload().ticket_id).toBe(TICKET_ID);
    expect(insertPayload().object_key).toMatch(new RegExp(`^tickets/${TICKET_ID}/`));
    expect(insertPayload().mime).toBe("application/pdf");
  });

  it("storage recusou → 502 sem INSERT", async () => {
    upload.mockResolvedValue({ data: null, error: { message: "Bucket not found" } });

    const response = await send(formWith(new File(["abc"], "a.txt")));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(JSON.stringify(json)).not.toContain("Bucket not found");
    expect(insertCalls).toEqual([]);
  });

  it.each([
    [
      "CHECK de entrada (23514)",
      {
        code: "23514",
        message:
          'new row for relation "ticket_attachments" violates check constraint "ticket_attachments_size_check"',
      },
      400,
    ],
    ["falha do banco", { code: "08006", message: "connection refused" }, 500],
  ])("INSERT falhou (%s) → apaga o objeto: nenhum órfão", async (_label, error, status) => {
    insertResult = { data: null, error };

    const response = await send(formWith(new File(["abc"], "a.txt", { type: "text/plain" })));
    const json = await response.json();

    expect(response.status).toBe(status);
    expect(json.ok).toBe(false);
    expect(JSON.stringify(json)).not.toContain(error.message);
    const [uploadedKey] = upload.mock.calls[0] as [string];
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([uploadedKey]);
  });

  it("INSERT e remoção falharam → responde o erro do INSERT mesmo assim, com log", async () => {
    insertResult = { data: null, error: { code: "08006", message: "connection refused" } };
    remove.mockResolvedValue({ data: null, error: { message: "storage down" } });

    const response = await send(formWith(new File(["abc"], "a.txt")));

    expect(response.status).toBe(500);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });
});

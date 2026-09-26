// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { userMock, hasAdminEnvMock, adminClientMock, signMock } = vi.hoisted(() => ({
  userMock: vi.fn(),
  hasAdminEnvMock: vi.fn(),
  adminClientMock: vi.fn(),
  signMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: userMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: hasAdminEnvMock,
  createSupabaseAdminClient: adminClientMock,
}));
// Só a assinatura crua é mock: a escolha entre abrir e baixar é a real.
vi.mock("@/lib/storage/chat-media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/chat-media")>()),
  signStorageObject: signMock,
}));

import { GET } from "@/app/api/tickets/[id]/attachments/[attachmentId]/route";

// Ids fictícios.
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
const ATTACHMENT_ID = "55555555-5555-4555-8555-555555555555";
const KEY = `tickets/${TICKET_ID}/66666666-6666-4666-8666-666666666666`;
const SIGNED = `http://localhost:54321/storage/v1/object/sign/ticket-attachments/${KEY}?token=t`;

type Call = [method: string, ...args: unknown[]];

let row: Record<string, unknown> | null;
let readError: { code: string; message: string } | null;
let calls: Call[];

function get(id = TICKET_ID, attachmentId = ATTACHMENT_ID) {
  return GET(new Request(`http://x/api/tickets/${id}/attachments/${attachmentId}`), {
    params: Promise.resolve({ id, attachmentId }),
  });
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  userMock.mockResolvedValue({ viewer: { id: "11111111-1111-4111-8111-111111111111" } });
  hasAdminEnvMock.mockReturnValue(true);
  signMock.mockResolvedValue(SIGNED);
  row = {
    bucket: "ticket-attachments",
    object_key: KEY,
    file_name: "print.png",
    mime: "image/png",
  };
  readError = null;
  calls = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => ({ data: readError ? null : row, error: readError });
  adminClientMock.mockReturnValue({
    from: (table: string) => {
      calls.push(["from", table]);
      return builder;
    },
  });
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("GET /api/tickets/[id]/attachments/[attachmentId]", () => {
  it("sem usuário ativo → 401 antes de assinar qualquer coisa", async () => {
    userMock.mockResolvedValue({
      error: Response.json({ ok: false }, { status: 401 }),
    });

    const response = await get();

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(signMock).not.toHaveBeenCalled();
  });

  it.each([
    ["ticket", "../../etc/passwd", ATTACHMENT_ID],
    ["anexo", TICKET_ID, "1024"],
  ])("%s fora de UUID → 400", async (_label, id, attachmentId) => {
    const response = await get(id, attachmentId);

    expect(response.status).toBe(400);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("sem Supabase admin → 500 sem criar o client", async () => {
    hasAdminEnvMock.mockReturnValue(false);

    const response = await get();

    expect(response.status).toBe(500);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("302 para a URL assinada de 600 s, com cache privado curto", async () => {
    const response = await get();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(SIGNED);
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(signMock).toHaveBeenCalledWith(expect.anything(), "ticket-attachments", KEY, 600);
  });

  it("busca pelo par (anexo, ticket), com colunas explícitas", async () => {
    await get();

    expect(calls).toEqual([
      ["from", "ticket_attachments"],
      ["select", "bucket, object_key, file_name, mime"],
      ["eq", "id", ATTACHMENT_ID],
      ["eq", "ticket_id", TICKET_ID],
    ]);
  });

  it("octet-stream (o .html guardado) sai como download com o nome original", async () => {
    row = { ...row, file_name: "página inicial.html", mime: "application/octet-stream" };

    const response = await get();

    const location = new URL(response.headers.get("location") ?? "");
    expect(response.status).toBe(302);
    expect(location.searchParams.get("token")).toBe("t");
    expect(location.searchParams.get("download")).toBe("página inicial.html");
  });

  it.each([
    ["anexo inexistente ou de outro ticket", null],
    ["bucket que não é o dos anexos", { bucket: "chat-media", object_key: KEY, file_name: "a", mime: "image/png" }],
  ])("404 para %s, sem assinar", async (_label, value) => {
    row = value;

    const response = await get();

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
    expect(signMock).not.toHaveBeenCalled();
  });

  it("falha de leitura → 500 genérico, sem repassar o erro do banco", async () => {
    readError = { code: "08006", message: "connection refused" };

    const response = await get();

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("connection refused");
    expect(signMock).not.toHaveBeenCalled();
  });

  it("storage não assinou → 502", async () => {
    signMock.mockResolvedValue(null);

    const response = await get();

    expect(response.status).toBe(502);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { userMock, hasAdminEnvMock, adminClientMock, fromMock } = vi.hoisted(() => ({
  userMock: vi.fn(),
  hasAdminEnvMock: vi.fn(),
  adminClientMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: userMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: hasAdminEnvMock,
  createSupabaseAdminClient: adminClientMock,
}));

import { POST } from "@/app/api/tickets/[id]/comments/route";
import { TIMELINE_COMMENT_SELECT } from "@/features/tickets/queries/get-ticket-timeline";
import type { TicketComment } from "@/features/tickets/types";

// Ids fictícios.
const VIEWER_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
const COMMENT_ID = "55555555-5555-4555-8555-555555555555";
const params = { params: Promise.resolve({ id: TICKET_ID }) };

type Call = [method: string, ...args: unknown[]];
type DbResult = { data: unknown; error: unknown };

// Uma consulta encadeada: grava as chamadas e resolve no método terminal.
function queueQuery(terminal: "maybeSingle" | "single", result: DbResult) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder[terminal] = () => {
    calls.push([terminal]);
    return Promise.resolve(result);
  };
  fromMock.mockImplementationOnce((table: string) => {
    calls.unshift(["from", table]);
    return builder;
  });
  return calls;
}

function created(overrides: Partial<TicketComment> = {}): TicketComment {
  return {
    id: COMMENT_ID,
    author_user_id: VIEWER_ID,
    author_token_id: null,
    body: "Cliente pediu retorno à tarde.",
    created_at: "2026-09-26T03:20:00.194405+00:00",
    edited_at: null,
    deleted_at: null,
    ...overrides,
  };
}

function post(body: unknown, id = TICKET_ID) {
  return POST(
    new Request(`http://x/api/tickets/${id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    id === TICKET_ID ? params : { params: Promise.resolve({ id }) }
  );
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  userMock.mockResolvedValue({ viewer: { id: VIEWER_ID, role: "member", is_active: true } });
  hasAdminEnvMock.mockReturnValue(true);
  adminClientMock.mockReturnValue({ from: fromMock });
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("POST /api/tickets/[id]/comments", () => {
  it("sem sessão → 401 sem criar o client", async () => {
    userMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await post({ body: "Oi" });

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("id fora de UUID (o protocolo não serve aqui) → 400", async () => {
    const response = await post({ body: "Oi" }, "1024");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, message: "Ticket inválido." });
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("sem Supabase admin → 500 sem criar o client", async () => {
    hasAdminEnvMock.mockReturnValue(false);

    const response = await post({ body: "Oi" });

    expect(response.status).toBe(500);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("JSON inválido → 400", async () => {
    const response = await post("{");

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("JSON inválido.");
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it.each([[""], ["   "], ["a".repeat(5001)], ["abc\u0000def"]])(
    "corpo %j → 400 no campo body, sem ir ao banco",
    async (text) => {
      const response = await post({ body: text });
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.errors.body).toHaveLength(1);
      expect(adminClientMock).not.toHaveBeenCalled();
    }
  );

  it("autor no corpo → 400 (.strict()): o autor só vem da sessão", async () => {
    const response = await post({ body: "Oi", author_user_id: "22222222-2222-4222-8222-222222222222" });

    expect(response.status).toBe(400);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("grava com o autor da sessão e o texto aparado → 201 com o comentário", async () => {
    const ticketRead = queueQuery("maybeSingle", { data: { id: TICKET_ID }, error: null });
    const insert = queueQuery("single", { data: created(), error: null });

    const response = await post({ body: "  Cliente pediu retorno à tarde.  " });
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(ticketRead).toEqual([
      ["from", "tickets"],
      ["select", "id"],
      ["eq", "id", TICKET_ID],
      ["maybeSingle"],
    ]);
    expect(insert).toEqual([
      ["from", "ticket_comments"],
      [
        "insert",
        { ticket_id: TICKET_ID, author_user_id: VIEWER_ID, body: "Cliente pediu retorno à tarde." },
      ],
      ["select", TIMELINE_COMMENT_SELECT],
      ["single"],
    ]);
    expect(json).toStrictEqual({ ok: true, comment: created() });
  });

  it("ticket inexistente → 404 sem INSERT", async () => {
    queueQuery("maybeSingle", { data: null, error: null });

    const response = await post({ body: "Oi" });

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({
      ok: false,
      code: "not_found",
      message: "Ticket não encontrado.",
    });
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("falha ao ler o ticket → 500 logado, sem repassar a mensagem do banco", async () => {
    queueQuery("maybeSingle", {
      data: null,
      error: { message: "connection reset by peer", code: "08006" },
    });

    const response = await post({ body: "Oi" });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("connection reset");
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "[POST /api/tickets/[id]/comments]",
      "08006",
      "connection reset by peer"
    );
  });

  // Rede de segurança: o zod é mais estrito que o check (trim de todo espaço,
  // teto em unidades UTF-16), então só um cliente fora do schema chega aqui.
  it("check do corpo no banco → 400 validation", async () => {
    queueQuery("maybeSingle", { data: { id: TICKET_ID }, error: null });
    queueQuery("single", {
      data: null,
      error: {
        message:
          'new row for relation "ticket_comments" violates check constraint "ticket_comments_body_check"',
        code: "23514",
      },
    });

    const response = await post({ body: "Oi" });

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("validation");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("erro do INSERT sem TAG → 500 logado, sem repassar a mensagem do banco", async () => {
    queueQuery("maybeSingle", { data: { id: TICKET_ID }, error: null });
    queueQuery("single", {
      data: null,
      error: { message: 'permission denied for table "ticket_comments"', code: "42501" },
    });

    const response = await post({ body: "Oi" });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("permission denied");
    expect(JSON.parse(text)).toMatchObject({ ok: false, code: "internal" });
    expect(consoleError).toHaveBeenCalledWith(
      "[POST /api/tickets/[id]/comments]",
      "42501",
      'permission denied for table "ticket_comments"'
    );
  });
});

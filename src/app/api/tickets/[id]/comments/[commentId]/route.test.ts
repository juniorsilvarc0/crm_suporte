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

import { DELETE, PATCH } from "@/app/api/tickets/[id]/comments/[commentId]/route";
import { TIMELINE_COMMENT_SELECT } from "@/features/tickets/queries/get-ticket-timeline";
import type { TicketComment } from "@/features/tickets/types";

// Ids fictícios. Instantes no formato do PostgREST (microssegundos e fuso).
const VIEWER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN_ID = "66666666-6666-4666-8666-666666666666";
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
const COMMENT_ID = "55555555-5555-4555-8555-555555555555";
const CREATED_AT = "2026-09-26T03:20:00.194405+00:00";
const LATER = "2026-09-26T04:00:00.5+00:00";

type Call = [method: string, ...args: unknown[]];
type DbResult = { data: unknown; error: unknown };

// Uma consulta encadeada: grava as chamadas e resolve no método terminal.
function queueQuery(terminal: "maybeSingle" | "single", result: DbResult) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "update"]) {
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

function comment(overrides: Partial<TicketComment> = {}): TicketComment {
  return {
    id: COMMENT_ID,
    author_user_id: VIEWER_ID,
    author_token_id: null,
    body: "Primeira versão",
    created_at: CREATED_AT,
    edited_at: null,
    deleted_at: null,
    ...overrides,
  };
}

// A leitura do comentário, como a rota a faz: só DESTE ticket.
const LOAD_CALLS: Call[] = [
  ["from", "ticket_comments"],
  ["select", TIMELINE_COMMENT_SELECT],
  ["eq", "id", COMMENT_ID],
  ["eq", "ticket_id", TICKET_ID],
  ["maybeSingle"],
];

function context(id = TICKET_ID, commentId = COMMENT_ID) {
  return { params: Promise.resolve({ id, commentId }) };
}

function patch(body: unknown, id = TICKET_ID, commentId = COMMENT_ID) {
  return PATCH(
    new Request(`http://x/api/tickets/${id}/comments/${commentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    context(id, commentId)
  );
}

function remove(id = TICKET_ID, commentId = COMMENT_ID) {
  return DELETE(
    new Request(`http://x/api/tickets/${id}/comments/${commentId}`, { method: "DELETE" }),
    context(id, commentId)
  );
}

const COMMENT_DELETED_BODY = {
  ok: false,
  code: "comment_deleted",
  message: "Comentário apagado não pode ser alterado.",
};
const NOT_AUTHOR_BODY = {
  ok: false,
  code: "forbidden",
  message: "Só quem escreveu o comentário pode alterá-lo.",
};

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

describe("PATCH /api/tickets/[id]/comments/[commentId]", () => {
  it("sem sessão → 401 sem criar o client", async () => {
    userMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await patch({ body: "Oi" });

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("ids fora de UUID → 400 sem ir ao banco", async () => {
    const badTicket = await patch({ body: "Oi" }, "1024");
    const badComment = await patch({ body: "Oi" }, TICKET_ID, "abc");

    expect(badTicket.status).toBe(400);
    expect(await badTicket.json()).toEqual({ ok: false, message: "Ticket inválido." });
    expect(badComment.status).toBe(400);
    expect(await badComment.json()).toEqual({ ok: false, message: "Comentário inválido." });
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("sem Supabase admin → 500 sem criar o client", async () => {
    hasAdminEnvMock.mockReturnValue(false);

    const response = await patch({ body: "Oi" });

    expect(response.status).toBe(500);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("JSON inválido → 400", async () => {
    const response = await patch("{");

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("JSON inválido.");
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("corpo vazio ou com autor → 400 sem ir ao banco", async () => {
    const blank = await patch({ body: "   " });
    const withAuthor = await patch({ body: "Oi", author_user_id: OTHER_ID });

    expect(blank.status).toBe(400);
    expect((await blank.json()).errors.body).toEqual(["Escreva o comentário."]);
    expect(withAuthor.status).toBe(400);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("o autor edita: grava SÓ o body aparado (edited_at é do banco)", async () => {
    const load = queueQuery("maybeSingle", { data: comment(), error: null });
    const edited = comment({ body: "Segunda versão", edited_at: LATER });
    const update = queueQuery("single", { data: edited, error: null });

    const response = await patch({ body: "  Segunda versão " });

    expect(response.status).toBe(200);
    expect(load).toEqual(LOAD_CALLS);
    expect(update).toEqual([
      ["from", "ticket_comments"],
      ["update", { body: "Segunda versão" }],
      ["eq", "id", COMMENT_ID],
      ["eq", "ticket_id", TICKET_ID],
      ["select", TIMELINE_COMMENT_SELECT],
      ["single"],
    ]);
    expect(await response.json()).toStrictEqual({ ok: true, comment: edited });
  });

  it("comentário de outro ticket (ou inexistente) → 404 sem UPDATE", async () => {
    queueQuery("maybeSingle", { data: null, error: null });

    const response = await patch({ body: "Oi" });

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({
      ok: false,
      code: "not_found",
      message: "Comentário não encontrado.",
    });
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("comentário apagado → 409 comment_deleted sem UPDATE", async () => {
    queueQuery("maybeSingle", {
      data: comment({ body: null, deleted_at: LATER }),
      error: null,
    });

    const response = await patch({ body: "De volta" });

    expect(response.status).toBe(409);
    expect(await response.json()).toStrictEqual(COMMENT_DELETED_BODY);
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("comentário de outra pessoa → 403 sem UPDATE", async () => {
    queueQuery("maybeSingle", { data: comment({ author_user_id: OTHER_ID }), error: null });

    const response = await patch({ body: "Reescrito" });

    expect(response.status).toBe(403);
    expect(await response.json()).toStrictEqual(NOT_AUTHOR_BODY);
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("comentário de integração → 403 (não tem autor na equipe)", async () => {
    queueQuery("maybeSingle", {
      data: comment({ author_user_id: null, author_token_id: TOKEN_ID }),
      error: null,
    });

    const response = await patch({ body: "Reescrito" });

    expect(response.status).toBe(403);
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  // Duas abas: uma apagou entre a leitura e o UPDATE da outra. O trigger
  // responde, e a tela recebe o mesmo corpo da conferência prévia.
  it("apagado na corrida → COMMENT_DELETED do trigger vira o mesmo 409", async () => {
    queueQuery("maybeSingle", { data: comment(), error: null });
    queueQuery("single", {
      data: null,
      error: { message: "COMMENT_DELETED", code: "P0001", details: null, hint: null },
    });

    const response = await patch({ body: "Segunda versão" });

    expect(response.status).toBe(409);
    expect(await response.json()).toStrictEqual(COMMENT_DELETED_BODY);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("falha ao ler o comentário → 500 logado, sem repassar a mensagem do banco", async () => {
    queueQuery("maybeSingle", {
      data: null,
      error: { message: "connection reset by peer", code: "08006" },
    });

    const response = await patch({ body: "Oi" });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("connection reset");
    expect(consoleError).toHaveBeenCalledWith(
      "[PATCH /api/tickets/[id]/comments/[commentId]]",
      "08006",
      "connection reset by peer"
    );
  });
});

describe("DELETE /api/tickets/[id]/comments/[commentId]", () => {
  it("sem sessão → 401 sem criar o client", async () => {
    userMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await remove();

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("ids fora de UUID → 400 sem ir ao banco", async () => {
    expect((await remove("1024")).status).toBe(400);
    expect((await remove(TICKET_ID, "abc")).status).toBe(400);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("sem Supabase admin → 500 sem criar o client", async () => {
    hasAdminEnvMock.mockReturnValue(false);

    const response = await remove();

    expect(response.status).toBe(500);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("o autor apaga: soft delete (body nulo + deleted_at) e devolve o comentário apagado", async () => {
    const load = queueQuery("maybeSingle", { data: comment(), error: null });
    const deleted = comment({ body: null, deleted_at: LATER });
    const update = queueQuery("single", { data: deleted, error: null });

    const response = await remove();

    expect(response.status).toBe(200);
    expect(load).toEqual(LOAD_CALLS);
    expect(update).toEqual([
      ["from", "ticket_comments"],
      ["update", { body: null, deleted_at: expect.any(String) }],
      ["eq", "id", COMMENT_ID],
      ["eq", "ticket_id", TICKET_ID],
      ["select", TIMELINE_COMMENT_SELECT],
      ["single"],
    ]);
    expect(await response.json()).toStrictEqual({ ok: true, comment: deleted });
  });

  it("comentário de outro ticket (ou inexistente) → 404 sem UPDATE", async () => {
    queueQuery("maybeSingle", { data: null, error: null });

    const response = await remove();

    expect(response.status).toBe(404);
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("já apagado → 409 comment_deleted sem UPDATE", async () => {
    queueQuery("maybeSingle", {
      data: comment({ body: null, deleted_at: LATER }),
      error: null,
    });

    const response = await remove();

    expect(response.status).toBe(409);
    expect(await response.json()).toStrictEqual(COMMENT_DELETED_BODY);
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("comentário de outra pessoa → 403 sem UPDATE", async () => {
    queueQuery("maybeSingle", { data: comment({ author_user_id: OTHER_ID }), error: null });

    const response = await remove();

    expect(response.status).toBe(403);
    expect(await response.json()).toStrictEqual(NOT_AUTHOR_BODY);
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("apagado na corrida → COMMENT_DELETED do trigger vira 409", async () => {
    queueQuery("maybeSingle", { data: comment(), error: null });
    queueQuery("single", {
      data: null,
      error: { message: "COMMENT_DELETED", code: "P0001", details: null, hint: null },
    });

    const response = await remove();

    expect(response.status).toBe(409);
    expect(await response.json()).toStrictEqual(COMMENT_DELETED_BODY);
  });

  it("erro do UPDATE sem TAG → 500 logado, sem repassar a mensagem do banco", async () => {
    queueQuery("maybeSingle", { data: comment(), error: null });
    queueQuery("single", {
      data: null,
      error: { message: 'permission denied for table "ticket_comments"', code: "42501" },
    });

    const response = await remove();
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("permission denied");
    expect(consoleError).toHaveBeenCalledWith(
      "[DELETE /api/tickets/[id]/comments/[commentId]]",
      "42501",
      'permission denied for table "ticket_comments"'
    );
  });
});

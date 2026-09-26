import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocka as fronteiras: auth admin, a integração, o logout na uazapi e o client
// admin.
const { requireAdminMock, adminClientMock, integrationMock, logoutMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  adminClientMock: vi.fn(),
  integrationMock: vi.fn(),
  logoutMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardAdmin: requireAdminMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: adminClientMock,
}));
vi.mock("@/features/chat/lib/connection/integration", () => ({
  getUazapiIntegration: integrationMock,
}));
vi.mock("@/features/chat/lib/connection/uazapi", () => ({
  disconnectUazapi: logoutMock,
}));

import { POST } from "@/app/api/connection/disconnect/route";

const INTEGRATION_ID = "22222222-2222-4222-8222-222222222222";

type DbError = { message: string; code: string };

function req(body: unknown) {
  return new Request("http://x/api/connection/disconnect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Estado do banco falso, por teste.
let ticketCount: { count: number | null; error: DbError | null };
let conversationsDelete: { data: { id: string }[] | null; error: DbError | null };
const ticketSelect = vi.fn();
const ticketEq = vi.fn();
const conversationsDeleteMock = vi.fn();
const integrationDelete = vi.fn();

function fakeDatabase() {
  return {
    from: (table: string) => {
      if (table === "tickets") {
        return {
          select: (...args: unknown[]) => {
            ticketSelect(...args);
            return {
              eq: async (...eqArgs: unknown[]) => {
                ticketEq(...eqArgs);
                return ticketCount;
              },
            };
          },
        };
      }
      if (table === "chat_conversations") {
        return {
          delete: () => {
            conversationsDeleteMock();
            return { eq: () => ({ select: async () => conversationsDelete }) };
          },
        };
      }
      return {
        delete: () => {
          integrationDelete();
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  requireAdminMock.mockResolvedValue({ viewer: { id: "u1", role: "admin" } });
  integrationMock.mockResolvedValue({
    id: INTEGRATION_ID,
    apiUrl: "https://inst.uazapi.test",
    token: "token",
    phone_number: null,
  });
  logoutMock.mockResolvedValue(undefined);
  adminClientMock.mockImplementation(fakeDatabase);
  ticketCount = { count: 0, error: null };
  conversationsDelete = { data: [{ id: "c1" }, { id: "c2" }], error: null };
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  consoleError.mockRestore();
});

describe("POST /api/connection/disconnect", () => {
  it("sem admin devolve o erro do guard e não toca banco nem uazapi", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ ok: false, message: "forbidden" }, { status: 403 }),
    });

    const res = await POST(req({ wipe: true }));

    expect(res.status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
  });

  // count 1 pega o limite (`> 0`) e o singular: o ";" separa "1 ticket" de
  // "1 tickets".
  it.each([
    ["wipe", 1, { wipe: true }, "1 ticket;"],
    ["wipe", 2, { wipe: true }, "2 tickets;"],
    ["deleteIntegration", 1, { deleteIntegration: true }, "1 ticket;"],
    ["deleteIntegration", 2, { deleteIntegration: true }, "2 tickets;"],
  ])(
    "%s com %i ticket(s) → 409 sem logout e sem apagar nada",
    async (_label, count, body, text) => {
      ticketCount = { count, error: null };

      const res = await POST(req(body));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        ok: false,
        reason: "conversations_have_tickets",
        count,
        error: expect.stringContaining(text),
      });
      // A instância continua conectada.
      expect(logoutMock).not.toHaveBeenCalled();
      expect(conversationsDeleteMock).not.toHaveBeenCalled();
      expect(integrationDelete).not.toHaveBeenCalled();
    }
  );

  it("conta os tickets pela FK da conversa, filtrando pela integração, sem trazer linhas", async () => {
    await POST(req({ wipe: true }));

    expect(ticketSelect).toHaveBeenCalledWith(
      "id, chat_conversations!tickets_conversation_id_fkey!inner(integration_id)",
      { count: "exact", head: true }
    );
    expect(ticketEq).toHaveBeenCalledWith("chat_conversations.integration_id", INTEGRATION_ID);
  });

  it("wipe sem ticket segue o fluxo: logout e apaga as conversas", async () => {
    const res = await POST(req({ wipe: true }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, loggedOut: true, wiped: 2 });
    expect(logoutMock).toHaveBeenCalledWith("https://inst.uazapi.test", "token");
    expect(conversationsDeleteMock).toHaveBeenCalledTimes(1);
    expect(integrationDelete).not.toHaveBeenCalled();
  });

  it("deleteIntegration sem ticket apaga as conversas e a instância", async () => {
    const res = await POST(req({ deleteIntegration: true }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, loggedOut: true, deleted: true, wiped: 2 });
    expect(conversationsDeleteMock).toHaveBeenCalledTimes(1);
    expect(integrationDelete).toHaveBeenCalledTimes(1);
  });

  it("só logout não conta tickets nem apaga nada", async () => {
    const res = await POST(req({}));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, loggedOut: true, wiped: 0 });
    expect(ticketSelect).not.toHaveBeenCalled();
    expect(conversationsDeleteMock).not.toHaveBeenCalled();
  });

  it.each([
    ["wipe", { wipe: true }],
    ["deleteIntegration", { deleteIntegration: true }],
  ])(
    "%s: ticket aberto entre a contagem e o DELETE (23503) → 409, sem a mensagem do banco",
    async (_label, body) => {
      conversationsDelete = {
        data: null,
        error: {
          code: "23503",
          message:
            'update or delete on table "chat_conversations" violates foreign key constraint "tickets_conversation_id_fkey" on table "tickets"',
        },
      };

      const res = await POST(req(body));
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json).toMatchObject({
        ok: false,
        reason: "conversations_have_tickets",
        loggedOut: true,
      });
      expect(JSON.stringify(json)).not.toContain("foreign key");
      expect(integrationDelete).not.toHaveBeenCalled();
    }
  );

  it("contagem que falha → 500 antes do logout, sem a mensagem do banco", async () => {
    ticketCount = { count: null, error: { code: "42501", message: "permission denied for table tickets" } };

    const res = await POST(req({ wipe: true }));

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("permission denied");
    expect(logoutMock).not.toHaveBeenCalled();
    expect(conversationsDeleteMock).not.toHaveBeenCalled();
  });

  it("outro erro no DELETE → 500 sem a mensagem do banco", async () => {
    conversationsDelete = {
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    };

    const res = await POST(req({ wipe: true }));

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("statement timeout");
  });
});

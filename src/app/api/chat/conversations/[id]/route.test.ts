import { beforeEach, describe, expect, it, vi } from "vitest";

const { viewerMock, adminClientMock, fromMock, rpcMock, pushTakeoverMock } = vi.hoisted(() => ({
  viewerMock: vi.fn(),
  adminClientMock: vi.fn(),
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  pushTakeoverMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  getDashboardViewer: viewerMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: adminClientMock,
}));
vi.mock("@/features/chat/lib/push-takeover", () => ({
  pushTakeoverToAgent: pushTakeoverMock,
}));

import { DELETE, PATCH } from "@/app/api/chat/conversations/[id]/route";

const params = { params: Promise.resolve({ id: "conversation-1" }) };

function request(method: "PATCH" | "DELETE", suffix = "", body?: unknown) {
  return new Request(`http://x/api/chat/conversations/conversation-1${suffix}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  viewerMock.mockResolvedValue({ id: "user-1", is_active: true });
  adminClientMock.mockReturnValue({ from: fromMock, rpc: rpcMock });
});

describe("ações de conversa", () => {
  it("recusa uma ação destrutiva sem sessão antes de acessar o banco", async () => {
    viewerMock.mockResolvedValue(null);

    const response = await DELETE(request("DELETE"), params);

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("limpa as mensagens e zera a prévia sem remover a conversa", async () => {
    const conversation = {
      id: "conversation-1",
      lead_id: "lead-1",
      last_message_at: null,
      last_message_preview: null,
      unread_count: 0,
    };
    rpcMock.mockResolvedValue({
      data: { conversation, cleared: 1 },
      error: null,
    });

    const response = await DELETE(request("DELETE", "?mode=clear"), params);

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("clear_chat_conversation", {
      p_conversation_id: "conversation-1",
    });
    expect(await response.json()).toMatchObject({ cleared: 1, conversation });
  });

  it("recusa limpar conversa com ticket com 409, sem repassar o erro do banco", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: "CONVERSATION_HAS_TICKETS",
        code: "P0001",
        details: "A conversa tem ticket: limpar apagaria o histórico do atendimento.",
        hint: null,
      },
    });

    const response = await DELETE(request("DELETE", "?mode=clear"), params);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "A conversa tem ticket; limpar apagaria o histórico do atendimento.",
    });
  });

  it("outro erro ao limpar continua 500 genérico", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "canceling statement due to statement timeout", code: "57014" },
    });

    const response = await DELETE(request("DELETE", "?mode=clear"), params);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal error" });
    consoleError.mockRestore();
  });

  it("remove a conversa da lista sem apagar a pessoa nem as mensagens", async () => {
    const updateConversation = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: { id: "conversation-1" },
            error: null,
          })),
        })),
      })),
    }));
    fromMock.mockReturnValue({ update: updateConversation });

    const response = await DELETE(request("DELETE"), params);

    expect(response.status).toBe(200);
    expect(updateConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        removed_at: expect.any(String),
        archived_at: null,
        pinned_at: null,
      })
    );
    expect(await response.json()).toEqual({ deleted: true, id: "conversation-1" });
  });

  it("marca como não lida sem reduzir uma contagem já existente", async () => {
    const current = { id: "conversation-1", unread_count: 3 };
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
      })),
    }));
    const select = vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: current, error: null })),
      })),
    }));
    fromMock.mockReturnValue({ update, select });

    const response = await PATCH(
      request("PATCH", "", { action: "mark-unread" }),
      params
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ unread_count: 1 }));
    expect(await response.json()).toEqual({ conversation: current });
  });

  it("arquiva sem mudar o status de atendimento nem acionar o takeover", async () => {
    const archived = {
      id: "conversation-1",
      status: "bot",
      archived_at: "2026-08-07T12:00:00.000Z",
    };
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: archived, error: null })),
        })),
      })),
    }));
    fromMock.mockReturnValue({ update });

    const response = await PATCH(request("PATCH", "", { action: "archive" }), params);

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: expect.any(String) })
    );
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ status: expect.anything() }));
    expect(pushTakeoverMock).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ conversation: archived });
  });
});

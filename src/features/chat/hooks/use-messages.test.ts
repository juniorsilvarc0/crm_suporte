import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ChatConversation } from "@/features/chat/types";

type ConversationUpdate = Partial<ChatConversation> & { id: string };

// O Realtime é o do hook de verdade, só que disparado à mão: o teste guarda os
// callbacks do último render.
const { realtime } = vi.hoisted(() => ({
  realtime: { onConversationUpdate: null as ((updated: ConversationUpdate) => void) | null },
}));

vi.mock("@/features/chat/hooks/use-chat-realtime", () => ({
  useChatRealtime: ({
    onConversationUpdate,
  }: {
    onConversationUpdate?: (updated: ConversationUpdate) => void;
  }) => {
    realtime.onConversationUpdate = onConversationUpdate ?? null;
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useMessages } from "@/features/chat/hooks/use-messages";

const CONVERSATION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const CONVERSATION: ChatConversation = {
  id: CONVERSATION_ID,
  integration_id: null,
  contact_id: "contact-1",
  external_id: "5511999990000@s.whatsapp.net",
  contact_name: "Maria Souza",
  contact_phone: "5511999990000",
  contact_avatar_url: null,
  archived_at: null,
  removed_at: null,
  pinned_at: null,
  status: "bot",
  active_ticket_id: null,
  unread_count: 0,
  last_message_at: "2026-09-26T12:00:00+00:00",
  last_message_preview: "Oi, o sistema travou",
  metadata: {},
  created_at: "2026-09-20T12:00:00+00:00",
  updated_at: "2026-09-26T12:00:00+00:00",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  realtime.onConversationUpdate = null;
});

describe("useMessages · setConversationStatus", () => {
  it("a resposta do PATCH não desfaz um Realtime mais novo (prévia, ordem e não lidas)", async () => {
    // O PATCH fica preso até `respondPatch`: o Realtime passa na frente dele.
    let respondPatch: (response: Response) => void = () => {};
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Promise<Response>((resolve) => {
          respondPatch = resolve;
        });
      }
      return Promise.resolve(jsonResponse({ conversation: CONVERSATION, messages: [], hasMore: false }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const onConversationUpdate = vi.fn();
    const { result } = renderHook(() => useMessages({ onConversationUpdate }));

    act(() => result.current.selectConversation(CONVERSATION_ID));
    await waitFor(() => expect(result.current.currentConversation?.id).toBe(CONVERSATION_ID));

    let patch: Promise<void> = Promise.resolve();
    act(() => {
      patch = result.current.setConversationStatus("human");
    });

    // Mensagem nova do cliente, gravada DEPOIS do status: chega antes da resposta.
    const newer: ChatConversation = {
      ...CONVERSATION,
      status: "human",
      unread_count: 2,
      last_message_at: "2026-09-26T12:00:05+00:00",
      last_message_preview: "Ainda travado",
      updated_at: "2026-09-26T12:00:05+00:00",
    };
    act(() => realtime.onConversationUpdate?.(newer));

    // A resposta traz a linha de quando o status foi gravado: prévia e não lidas velhas.
    await act(async () => {
      respondPatch(
        jsonResponse({
          conversation: { ...CONVERSATION, status: "human", updated_at: "2026-09-26T12:00:01+00:00" },
        })
      );
      await patch;
    });

    expect(result.current.currentConversation).toMatchObject({
      status: "human",
      unread_count: 2,
      last_message_at: "2026-09-26T12:00:05+00:00",
      last_message_preview: "Ainda travado",
    });
    // A lista recebe o mesmo recorte: só o que a rota grava.
    expect(onConversationUpdate).toHaveBeenLastCalledWith({ id: CONVERSATION_ID, status: "human" });
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/chat/conversations/${CONVERSATION_ID}`,
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "human" }) })
    );
  });

  it("sem o Realtime, o status gravado pelo PATCH já pinta o cabeçalho", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === "PATCH"
            ? jsonResponse({ conversation: { ...CONVERSATION, status: "human" } })
            : jsonResponse({ conversation: CONVERSATION, messages: [], hasMore: false })
        )
      )
    );
    const onConversationUpdate = vi.fn();
    const { result } = renderHook(() => useMessages({ onConversationUpdate }));

    act(() => result.current.selectConversation(CONVERSATION_ID));
    await waitFor(() => expect(result.current.currentConversation?.id).toBe(CONVERSATION_ID));

    await act(async () => {
      await result.current.setConversationStatus("human");
    });

    expect(result.current.currentConversation?.status).toBe("human");
    expect(onConversationUpdate).toHaveBeenLastCalledWith({ id: CONVERSATION_ID, status: "human" });
  });
});

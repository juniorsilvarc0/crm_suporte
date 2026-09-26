import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

import type { ConversationAction } from "@/features/chat/components/conversation-actions";
import type { ChatConversation } from "@/features/chat/types";

// Em teste: as ações da lista (`onConversationAction`). Os hooks de dado e as
// duas colunas viram marcadores; a lista guarda as props que recebeu.
const { toastMock, clearConversationMessages, listProps } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  clearConversationMessages: vi.fn(),
  listProps: { current: null as Record<string, unknown> | null },
}));

vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/use-viewport-height", () => ({ useViewportHeight: () => {} }));
vi.mock("@/lib/use-media-query", () => ({ useMediaQuery: () => false }));
vi.mock("@/features/chat/hooks/use-conversation-tags", () => ({
  useConversationTags: () => ({ tagsByConversation: new Map(), tags: [] }),
}));
vi.mock("@/features/chat/hooks/use-conversations", () => ({
  useConversations: () => ({
    conversations: [],
    promotedConversationCount: 0,
    lastPromotion: null,
    archivedCount: 0,
    loading: false,
    updateConversation: vi.fn(),
    addConversation: vi.fn(),
    markAsRead: vi.fn(),
    removeConversation: vi.fn(),
  }),
}));
vi.mock("@/features/chat/hooks/use-messages", () => ({
  useMessages: () => ({
    selectedConversationId: null,
    selectConversation: vi.fn(),
    messages: [],
    messagesLoading: false,
    currentConversation: null,
    setConversationStatus: vi.fn(),
    applyConversationUpdate: vi.fn(),
    clearConversationMessages,
  }),
}));
vi.mock("@/features/chat/components/conversations-list", () => ({
  ConversationsList: (props: Record<string, unknown>) => {
    listProps.current = props;
    return null;
  },
}));
vi.mock("@/features/chat/components/chat-view", () => ({ ChatView: () => null }));

import { ChatShell } from "@/features/chat/components/chat-shell";

type OnConversationAction = (
  conversation: Pick<ChatConversation, "id" | "unread_count" | "archived_at" | "pinned_at">,
  action: ConversationAction
) => Promise<boolean>;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  listProps.current = null;
});

describe("ChatShell · limpar conversa com ticket", () => {
  it("o 409 mostra o porquê da rota, não o \"não foi possível\", e não apaga as mensagens", async () => {
    const reason = "A conversa tem ticket; limpar apagaria o histórico do atendimento.";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: reason }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatShell />);
    const onConversationAction = listProps.current?.onConversationAction as OnConversationAction;

    let result: boolean | undefined;
    await act(async () => {
      result = await onConversationAction(
        { id: "c1", unread_count: 0, archived_at: null, pinned_at: null },
        "clear"
      );
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/conversations/c1?mode=clear",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(result).toBe(false);
    expect(toastMock.error).toHaveBeenCalledWith(reason);
    expect(clearConversationMessages).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

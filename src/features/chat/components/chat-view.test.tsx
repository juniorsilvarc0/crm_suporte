import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Em teste: o colar global e a fiação dos tickets. O que busca na rede ou
// desenha por conta própria (rodapé, bolhas, painel do contato, tela de envio,
// chip) vira marcador; o chip e o painel guardam as props que receberam.
const { useConversationTicketsMock, received } = vi.hoisted(() => ({
  useConversationTicketsMock: vi.fn(),
  received: {
    chip: null as Record<string, unknown> | null,
    sheet: null as Record<string, unknown> | null,
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/features/settings/hooks/use-team-directory", () => ({
  useTeamDirectory: () => ({ names: new Map(), currentUserId: null, signature: null }),
}));
vi.mock("@/features/tickets/hooks/use-conversation-tickets", () => ({
  useConversationTickets: (...args: unknown[]) => useConversationTicketsMock(...args),
}));
vi.mock("@/features/tickets/hooks/use-ticket-catalog", () => ({
  useTicketCatalog: () => ({ catalog: null, failed: false, retry: vi.fn() }),
}));
vi.mock("@/features/tickets/components/conversation-ticket-chip", () => ({
  ConversationTicketChip: (props: Record<string, unknown>) => {
    received.chip = props;
    return null;
  },
  focusTicketSummary: () => "",
}));
vi.mock("@/features/chat/components/chat-footer", () => ({ ChatFooter: () => null }));
vi.mock("@/features/chat/components/message-bubble", () => ({ MessageBubble: () => null }));
vi.mock("@/features/chat/components/contact-info-sheet", () => ({
  ContactInfoSheet: (props: Record<string, unknown>) => {
    received.sheet = props;
    return <div>Painel do contato</div>;
  },
}));
vi.mock("@/features/chat/components/file-preview-dialog", () => ({
  FilePreviewDialog: () => <div>Enviar anexo ao cliente</div>,
}));

import { ChatView } from "@/features/chat/components/chat-view";
import type { ConversationTagsController } from "@/features/chat/hooks/use-conversation-tags";
import type { ChatConversation, ChatMessage } from "@/features/chat/types";
import type { ConversationTicketsState } from "@/features/tickets/hooks/use-conversation-tickets";

const TICKET_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const CONVERSATION: ChatConversation = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  integration_id: null,
  contact_id: "contact-1",
  external_id: "5511999990000@s.whatsapp.net",
  contact_name: "Maria Souza",
  contact_phone: null,
  contact_avatar_url: null,
  archived_at: null,
  removed_at: null,
  pinned_at: null,
  status: "human",
  active_ticket_id: null,
  unread_count: 0,
  last_message_at: null,
  last_message_preview: null,
  metadata: {},
  created_at: "2026-09-20T12:00:00+00:00",
  updated_at: "2026-09-26T12:00:00+00:00",
};

/** Com a IA e um ticket em foco: o "Assumir" passa pelo ticket. */
const FOCUSED: ChatConversation = { ...CONVERSATION, status: "bot", active_ticket_id: TICKET_ID };

function inbound(id: string, createdAt: string): ChatMessage {
  return {
    id,
    conversation_id: CONVERSATION.id,
    external_id: null,
    direction: "inbound",
    type: "text",
    content: "oi",
    media_url: null,
    media_mime_type: null,
    quoted_message_id: null,
    delivery_status: "delivered",
    sent_by_user_id: null,
    is_deleted: false,
    metadata: {},
    created_at: createdAt,
  } as ChatMessage;
}

/** A leitura dos tickets do hook falso: o MESMO objeto a cada render. */
function stubTickets(): ConversationTicketsState {
  const tickets: ConversationTicketsState = {
    data: null,
    activeTicket: null,
    fetchedAt: null,
    loading: false,
    error: false,
    refresh: vi.fn(),
    notifyInbound: vi.fn(),
  };
  useConversationTicketsMock.mockReturnValue(tickets);
  return tickets;
}

// O jsdom não rola: o "ir para o fim" da montagem chama `scrollTo` no contêiner.
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});

afterAll(() => {
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

beforeEach(() => {
  stubTickets();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  received.chip = null;
  received.sheet = null;
});

type ChatViewOptions = {
  conversation?: ChatConversation;
  messages?: ChatMessage[];
  onTakeover?: () => void;
  onConversationUpdate?: (updated: Partial<ChatConversation> & { id: string }) => void;
};

function chatView({
  conversation = CONVERSATION,
  messages = [],
  onTakeover = vi.fn(),
  onConversationUpdate = vi.fn(),
}: ChatViewOptions = {}) {
  const noop = vi.fn();
  return (
    <ChatView
      conversation={conversation}
      messages={messages}
      messagesLoading={false}
      drafts={new Map()}
      onSend={noop}
      onSendAudio={noop}
      onSendFile={vi.fn(async () => true)}
      onSendNote={noop}
      onEditMessage={vi.fn(async () => true)}
      onDeleteMessage={vi.fn(async () => true)}
      onForwardMessages={vi.fn(async () => true)}
      conversations={[]}
      onTakeover={onTakeover}
      onConversationUpdate={onConversationUpdate}
      searchOpen={false}
      onSearchOpenChange={noop}
      tagsController={{} as ConversationTagsController}
    />
  );
}

function renderChatView(options: ChatViewOptions = {}) {
  return render(chatView(options));
}

/** Ctrl/Cmd+V de um print: o evento que o navegador dispara na janela. */
function pastePrint() {
  const file = new File(["png"], "print.png", { type: "image/png" });
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { items: [{ kind: "file", getAsFile: () => file }] },
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe("ChatView · colar arquivo", () => {
  it("com a conversa na frente, o print colado abre o envio de anexo", () => {
    renderChatView();

    const event = pastePrint();

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText("Enviar anexo ao cliente")).toBeInTheDocument();
  });

  it("com o painel do contato aberto (a Descrição do Novo ticket), o colar não é do chat", async () => {
    const user = userEvent.setup();
    renderChatView();
    await user.click(screen.getByRole("button", { name: "Dados de Maria Souza" }));
    expect(screen.getByText("Painel do contato")).toBeInTheDocument();

    const event = pastePrint();

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByText("Enviar anexo ao cliente")).toBeNull();
  });
});

describe("ChatView · tickets da conversa", () => {
  it("lê os tickets pela conversa, pelo foco e pelo status; o chip recebe o foco", () => {
    renderChatView({ conversation: FOCUSED });

    expect(useConversationTicketsMock).toHaveBeenLastCalledWith(FOCUSED.id, TICKET_ID, "bot");
    expect(received.chip?.activeTicketId).toBe(TICKET_ID);
  });

  it("o painel do contato recebe a MESMA leitura do cabeçalho, não faz a sua", async () => {
    const user = userEvent.setup();
    const tickets = stubTickets();
    renderChatView({ conversation: FOCUSED });

    await user.click(screen.getByRole("button", { name: "Dados de Maria Souza" }));

    expect(received.sheet?.tickets).toBe(tickets);
  });

  it("\"Assumir\" com foco faz o take-over do ticket, não o PATCH, e aplica a conversa gravada", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          ticket: { id: TICKET_ID, number: 1024 },
          conversation: { id: FOCUSED.id, status: "human" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const onTakeover = vi.fn();
    const onConversationUpdate = vi.fn();
    renderChatView({ conversation: FOCUSED, onTakeover, onConversationUpdate });

    await user.click(screen.getByRole("button", { name: "Assumir" }));

    await waitFor(() =>
      expect(onConversationUpdate).toHaveBeenCalledWith({ id: FOCUSED.id, status: "human" })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/tickets/${TICKET_ID}/take-over`);
    expect(onTakeover).not.toHaveBeenCalled();
  });

  it("mensagem nova do cliente, com foco, avisa o hook (notifyInbound); a carga não", () => {
    const tickets = stubTickets();
    const first = inbound("m1", "2026-09-26T12:00:00+00:00");
    const { rerender } = renderChatView({ conversation: FOCUSED, messages: [first] });
    expect(tickets.notifyInbound).not.toHaveBeenCalled();

    rerender(
      chatView({
        conversation: FOCUSED,
        messages: [first, inbound("m2", "2026-09-26T12:01:00+00:00")],
      })
    );

    expect(tickets.notifyInbound).toHaveBeenCalledTimes(1);
  });
});

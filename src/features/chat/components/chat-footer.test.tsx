import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// O rodapé da conversa: aqui só a barra "Respondendo…", que diz a quem a
// mensagem citada pertence. Sem media query nem seletores (emoji, respostas
// rápidas): nada disso entra na barra.
vi.mock("@/lib/use-media-query", () => ({ useMediaQuery: () => false, useIsMobile: () => false }));
vi.mock("@/features/chat/components/emoji-picker", () => ({ EmojiPicker: () => null }));
vi.mock("@/features/chat/components/quick-reply-picker", () => ({ QuickReplyPicker: () => null }));

import { ChatFooter } from "@/features/chat/components/chat-footer";
import type { ChatMessage } from "@/features/chat/types";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    conversation_id: "c1",
    external_id: "wa-1",
    direction: "outbound",
    sender_type: "agent",
    type: "text",
    content: "Olá! Como posso ajudar?",
    media_url: null,
    media_mime_type: null,
    quoted_message_id: null,
    delivery_status: "sent",
    sent_by_user_id: "u1",
    sent_by_token_id: null,
    is_deleted: false,
    metadata: {},
    created_at: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

function renderFooter(replyingTo: ChatMessage) {
  return render(
    <ChatFooter
      conversationId="c1"
      drafts={new Map()}
      onSend={vi.fn()}
      onSendAudio={vi.fn()}
      status="human"
      replyingTo={replyingTo}
      onCancelReply={vi.fn()}
    />
  );
}

describe("ChatFooter: barra Respondendo…", () => {
  it.each([
    ["a mensagem da IA", message({ sender_type: "ai", sent_by_user_id: null, sent_by_token_id: "tok-1" }), "Respondendo a IA"],
    ["a de uma integração", message({ sender_type: "system", sent_by_user_id: null, sent_by_token_id: "tok-2" }), "Respondendo a integração"],
    ["a de um analista", message(), "Respondendo você mesmo"],
    ["a do cliente", message({ direction: "inbound", sender_type: "contact", sent_by_user_id: null }), "Respondendo o contato"],
  ])("responder %s diz de quem ela é", (_label, replyingTo, text) => {
    renderFooter(replyingTo);

    expect(screen.getByText(text)).toBeInTheDocument();
  });
});

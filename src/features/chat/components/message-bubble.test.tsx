import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MessageBubble } from "@/features/chat/components/message-bubble";
import type { ChatMessage } from "@/features/chat/types";

// Quem enviou, quando não foi uma pessoa: a mensagem e a nota de um token (a IA
// ou uma integração) dizem o que são, e o envio que falhou não oferece o
// reenvio (o servidor recusa: só o token reenvia a mensagem dele).

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

const fromToken = (overrides: Partial<ChatMessage> = {}) =>
  message({ sender_type: "ai", sent_by_user_id: null, sent_by_token_id: "tok-1", ...overrides });

describe("MessageBubble: mensagem de token", () => {
  it("a mensagem da IA diz que é da IA", () => {
    render(<MessageBubble message={fromToken()} />);

    expect(screen.getByText("IA")).toBeInTheDocument();
    expect(screen.getByText("Olá! Como posso ajudar?")).toBeInTheDocument();
  });

  it("a mensagem de uma integração diz que é de uma integração", () => {
    render(<MessageBubble message={fromToken({ sender_type: "system" })} />);

    expect(screen.getByText("Integração")).toBeInTheDocument();
    expect(screen.queryByText("IA")).toBeNull();
  });

  // O rótulo lê o remetente: o banco aceita `ai` sem o token gravado.
  it("a mensagem ai sem o token gravado também diz que é da IA", () => {
    render(<MessageBubble message={fromToken({ sent_by_token_id: null })} />);

    expect(screen.getByText("IA")).toBeInTheDocument();
  });

  it.each([
    ["do analista", message()],
    ["do celular da empresa", message({ sender_type: "device", sent_by_user_id: null })],
    ["do cliente", message({ direction: "inbound", sender_type: "contact", sent_by_user_id: null })],
  ])("a mensagem %s não ganha rótulo", (_label, sample) => {
    render(<MessageBubble message={sample} />);

    expect(screen.queryByText("IA")).toBeNull();
    expect(screen.queryByText("Integração")).toBeNull();
    expect(screen.queryByText("Automático")).toBeNull();
  });

  // O banco não grava mensagem recebida com remetente `ai`; se chegasse uma, a
  // bolha do lado do cliente não ganharia o rótulo de quem responde por nós.
  it("só a mensagem de saída leva o rótulo", () => {
    render(<MessageBubble message={fromToken({ direction: "inbound" })} />);

    expect(screen.queryByText("IA")).toBeNull();
  });

  it("mensagem apagada não mostra de quem era", () => {
    render(<MessageBubble message={fromToken({ is_deleted: true, content: null })} />);

    expect(screen.getByText(/Mensagem apagada/)).toBeInTheDocument();
    expect(screen.queryByText("IA")).toBeNull();
  });
});

describe("MessageBubble: citação", () => {
  const reply = message({ id: "m2", direction: "inbound", sender_type: "contact", sent_by_user_id: null, content: "Entendi" });
  const author = () => screen.getByRole("button", { name: "Ir para a mensagem original" }).firstElementChild;

  it("citar a mensagem da IA diz que ela era da IA, não de quem está vendo", () => {
    render(<MessageBubble message={reply} quoted={fromToken()} />);

    expect(author()).toHaveTextContent("IA");
  });

  it("citar a mensagem de uma integração diz Integração", () => {
    render(<MessageBubble message={reply} quoted={fromToken({ sender_type: "system" })} />);

    expect(author()).toHaveTextContent("Integração");
  });

  it("citar a de um analista ou a do cliente segue como antes", () => {
    const { unmount } = render(<MessageBubble message={reply} quoted={message()} />);
    expect(author()).toHaveTextContent("Você");
    unmount();

    render(<MessageBubble message={message()} quoted={reply} />);
    expect(author()).toHaveTextContent("Contato");
  });
});

describe("MessageBubble: envio que falhou", () => {
  it("o do analista oferece Tentar novamente", async () => {
    const onRetry = vi.fn();
    const failed = message({ delivery_status: "failed", external_id: null });
    render(<MessageBubble message={failed} onRetry={onRetry} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(onRetry).toHaveBeenCalledWith(failed);
    expect(screen.queryByText("Não enviada")).toBeNull();
  });

  it("o de um token só avisa: sem botão, com o texto ao lado do ✕", () => {
    render(
      <MessageBubble message={fromToken({ delivery_status: "failed", external_id: null })} onRetry={vi.fn()} />
    );

    expect(screen.queryByRole("button", { name: "Tentar novamente" })).toBeNull();
    expect(screen.getByText("Não enviada")).toBeInTheDocument();
    expect(screen.getByText("IA")).toBeInTheDocument();
  });

  // A bolha clonada no menu de contexto (toque longo) e a do diálogo de edição
  // não recebem onRetry: o aviso não pode depender dele.
  it("o aviso do token não depende de onRetry, e o ✕ segue ao lado do texto", () => {
    render(<MessageBubble message={fromToken({ delivery_status: "failed", external_id: null })} />);

    expect(screen.getByText("Não enviada")).toBeInTheDocument();
    expect(screen.getByLabelText("Não enviada")).toHaveTextContent("✕");
  });

  it("mensagem de token apagada não avisa a falha por extenso", () => {
    render(<MessageBubble message={fromToken({ delivery_status: "failed", is_deleted: true, content: null })} />);

    expect(screen.getByText(/Mensagem apagada/)).toBeInTheDocument();
    expect(screen.queryByText("Não enviada")).toBeNull();
  });

  it("mensagem de token que saiu não mostra aviso de falha", () => {
    render(<MessageBubble message={fromToken()} onRetry={vi.fn()} />);

    expect(screen.queryByText("Não enviada")).toBeNull();
  });
});

describe("MessageBubble: nota de token", () => {
  const note = (overrides: Partial<ChatMessage> = {}) =>
    fromToken({ type: "note", external_id: null, content: "Cliente pediu um atendente", ...overrides });

  it("a nota da IA é assinada como IA", () => {
    render(<MessageBubble message={note()} viewerId="u1" />);

    expect(screen.getByText("Nota interna")).toBeInTheDocument();
    expect(screen.getByText("IA")).toBeInTheDocument();
    expect(screen.getByText("Cliente pediu um atendente")).toBeInTheDocument();
  });

  it("a nota de uma integração é assinada como Integração", () => {
    render(<MessageBubble message={note({ sender_type: "system" })} viewerId="u1" />);

    expect(screen.getByText("Integração")).toBeInTheDocument();
  });

  // Só o autor edita e apaga: a nota de um token não é de quem está vendo.
  it("ninguém ganha o menu da nota de um token", () => {
    render(<MessageBubble message={note()} viewerId="u1" onEdit={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Opções da anotação" })).toBeNull();
  });

  // O controle do teste acima: sem ele, renomear o gatilho o faria passar no vazio.
  it("a nota de quem está vendo tem o menu", () => {
    render(
      <MessageBubble
        message={message({ type: "note", external_id: null, content: "Liguei para o cliente" })}
        viewerId="u1"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Opções da anotação" })).toBeInTheDocument();
  });
});

describe("MessageBubble: menu da mensagem", () => {
  // A janela de edição conta do envio (15 min): a mensagem precisa ser de agora.
  const now = () => new Date().toISOString();
  const actions = () => ({ onEdit: vi.fn(), onDelete: vi.fn(), onForward: vi.fn() });

  async function openMenu() {
    await userEvent.setup().click(screen.getByRole("button", { name: "Opções da mensagem" }));
    return screen.findByRole("menu");
  }

  it("a mensagem de token não oferece Editar; Encaminhar e Apagar seguem", async () => {
    render(<MessageBubble message={fromToken({ created_at: now() })} {...actions()} />);

    const menu = await openMenu();

    expect(within(menu).queryByRole("menuitem", { name: "Editar" })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Encaminhar" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Apagar" })).toBeInTheDocument();
  });

  it("a mesma mensagem, de um analista, oferece Editar", async () => {
    render(<MessageBubble message={message({ created_at: now() })} {...actions()} />);

    const menu = await openMenu();

    expect(within(menu).getByRole("menuitem", { name: "Editar" })).toBeInTheDocument();
  });
});

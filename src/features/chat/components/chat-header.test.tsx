import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { ChatHeader } from "@/features/chat/components/chat-header";
import type { ChatConversation } from "@/features/chat/types";

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
  status: "bot",
  active_ticket_id: null,
  unread_count: 0,
  last_message_at: null,
  last_message_preview: null,
  metadata: {},
  created_at: "2026-09-20T12:00:00+00:00",
  updated_at: "2026-09-26T12:00:00+00:00",
};

describe("ChatHeader · linha de apoio", () => {
  it("sem ticket em foco, mantém a frase do atendimento", () => {
    render(<ChatHeader conversation={CONVERSATION} onTakeover={vi.fn()} onOpenContact={vi.fn()} />);

    const identity = screen.getByRole("button", { name: "Dados de Maria Souza" });
    expect(within(identity).getByText("Atendimento pela IA")).toBeInTheDocument();
  });

  it("com ticket em foco, a linha vira só texto dentro do botão de identidade", () => {
    render(
      <ChatHeader
        conversation={{ ...CONVERSATION, active_ticket_id: "t1" }}
        onTakeover={vi.fn()}
        onOpenContact={vi.fn()}
        focusTicketSummary="SUP-1024 Em atendimento"
        ticketChip={<button type="button">Chip do ticket</button>}
      />
    );

    const identity = screen.getByRole("button", { name: "Dados de Maria Souza" });
    expect(within(identity).getByText("IA · SUP-1024 Em atendimento")).toBeInTheDocument();
    // O chip clicável fica fora do botão (controle dentro de botão é HTML inválido).
    const chip = screen.getByRole("button", { name: "Chip do ticket" });
    expect(identity).not.toContainElement(chip);
  });
});

describe("ChatHeader · coluna de ações a partir de lg", () => {
  it("o Assumir não encolhe, e a coluna só encolhe com o chip de foco", () => {
    render(
      <ChatHeader
        conversation={{ ...CONVERSATION, status: "human" }}
        onTakeover={vi.fn()}
        ticketChip={<div data-ticket-chip="focus">Chip do ticket</div>}
      />
    );

    const takeover = screen.getByRole("button", { name: "Devolver à IA" });
    expect(takeover).toHaveClass("shrink-0");
    // Sem o chip de foco (só "Abrir ticket"), encolher quebraria o botão em
    // duas linhas: o encolher é condicional ao `data-ticket-chip="focus"`.
    const column = takeover.parentElement;
    expect(column).toHaveClass(
      "shrink-0",
      "lg:has-[[data-ticket-chip=focus]]:min-w-0",
      "lg:has-[[data-ticket-chip=focus]]:shrink"
    );
    expect(column).not.toHaveClass("lg:min-w-0");
    expect(column).not.toHaveClass("lg:shrink");
  });
});

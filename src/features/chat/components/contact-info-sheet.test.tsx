import { useRef } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: toastMock }));

import {
  ContactInfoSheet,
  type ContactInfoInitialView,
} from "@/features/chat/components/contact-info-sheet";
import type { ConversationTagsController } from "@/features/chat/hooks/use-conversation-tags";
import type { ChatConversation } from "@/features/chat/types";
import type { ConversationTicketsState } from "@/features/tickets/hooks/use-conversation-tickets";
import type { TicketListItem } from "@/features/tickets/types";

const VIEWER = "5b0e0c2a-1d3f-4c55-9a77-0c1d2e3f4a5b";
const CONVERSATION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TICKET_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

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
  status: "human",
  active_ticket_id: TICKET_ID,
  unread_count: 0,
  last_message_at: null,
  last_message_preview: null,
  metadata: {},
  created_at: "2026-09-20T12:00:00+00:00",
  updated_at: "2026-09-26T12:00:00+00:00",
};

const TICKET: TicketListItem = {
  id: TICKET_ID,
  number: 1024,
  title: "Erro ao emitir nota",
  status: "em_atendimento",
  priority: "alta",
  version: 3,
  source: "agent",
  conversation_id: CONVERSATION_ID,
  is_terminal: false,
  reopened_count: 0,
  sla_mode: "running",
  sla_first_response_minutes: 60,
  sla_resolution_minutes: 480,
  sla_warn_pct: 80,
  first_response_due_at: "2026-09-26T10:00:00+00:00",
  resolution_due_at: "2026-09-26T17:00:00+00:00",
  first_responded_at: "2026-09-26T09:10:00+00:00",
  sla_paused_at: null,
  resolved_at: null,
  closed_at: null,
  next_due_at: "2026-09-26T17:00:00+00:00",
  last_inbound_at: null,
  replied_after_resolve: false,
  created_at: "2026-09-26T09:00:00+00:00",
  updated_at: "2026-09-26T09:00:00+00:00",
  customer: null,
  contact: { id: "contact-1", name: "Maria Souza", phone: "5511999990000" },
  product: null,
  assignee: null,
};

// Só o que o painel lê do controlador de etiquetas.
const TAGS = {
  tags: [],
  tagsByConversation: new Map(),
  loading: false,
  failed: false,
  assign: vi.fn(),
  createTag: vi.fn(),
  retry: vi.fn(),
} as unknown as ConversationTagsController;

const originalMatchMedia = window.matchMedia;

// O Dialog pergunta a largura: no teste, desktop.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((media: string) => ({
      matches: false,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Fetch por URL: o painel lê o contato, a equipe, o catálogo e os tickets.
 * `tickets` responde cada leitura dos tickets da conversa, na ordem (a última
 * se repete).
 */
function routeFetch({
  tickets,
  createTicket,
}: {
  tickets: Array<() => Response>;
  createTicket?: () => Response;
}) {
  let ticketReads = 0;
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url === `/api/chat/conversations/${CONVERSATION_ID}/contact`) {
      return jsonResponse({
        contact: { id: "contact-1", notes: null, email: null, created_at: "2026-09-01T12:00:00+00:00" },
        customer: null,
      });
    }
    if (url === "/api/app-users") {
      return jsonResponse({ ok: true, users: [], currentUserId: VIEWER });
    }
    if (url === "/api/tickets/catalog") {
      return jsonResponse({
        ok: true,
        statuses: null,
        transitions: [{ from_status: "em_atendimento", to_status: "resolvido" }],
        priorities: null,
        products: [],
        categories: [],
      });
    }
    if (url.startsWith("/api/tickets?conversation_id=")) {
      const respond = tickets[Math.min(ticketReads, tickets.length - 1)]!;
      ticketReads += 1;
      return respond();
    }
    if (url === "/api/tickets" && init?.method === "POST" && createTicket) return createTicket();
    throw new Error(`fetch inesperado: ${init?.method ?? "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ticketsOk = () => jsonResponse({ ok: true, active_ticket_id: TICKET_ID, tickets: [TICKET] });
const ticketsFail = () => jsonResponse({ ok: false, message: "Falhou." }, 500);

function ticketReads(fetchMock: ReturnType<typeof routeFetch>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/tickets?")).length;
}

function Harness({
  conversation,
  initialView,
  tickets,
  onClose,
}: {
  conversation: ChatConversation;
  initialView?: ContactInfoInitialView;
  tickets?: ConversationTicketsState;
  onClose: () => void;
}) {
  const conversationRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={conversationRef}>
      <ContactInfoSheet
        conversation={conversation}
        portalContainer={conversationRef}
        tagsController={TAGS}
        onClose={onClose}
        initialView={initialView}
        tickets={tickets}
      />
    </div>
  );
}

function renderSheet(initialView?: ContactInfoInitialView, conversation = CONVERSATION) {
  const onClose = vi.fn();
  render(<Harness conversation={conversation} initialView={initialView} onClose={onClose} />);
  return { onClose };
}

function title() {
  return screen.getByRole("heading", { level: 2, name: /Dados do contato|Novo ticket|Tickets/ });
}

describe("ContactInfoSheet · tickets", () => {
  it("a falha dos tickets fica no grupo: o resto do painel segue, e \"Tentar de novo\" relê", async () => {
    const user = userEvent.setup();
    const fetchMock = routeFetch({ tickets: [ticketsFail, ticketsOk] });
    renderSheet();

    expect(await screen.findByText("Não foi possível carregar os tickets.")).toBeInTheDocument();
    // O resto do painel não caiu.
    expect(screen.getByText("Maria Souza")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar etiqueta" })).toBeInTheDocument();
    expect(await screen.findByText("Contato desde")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByText("SUP-1024 · em foco")).toBeInTheDocument();
    expect(ticketReads(fetchMock)).toBe(2);
  });

  it("abre na vista pedida (initialView) e o Esc sobe para a vista-pai sem fechar o painel", async () => {
    const user = userEvent.setup();
    routeFetch({ tickets: [ticketsOk] });
    const { onClose } = renderSheet("tickets");

    expect(title()).toHaveTextContent("Tickets");
    expect(await screen.findByRole("button", { name: /SUP-1024/ })).toBeDisabled();

    await user.keyboard("{Escape}");

    expect(title()).toHaveTextContent("Dados do contato");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Esc no Novo ticket sujo pergunta \"Descartar?\" na própria vista; cada Esc desfaz uma coisa", async () => {
    const user = userEvent.setup();
    routeFetch({ tickets: [ticketsOk] });
    const { onClose } = renderSheet("ticket-new");

    expect(title()).toHaveTextContent("Novo ticket");
    await user.type(screen.getByLabelText("Título"), "Rascunho do ticket");

    await user.keyboard("{Escape}");
    expect(screen.getByText("Descartar o novo ticket?")).toBeInTheDocument();
    expect(title()).toHaveTextContent("Novo ticket");

    // O 2º Esc só fecha a pergunta: o texto continua.
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Descartar o novo ticket?")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toHaveValue("Rascunho do ticket");
    expect(title()).toHaveTextContent("Novo ticket");

    // "Voltar" pergunta do mesmo jeito; "Descartar" sobe para os dados do contato.
    await user.click(screen.getByRole("button", { name: "Voltar para os dados do contato" }));
    await user.click(screen.getByRole("button", { name: "Descartar" }));
    expect(title()).toHaveTextContent("Dados do contato");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Esc no Novo ticket limpo volta direto para os dados do contato", async () => {
    const user = userEvent.setup();
    routeFetch({ tickets: [ticketsOk] });
    renderSheet("ticket-new");

    await user.keyboard("{Escape}");

    expect(screen.queryByText("Descartar o novo ticket?")).not.toBeInTheDocument();
    expect(title()).toHaveTextContent("Dados do contato");
  });

  it("toque fora com o Novo ticket limpo fecha o painel", async () => {
    const user = userEvent.setup();
    routeFetch({ tickets: [ticketsOk] });
    const { onClose } = renderSheet("ticket-new");

    await user.click(document.body);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("toque fora com o Novo ticket sujo pergunta \"Descartar?\" e não fecha", async () => {
    const user = userEvent.setup();
    routeFetch({ tickets: [ticketsOk] });
    const { onClose } = renderSheet("ticket-new");
    await user.type(screen.getByLabelText("Título"), "Rascunho do ticket");

    await user.click(document.body);

    expect(await screen.findByText("Descartar o novo ticket?")).toBeInTheDocument();
    expect(title()).toHaveTextContent("Novo ticket");
    expect(screen.getByLabelText("Título")).toHaveValue("Rascunho do ticket");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("abrir ticket pelo grupo volta para os dados do contato e relê os tickets", async () => {
    const user = userEvent.setup();
    const fetchMock = routeFetch({
      tickets: [
        () => jsonResponse({ ok: true, active_ticket_id: null, tickets: [] }),
        ticketsOk,
      ],
      createTicket: () =>
        jsonResponse({ ok: true, created: true, linked_messages: 0, ticket: { id: TICKET_ID, number: 1024 } }, 201),
    });
    renderSheet(undefined, { ...CONVERSATION, active_ticket_id: null });

    expect(await screen.findByText("Nenhum ticket aberto")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Novo ticket" }));
    expect(title()).toHaveTextContent("Novo ticket");

    await user.type(screen.getByLabelText("Título"), "Erro ao emitir nota");
    await user.click(screen.getByRole("button", { name: "Abrir ticket" }));

    await waitFor(() => expect(title()).toHaveTextContent("Dados do contato"));
    expect(toastMock.success).toHaveBeenCalledWith("Ticket SUP-1024 aberto.");
    await waitFor(() => expect(ticketReads(fetchMock)).toBe(2));
  });

  it("com os tickets de quem monta (o ChatView), não lê os seus e o ticket aberto aqui relê os de lá", async () => {
    const user = userEvent.setup();
    const fetchMock = routeFetch({
      tickets: [ticketsOk],
      createTicket: () =>
        jsonResponse({ ok: true, created: true, linked_messages: 0, ticket: { id: TICKET_ID, number: 1024 } }, 201),
    });
    const refresh = vi.fn();
    const shared: ConversationTicketsState = {
      data: { active_ticket_id: null, tickets: [] },
      activeTicket: null,
      fetchedAt: "2026-09-26T12:00:00.000Z",
      loading: false,
      error: false,
      refresh,
      notifyInbound: vi.fn(),
    };
    render(
      <Harness
        conversation={{ ...CONVERSATION, active_ticket_id: null }}
        tickets={shared}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Nenhum ticket aberto")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Novo ticket" }));
    await user.type(screen.getByLabelText("Título"), "Erro ao emitir nota");
    await user.click(screen.getByRole("button", { name: "Abrir ticket" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(ticketReads(fetchMock)).toBe(0);
  });
});

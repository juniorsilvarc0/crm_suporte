import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: toastMock }));

import {
  ConversationTicketsFocusList,
  ConversationTicketsGroup,
} from "@/features/tickets/components/conversation-tickets-group";
import type { ConversationTicketsState } from "@/features/tickets/hooks/use-conversation-tickets";
import type { TicketListItem, TicketSummary, TicketTransition } from "@/features/tickets/types";

const VIEWER = "5b0e0c2a-1d3f-4c55-9a77-0c1d2e3f4a5b";
const OTHER_USER = "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CONVERSATION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const FETCHED_AT = "2026-09-26T15:00:00.000Z";

function ticket(id: string, number: number, overrides: Partial<TicketListItem> = {}): TicketListItem {
  return {
    id,
    number,
    title: `Ticket ${number}`,
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
    // Duas horas depois do FETCHED_AT: "Vence em 2 horas".
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
    assignee: { id: VIEWER, name: "Ana", avatar_color: "violet", avatar_url: null },
    ...overrides,
  };
}

const T1 = ticket("t1", 1024);
const T2 = ticket("t2", 1025, { title: "Impressora fiscal", status: "aguardando_cliente", sla_mode: "paused" });

/** O `ticket` das rotas de escrita: o resumo gravado (ticketSummarySchema), não a linha da lista. */
function summaryOf(item: TicketListItem, overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: item.id,
    number: item.number,
    title: item.title,
    status: item.status,
    priority: item.priority,
    version: item.version,
    conversation_id: item.conversation_id,
    assigned_to_user_id: item.assignee?.id ?? null,
    product_id: item.product?.id ?? null,
    category_id: null,
    customer_id: item.customer?.id ?? null,
    contract_id: null,
    first_response_due_at: item.first_response_due_at,
    resolution_due_at: item.resolution_due_at,
    first_responded_at: item.first_responded_at,
    sla_paused_at: item.sla_paused_at,
    resolved_at: item.resolved_at,
    closed_at: item.closed_at,
    updated_at: item.updated_at,
    ...overrides,
  };
}

const TRANSITIONS: TicketTransition[] = [
  { from_status: "em_atendimento", to_status: "aguardando_cliente" },
  { from_status: "em_atendimento", to_status: "resolvido" },
  { from_status: "em_atendimento", to_status: "cancelado" },
];

function state(overrides: Partial<ConversationTicketsState> = {}): ConversationTicketsState {
  return {
    data: { active_ticket_id: T1.id, tickets: [T1, T2] },
    activeTicket: T1,
    fetchedAt: FETCHED_AT,
    loading: false,
    error: false,
    refresh: vi.fn(),
    notifyInbound: vi.fn(),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestOf(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index] as unknown as [string, RequestInit];
  return { url, method: init.method, body: JSON.parse(String(init.body)) as unknown };
}

function renderGroup(props: Partial<Parameters<typeof ConversationTicketsGroup>[0]> = {}) {
  const onChangeFocus = vi.fn();
  const onNewTicket = vi.fn();
  const utils = render(
    <ConversationTicketsGroup
      state={state()}
      activeTicketId={T1.id}
      catalog={{ statuses: null, transitions: TRANSITIONS }}
      catalogFailed={false}
      onRetryCatalog={vi.fn()}
      viewerId={VIEWER}
      onChangeFocus={onChangeFocus}
      onNewTicket={onNewTicket}
      {...props}
    />
  );
  return { ...utils, onChangeFocus, onNewTicket };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ConversationTicketsGroup", () => {
  it("mostra o ticket em foco com selos, até 2 ações rápidas e os atalhos", async () => {
    const user = userEvent.setup();
    const { onChangeFocus, onNewTicket } = renderGroup();

    expect(screen.getByText("SUP-1024 · em foco")).toBeInTheDocument();
    expect(screen.getByText("Ticket 1024")).toBeInTheDocument();
    expect(screen.getByText("Em atendimento")).toBeInTheDocument();
    expect(screen.getByText("Alta")).toBeInTheDocument();
    expect(screen.getByText("Vence em 2 horas")).toBeInTheDocument();
    // Aguardar cliente e Resolver: Cancelar não é ação rápida, e o teto é 2.
    expect(screen.getByRole("button", { name: "Aguardar cliente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolver" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir ticket" })).toHaveAttribute(
      "href",
      "/app/tickets/1024"
    );

    await user.click(screen.getByRole("button", { name: "Trocar foco (2 abertos)" }));
    await user.click(screen.getByRole("button", { name: "Novo ticket" }));
    expect(onChangeFocus).toHaveBeenCalledTimes(1);
    expect(onNewTicket).toHaveBeenCalledTimes(1);
  });

  it("ação rápida manda a versão lida, avisa e relê", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(
      jsonResponse({
        ok: true,
        ticket: summaryOf(T1, { status: "resolvido", version: T1.version + 1 }),
        from: "em_atendimento",
        to: "resolvido",
        changed: true,
      })
    );
    const tickets = state();
    renderGroup({ state: tickets });

    await user.click(screen.getByRole("button", { name: "Resolver" }));

    await waitFor(() => expect(tickets.refresh).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock)).toEqual({
      url: "/api/tickets/t1/transition",
      method: "POST",
      body: { to: "resolvido", version: 3 },
    });
    expect(toastMock.success).toHaveBeenCalledWith("SUP-1024 movido para Resolvido.");
  });

  it("conflito de versão avisa e relê", async () => {
    const user = userEvent.setup();
    stubFetch(jsonResponse({ ok: false, code: "version_conflict", message: "x", current_version: 4 }, 409));
    const tickets = state();
    renderGroup({ state: tickets });

    await user.click(screen.getByRole("button", { name: "Aguardar cliente" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("O ticket mudou em outro lugar."));
    expect(tickets.refresh).toHaveBeenCalledTimes(1);
  });

  it("Atender faz take-over; se alguém já pegou, avisa e relê", async () => {
    const user = userEvent.setup();
    const free = ticket("t1", 1024, { assignee: null });
    const fetchMock = stubFetch(
      jsonResponse({
        ok: true,
        ticket: summaryOf(free, { assigned_to_user_id: VIEWER, version: free.version + 1 }),
        conversation: { id: CONVERSATION_ID, status: "human" },
      }),
      jsonResponse(
        {
          ok: false,
          code: "already_assigned",
          message: "x",
          assigned_to_user_id: OTHER_USER,
          assigned_to_name: "Bruno",
        },
        409
      )
    );
    const tickets = state({ data: { active_ticket_id: free.id, tickets: [free] }, activeTicket: free });
    renderGroup({ state: tickets });

    await user.click(screen.getByRole("button", { name: "Atender" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Você assumiu SUP-1024."));
    expect(requestOf(fetchMock)).toEqual({ url: "/api/tickets/t1/take-over", method: "POST", body: {} });

    await user.click(screen.getByRole("button", { name: "Atender" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Alguém já pegou este ticket."));
    expect(tickets.refresh).toHaveBeenCalledTimes(2);
  });

  it("sem quem está logado ou sem catálogo, não oferece ação rápida", () => {
    const { unmount } = renderGroup({ viewerId: null });
    expect(screen.queryByRole("button", { name: "Resolver" })).not.toBeInTheDocument();
    unmount();

    renderGroup({ catalog: null });
    expect(screen.queryByRole("button", { name: "Resolver" })).not.toBeInTheDocument();
    // O resto do grupo continua.
    expect(screen.getByRole("link", { name: "Abrir ticket" })).toBeInTheDocument();
  });

  it("sem a matriz de transições, diz que as ações não vieram e oferece reler o catálogo", async () => {
    const user = userEvent.setup();
    const onRetryCatalog = vi.fn();
    renderGroup({ catalog: null, catalogFailed: true, onRetryCatalog });

    expect(screen.getByText("Não foi possível carregar as ações do ticket.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(onRetryCatalog).toHaveBeenCalledTimes(1);
  });

  it("falha sem dado: aviso com \"Tentar de novo\", nunca \"nenhum ticket\"", async () => {
    const user = userEvent.setup();
    const tickets = state({ data: null, activeTicket: null, fetchedAt: null, error: true });
    renderGroup({ state: tickets });

    expect(screen.getByText("Não foi possível carregar os tickets.")).toBeInTheDocument();
    expect(screen.queryByText(/Nenhum ticket/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo ticket" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(tickets.refresh).toHaveBeenCalledTimes(1);
  });

  it("falha numa releitura mantém o dado anterior e avisa", () => {
    renderGroup({ state: state({ error: true }) });

    expect(screen.getByText("Não foi possível atualizar os tickets.")).toBeInTheDocument();
    expect(screen.getByText("SUP-1024 · em foco")).toBeInTheDocument();
  });

  it("sem ticket: diz que não há e oferece só o Novo ticket", () => {
    renderGroup({
      state: state({ data: { active_ticket_id: null, tickets: [] }, activeTicket: null }),
      activeTicketId: null,
    });

    expect(screen.getByText("Nenhum ticket aberto")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /foco/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo ticket" })).toBeInTheDocument();
  });

  it("sem foco, com tickets abertos: oferece escolher o foco", () => {
    renderGroup({
      state: state({ data: { active_ticket_id: null, tickets: [T1] }, activeTicket: null }),
      activeTicketId: null,
    });

    expect(screen.getByText("Nenhum ticket em foco")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escolher o foco (1 aberto)" })).toBeInTheDocument();
  });

  it("foco novo do Realtime antes da releitura: espera, sem dizer \"nenhum em foco\"", () => {
    renderGroup({
      state: state({ data: { active_ticket_id: null, tickets: [T1] }, activeTicket: null }),
      activeTicketId: "t9",
    });

    expect(screen.queryByText("Nenhum ticket em foco")).not.toBeInTheDocument();
  });
});

describe("ConversationTicketsFocusList", () => {
  function renderList(props: Partial<Parameters<typeof ConversationTicketsFocusList>[0]> = {}) {
    const onFocused = vi.fn();
    render(
      <ConversationTicketsFocusList
        conversationId={CONVERSATION_ID}
        state={state()}
        activeTicketId={T1.id}
        statuses={null}
        onFocused={onFocused}
        {...props}
      />
    );
    return { onFocused };
  }

  it("trocar o foco faz PUT active-ticket, avisa, relê e volta", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(jsonResponse({ ok: true, active_ticket_id: "t2", changed: true }));
    const tickets = state();
    const { onFocused } = renderList({ state: tickets });

    const current = screen.getByRole("button", { name: /SUP-1024/ });
    expect(current).toBeDisabled();
    expect(current).toHaveAttribute("aria-current", "true");

    await user.click(screen.getByRole("button", { name: /SUP-1025/ }));

    await waitFor(() => expect(onFocused).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/chat/conversations/${CONVERSATION_ID}/active-ticket`,
      method: "PUT",
      body: { ticket_id: "t2" },
    });
    expect(tickets.refresh).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalledWith("SUP-1025 agora está em foco na conversa.");
  });

  it("recusa (ticket encerrado) avisa, relê e fica na lista", async () => {
    const user = userEvent.setup();
    stubFetch(
      jsonResponse(
        { ok: false, code: "ticket_terminal", message: "Ticket encerrado não pode ser alterado." },
        409
      )
    );
    const tickets = state();
    const { onFocused } = renderList({ state: tickets });

    await user.click(screen.getByRole("button", { name: /SUP-1025/ }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Ticket encerrado não pode ser alterado.")
    );
    expect(tickets.refresh).toHaveBeenCalledTimes(1);
    expect(onFocused).not.toHaveBeenCalled();
  });

  it("422 (o ticket é de outra conversa) avisa o campo e relê", async () => {
    const user = userEvent.setup();
    stubFetch(
      jsonResponse(
        {
          ok: false,
          code: "ticket_not_in_conversation",
          message: "O ticket não é desta conversa.",
          errors: { ticket_id: ["O ticket não é desta conversa."] },
        },
        422
      )
    );
    const tickets = state();
    const { onFocused } = renderList({ state: tickets });

    await user.click(screen.getByRole("button", { name: /SUP-1025/ }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("O ticket não é desta conversa."));
    expect(tickets.refresh).toHaveBeenCalledTimes(1);
    expect(onFocused).not.toHaveBeenCalled();
  });

  it("changed: false (já estava em foco) não avisa, mas relê e volta", async () => {
    const user = userEvent.setup();
    stubFetch(jsonResponse({ ok: true, active_ticket_id: "t2", changed: false }));
    const tickets = state();
    const { onFocused } = renderList({ state: tickets });

    await user.click(screen.getByRole("button", { name: /SUP-1025/ }));

    await waitFor(() => expect(onFocused).toHaveBeenCalledTimes(1));
    expect(tickets.refresh).toHaveBeenCalledTimes(1);
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("dois cliques antes de a lista desabilitar ainda fazem UM PUT (a trava é a ref)", async () => {
    let release: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderList();

    const target = screen.getByRole("button", { name: /SUP-1025/ });
    // No mesmo tique: o React ainda não desenhou o `disabled` da 1ª troca.
    act(() => {
      fireEvent.click(target);
      fireEvent.click(target);
    });
    await act(async () => release(jsonResponse({ ok: true, active_ticket_id: "t2", changed: true })));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falha da leitura tem \"Tentar de novo\"", async () => {
    const user = userEvent.setup();
    const tickets = state({ data: null, activeTicket: null, fetchedAt: null, error: true });
    renderList({ state: tickets });

    const card = screen.getByText("Não foi possível carregar os tickets.").parentElement!;
    await user.click(within(card).getByRole("button", { name: "Tentar de novo" }));
    expect(tickets.refresh).toHaveBeenCalledTimes(1);
  });
});

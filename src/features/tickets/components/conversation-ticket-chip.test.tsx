import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: toastMock }));

import {
  ConversationTicketChip,
  focusTicketSummary,
} from "@/features/tickets/components/conversation-ticket-chip";
import type { ConversationTicketsState } from "@/features/tickets/hooks/use-conversation-tickets";
import type { TicketListItem, TicketTransition } from "@/features/tickets/types";

const VIEWER = "5b0e0c2a-1d3f-4c55-9a77-0c1d2e3f4a5b";
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
const T2 = ticket("t2", 1025, { status: "aguardando_cliente", sla_mode: "paused" });

const TRANSITIONS: TicketTransition[] = [
  { from_status: "em_atendimento", to_status: "aguardando_cliente" },
  { from_status: "em_atendimento", to_status: "resolvido" },
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

function renderChip(props: Partial<Parameters<typeof ConversationTicketChip>[0]> = {}) {
  const onNewTicket = vi.fn();
  const onChangeFocus = vi.fn();
  const onRetryCatalog = vi.fn();
  const utils = render(
    <ConversationTicketChip
      activeTicketId={T1.id}
      state={state()}
      catalog={{ statuses: null, transitions: TRANSITIONS }}
      catalogFailed={false}
      onRetryCatalog={onRetryCatalog}
      viewerId={VIEWER}
      onNewTicket={onNewTicket}
      onChangeFocus={onChangeFocus}
      {...props}
    />
  );
  return { ...utils, onNewTicket, onChangeFocus, onRetryCatalog };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Ações de SUP-1024" }));
  return screen.findByRole("menu");
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("focusTicketSummary", () => {
  it("deve juntar o protocolo e o rótulo do status, com o do catálogo quando existe", () => {
    expect(focusTicketSummary(T1, null)).toBe("SUP-1024 Em atendimento");
    expect(
      focusTicketSummary(T1, [
        {
          key: "em_atendimento",
          label: "Atendendo",
          color: "blue",
          position: 30,
          sla_mode: "running",
          is_terminal: false,
        },
      ])
    ).toBe("SUP-1024 Atendendo");
  });
});

describe("ConversationTicketChip · sem foco", () => {
  it("deve virar \"Abrir ticket\", que abre o Novo ticket do painel, mesmo antes da leitura", async () => {
    const user = userEvent.setup();
    const { container, onNewTicket } = renderChip({
      activeTicketId: null,
      state: state({ data: null, activeTicket: null, fetchedAt: null, loading: true }),
    });

    expect(screen.queryByRole("link")).toBeNull();
    // Sem a marca, a coluna do cabeçalho não encolhe (nada aqui trunca).
    expect(container.querySelector("[data-ticket-chip]")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Abrir ticket" }));

    expect(onNewTicket).toHaveBeenCalledTimes(1);
  });
});

describe("ConversationTicketChip · com foco", () => {
  it("deve levar ao detalhe pelo protocolo, com o selo do SLA", () => {
    renderChip();

    const link = screen.getByRole("link", { name: /SUP-1024/ });
    expect(link).toHaveAttribute("href", "/app/tickets/1024");
    expect(within(link).getByText("Vence em 2 horas")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir ticket" })).toBeNull();
    // A marca que deixa a coluna do cabeçalho encolher (o selo trunca).
    expect(link.closest("[data-ticket-chip]")).toHaveAttribute("data-ticket-chip", "focus");
  });

  it("o menu deve trazer as ações rápidas, Abrir ticket e Trocar foco", async () => {
    const user = userEvent.setup();
    const { onChangeFocus } = renderChip();

    const menu = await openMenu(user);
    const labels = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(labels).toEqual(["Aguardar cliente", "Resolver", "Abrir ticket", "Trocar foco (2 abertos)"]);
    expect(within(menu).getByRole("menuitem", { name: "Abrir ticket" })).toHaveAttribute(
      "href",
      "/app/tickets/1024"
    );

    await user.click(within(menu).getByRole("menuitem", { name: "Trocar foco (2 abertos)" }));
    expect(onChangeFocus).toHaveBeenCalledTimes(1);
  });

  it("com um ticket só não oferece Trocar foco", async () => {
    const user = userEvent.setup();
    renderChip({ state: state({ data: { active_ticket_id: T1.id, tickets: [T1] } }) });

    const menu = await openMenu(user);
    expect(within(menu).queryByRole("menuitem", { name: /Trocar foco/ })).toBeNull();
  });

  it("a ação rápida do menu deve mandar a transição com a versão lida e reler", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, changed: true, from: "em_atendimento", to: "resolvido", ticket: { id: T1.id } })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderChip({ state: state({ refresh }) });

    const menu = await openMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Resolver" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/tickets/${T1.id}/transition`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ to: "resolvido", version: 3 });
    expect(toastMock.success).toHaveBeenCalledWith("SUP-1024 movido para Resolvido.");
  });

  it("sem a matriz, o menu diz que as ações não vieram e oferece reler o catálogo", async () => {
    const user = userEvent.setup();
    const { onRetryCatalog } = renderChip({ catalog: { statuses: null, transitions: null } });

    const menu = await openMenu(user);
    expect(within(menu).getByText("Não foi possível carregar as ações.")).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Resolver" })).toBeNull();

    await user.click(within(menu).getByRole("menuitem", { name: "Tentar de novo" }));
    expect(onRetryCatalog).toHaveBeenCalledTimes(1);
  });

  it("enquanto a leitura não traz o foco, é esqueleto, nunca \"Abrir ticket\"", () => {
    renderChip({ state: state({ data: null, activeTicket: null, fetchedAt: null, loading: true }) });
    expect(screen.queryByRole("button", { name: "Abrir ticket" })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();

    // O foco novo chegou pelo Realtime antes da releitura.
    renderChip({
      activeTicketId: "t9",
      state: state({ activeTicket: null }),
    });
    expect(screen.queryByRole("button", { name: "Abrir ticket" })).toBeNull();
  });

  it("a leitura confirma o foco sem trazê-lo entre os abertos: vira \"Abrir ticket\"", async () => {
    const user = userEvent.setup();
    const { onNewTicket } = renderChip({
      state: state({ data: { active_ticket_id: T1.id, tickets: [T2] }, activeTicket: null }),
    });

    expect(screen.queryByRole("link")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Abrir ticket" }));

    expect(onNewTicket).toHaveBeenCalledTimes(1);
  });

  it("a falha sem o ticket em foco vira \"Recarregar ticket\", que relê", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    renderChip({
      state: state({ data: null, activeTicket: null, fetchedAt: null, error: true, refresh }),
    });

    expect(screen.queryByRole("button", { name: "Abrir ticket" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Recarregar ticket" }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

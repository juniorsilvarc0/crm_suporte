import { Suspense, use, useEffect, useState } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { pushMock, refreshMock, toastMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { TicketDetailView } from "@/features/tickets/components/ticket-detail";
import type {
  TicketCatalog,
  TicketDetail,
  TicketTeamMember,
  TicketTimelinePage,
} from "@/features/tickets/types";

const VIEWER = "5b0e0c2a-1d3f-4c55-9a77-0c1d2e3f4a5b";
const OTHER_USER = "8f14e45f-ceea-4e67-a3b1-9c0d1e2f3a4b";
const TICKET_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CONVERSATION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const FETCHED_AT = "2026-09-25T15:00:00.000Z";

const originalMatchMedia = window.matchMedia;

// O Dialog decide entre caixa e gaveta pela largura: no teste, desktop.
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
  refreshGate.suspend = null;
});

const ticket = (overrides: Partial<TicketDetail> = {}): TicketDetail => ({
  id: TICKET_ID,
  number: 1024,
  title: "Erro ao emitir nota fiscal",
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
  first_response_due_at: "2026-09-25T10:00:00+00:00",
  // Duas horas depois do fetchedAt: "Vence em 2 horas".
  resolution_due_at: "2026-09-25T17:00:00.123456+00:00",
  first_responded_at: "2026-09-25T09:10:00+00:00",
  sla_paused_at: null,
  resolved_at: null,
  closed_at: null,
  next_due_at: "2026-09-25T17:00:00.123456+00:00",
  last_inbound_at: null,
  created_at: "2026-09-25T09:00:00+00:00",
  updated_at: "2026-09-25T12:30:00.5+00:00",
  customer: {
    id: "a1",
    legal_name: "Padaria S. João Ltda",
    trade_name: "Padaria São João",
    contract_status: "ativo",
  },
  contact: { id: "p1", name: "Maria Souza", phone: "5527999990000" },
  product: { id: "q1", name: "ERP", color: "sky" },
  assignee: { id: VIEWER, name: "Você Mesmo", avatar_color: "violet", avatar_url: null },
  description: "A nota sai com o CFOP errado.",
  contact_id: "p1",
  customer_id: "a1",
  contract_id: null,
  product_id: "q1",
  category_id: "c1",
  assigned_to_user_id: VIEWER,
  first_ai_response_at: null,
  contract: null,
  creator: { id: VIEWER, name: "Você Mesmo" },
  category: { id: "c1", name: "Impressão", archived_at: null },
  in_focus: false,
  ...overrides,
});

const catalog = (overrides: Partial<TicketCatalog> = {}): TicketCatalog => ({
  statuses: null,
  transitions: [
    { from_status: "em_atendimento", to_status: "aguardando_cliente" },
    { from_status: "em_atendimento", to_status: "resolvido" },
    { from_status: "em_atendimento", to_status: "cancelado" },
    { from_status: "resolvido", to_status: "em_atendimento" },
    { from_status: "resolvido", to_status: "fechado" },
  ],
  priorities: [
    { priority: "baixa", rank: 1, first_response_minutes: 480, resolution_minutes: 4320, warn_pct: 80 },
    { priority: "media", rank: 2, first_response_minutes: 240, resolution_minutes: 1440, warn_pct: 80 },
    { priority: "alta", rank: 3, first_response_minutes: 60, resolution_minutes: 480, warn_pct: 80 },
    { priority: "critica", rank: 4, first_response_minutes: 15, resolution_minutes: 240, warn_pct: 80 },
  ],
  products: [
    { id: "q1", name: "ERP", niche: null, color: "sky", archived_at: null },
    { id: "q2", name: "Fiscal", niche: null, color: "emerald", archived_at: null },
  ],
  categories: [
    { id: "c1", name: "Impressão", product_id: "q1", parent_id: null, archived_at: null },
    { id: "c2", name: "Geral", product_id: null, parent_id: null, archived_at: null },
  ],
  ...overrides,
});

const TEAM: TicketTeamMember[] = [
  { id: OTHER_USER, name: "Ana Lima", avatar_color: "sky", avatar_url: null, is_active: true },
  { id: VIEWER, name: "Você Mesmo", avatar_color: "violet", avatar_url: null, is_active: true },
];

const EMPTY_TIMELINE: TicketTimelinePage = { items: [], hasMore: false, nextBefore: null };

function renderDetail({
  ticketOverrides,
  catalogOverrides,
}: {
  ticketOverrides?: Partial<TicketDetail>;
  catalogOverrides?: Partial<TicketCatalog>;
} = {}) {
  return render(
    <TicketDetailView
      ticket={ticket(ticketOverrides)}
      attachments={[]}
      timeline={EMPTY_TIMELINE}
      catalog={catalog(catalogOverrides)}
      team={TEAM}
      viewerId={VIEWER}
      fetchedAt={FETCHED_AT}
    />
  );
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("fetch inesperado");
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestOf(fetchMock: ReturnType<typeof stubFetch>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index] as unknown as [string, RequestInit];
  return { url, method: init.method, body: JSON.parse(String(init.body)) as unknown };
}

/** Fetch por URL: o CustomerPicker busca empresas antes do PATCH do ticket. */
function routeFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(String(url), init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function openMoreMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Mais ações de SUP-1024" }));
  return screen.findByRole("menu");
}

// O `router.refresh()` do Next suspende a transição de quem chamou até o RSC
// novo chegar. Aqui o mock liga o portão, que suspende para sempre.
const refreshGate: { suspend: ((on: boolean) => void) | null } = { suspend: null };
const NEVER = new Promise<never>(() => {});

function RefreshGate() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    refreshGate.suspend = setOn;
  }, []);
  if (on) use(NEVER);
  return null;
}

const CUSTOMERS = [
  { id: "a7", legal_name: "Mercado Bom Preço Ltda", trade_name: "Mercado Bom Preço", cnpj: null, contract_status: "ativo", archived_at: null },
  { id: "a8", legal_name: "Oficina Beta Ltda", trade_name: "Oficina Beta", cnpj: null, contract_status: "ativo", archived_at: null },
];

function isTicketPatch(url: string, init?: RequestInit) {
  return url === `/api/tickets/${TICKET_ID}` && init?.method === "PATCH";
}

describe("TicketDetailView — cabeçalho", () => {
  it("deve mostrar protocolo, título, selos e a linha de fatos", () => {
    renderDetail();

    expect(screen.getByText("SUP-1024")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Erro ao emitir nota fiscal" })).toBeInTheDocument();
    expect(screen.getByText("Em atendimento")).toBeInTheDocument();
    expect(screen.getAllByText("Alta").length).toBeGreaterThan(0);
    expect(screen.getByText("Vence em 2 horas")).toBeInTheDocument();
    expect(screen.getByText("Aberto em 25/09/2026 06:00")).toBeInTheDocument();
    expect(screen.getByText("1ª resposta em 25/09/2026 06:10")).toBeInTheDocument();
    expect(screen.getByText("Solução até 25/09/2026 14:00")).toBeInTheDocument();
  });

  it("deve oferecer só as ações rápidas que a matriz permite", () => {
    renderDetail();

    expect(screen.getByRole("button", { name: "Aguardar cliente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolver" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reabrir" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fechar" })).toBeNull();
  });

  it("ticket encerrado não edita: sem editar título, sem atribuir e sem ações", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    // Todo ticket encerrado chega fora de foco (o banco tira o foco ao encerrar).
    renderDetail({
      ticketOverrides: {
        status: "fechado",
        sla_mode: "stopped",
        is_terminal: true,
        in_focus: false,
        resolved_at: "2026-09-25T13:00:00+00:00",
        closed_at: "2026-09-25T14:00:00+00:00",
      },
    });

    expect(screen.queryByRole("button", { name: "Editar título" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Alterar responsável" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Alterar fila e categoria" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Prioridade" })).toBeNull();
    expect(screen.getByText("Resolvido em 25/09/2026 10:00")).toBeInTheDocument();

    // Encerrado não entra em foco (a rota responderia 409): só abre a conversa.
    await user.click(screen.getByRole("button", { name: "Abrir conversa" }));
    expect(pushMock).toHaveBeenCalledWith(`/app/chat?conversation=${CONVERSATION_ID}`);
    expect(fetchMock).not.toHaveBeenCalled();

    const menu = await openMoreMenu(user);
    expect(within(menu).queryByRole("menuitem", { name: /Atribuir/ })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Pôr em foco na conversa" })).toBeNull();
  });

  it("sem a matriz de transições, avisa que as ações de status não carregaram e relê", async () => {
    const user = userEvent.setup();
    renderDetail({ catalogOverrides: { transitions: null } });

    expect(screen.queryByRole("button", { name: "Resolver" })).toBeNull();
    expect(screen.getByText("Não foi possível carregar as ações de status.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("encerrado sem a matriz não avisa: ele não tem ação de status", () => {
    renderDetail({
      ticketOverrides: {
        status: "cancelado",
        sla_mode: "stopped",
        is_terminal: true,
        closed_at: "2026-09-25T14:00:00+00:00",
      },
      catalogOverrides: { transitions: null },
    });

    expect(screen.queryByText("Não foi possível carregar as ações de status.")).toBeNull();
  });

  it("deve salvar o título com a versão e só o título", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(jsonResponse(200, { ok: true, changed: true, ticket: {} }));
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Editar título" }));
    const input = screen.getByRole("textbox", { name: "Título do ticket" });
    await user.clear(input);
    await user.type(input, "  CFOP errado na NF-e  ");
    await user.click(screen.getByRole("button", { name: "Salvar título" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/tickets/${TICKET_ID}`,
      method: "PATCH",
      body: { version: 3, title: "CFOP errado na NF-e" },
    });
    expect(toastMock.success).toHaveBeenCalledWith("Título atualizado.");
    expect(refreshMock).toHaveBeenCalled();
  });
});

describe("TicketDetailView — Responder no WhatsApp", () => {
  it("fora de foco, põe em foco (PUT) e depois abre a conversa", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(
      jsonResponse(200, { ok: true, active_ticket_id: TICKET_ID, changed: true })
    );
    renderDetail({ ticketOverrides: { in_focus: false } });

    await user.click(screen.getByRole("button", { name: "Responder no WhatsApp" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/app/chat?conversation=${CONVERSATION_ID}`));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/chat/conversations/${CONVERSATION_ID}/active-ticket`,
      method: "PUT",
      body: { ticket_id: TICKET_ID },
    });
    expect(toastMock.success).toHaveBeenCalledWith("SUP-1024 agora está em foco na conversa.");
  });

  it("sem mudar o foco (changed: false), abre a conversa sem toast", async () => {
    const user = userEvent.setup();
    stubFetch(jsonResponse(200, { ok: true, active_ticket_id: TICKET_ID, changed: false }));
    renderDetail({ ticketOverrides: { in_focus: false } });

    await user.click(screen.getByRole("button", { name: "Responder no WhatsApp" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("já em foco, abre a conversa sem PUT", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    renderDetail({ ticketOverrides: { in_focus: true } });

    await user.click(screen.getByRole("button", { name: "Responder no WhatsApp" }));

    expect(pushMock).toHaveBeenCalledWith(`/app/chat?conversation=${CONVERSATION_ID}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("se o foco falhar, fica no ticket e avisa", async () => {
    const user = userEvent.setup();
    stubFetch(jsonResponse(409, { ok: false, code: "ticket_terminal", message: "Ticket encerrado." }));
    renderDetail({ ticketOverrides: { in_focus: false } });

    await user.click(screen.getByRole("button", { name: "Responder no WhatsApp" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Ticket encerrado."));
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("'Pôr em foco na conversa' (menu) faz o PUT e relê, sem sair do ticket", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(
      jsonResponse(200, { ok: true, active_ticket_id: TICKET_ID, changed: true })
    );
    renderDetail({ ticketOverrides: { in_focus: false } });

    const menu = await openMoreMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Pôr em foco na conversa" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/chat/conversations/${CONVERSATION_ID}/active-ticket`,
      method: "PUT",
      body: { ticket_id: TICKET_ID },
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(toastMock.success).toHaveBeenCalledWith("SUP-1024 agora está em foco na conversa.");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("já em foco, o menu não oferece 'Pôr em foco na conversa'", async () => {
    const user = userEvent.setup();
    renderDetail({ ticketOverrides: { in_focus: true } });

    const menu = await openMoreMenu(user);

    expect(within(menu).queryByRole("menuitem", { name: "Pôr em foco na conversa" })).toBeNull();
  });
});

describe("TicketDetailView — sem Realtime", () => {
  it("voltar para a aba relê a tela; aba oculta e tela desmontada não releem", () => {
    const { unmount } = renderDetail();
    const state = vi.spyOn(document, "visibilityState", "get");

    state.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refreshMock).not.toHaveBeenCalled();

    state.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refreshMock).toHaveBeenCalledTimes(1);

    unmount();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    state.mockRestore();
  });
});

describe("TicketDetailView — conflitos", () => {
  it("409 de versão mostra o alerta no topo, avisa por toast e relê a página", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(
      jsonResponse(409, {
        ok: false,
        code: "version_conflict",
        message: "O ticket mudou.",
        current_version: 4,
      })
    );
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Resolver" }));

    expect(await screen.findByText("Este ticket mudou em outro lugar.")).toBeInTheDocument();
    expect(requestOf(fetchMock).body).toEqual({ to: "resolvido", version: 3 });
    expect(refreshMock).toHaveBeenCalled();
    // No celular a lateral fica abaixo da timeline: o alerta no topo sai da tela.
    expect(toastMock.error).toHaveBeenCalledWith(
      "Este ticket mudou em outro lugar. A tela foi atualizada; confira e repita a ação."
    );

    await user.click(screen.getByRole("button", { name: "Fechar o aviso" }));
    expect(screen.queryByText("Este ticket mudou em outro lugar.")).toBeNull();
  });

  it("transição inválida vira o toast com os destinos permitidos", async () => {
    const user = userEvent.setup();
    stubFetch(
      jsonResponse(409, {
        ok: false,
        code: "invalid_transition",
        message: "Transição inválida.",
        allowed: ["em_atendimento", "fechado"],
        current: "resolvido",
      })
    );
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Aguardar cliente" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "De Resolvido só vai para Em atendimento, Fechado."
      )
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("sem a aresta novo → em_atendimento na matriz, não oferece Atender", () => {
    renderDetail({ ticketOverrides: { status: "novo", assignee: null, assigned_to_user_id: null } });

    expect(screen.queryByRole("button", { name: "Atender" })).toBeNull();
  });

  it("Atender recusado por já ter dono oferece assumir mesmo assim", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(
      jsonResponse(409, {
        ok: false,
        code: "already_assigned",
        message: "Já atribuído.",
        assigned_to_user_id: OTHER_USER,
        assigned_to_name: "Ana Lima",
      }),
      jsonResponse(200, { ok: true, ticket: {}, conversation: { id: CONVERSATION_ID, status: "human" } })
    );
    renderDetail({
      ticketOverrides: { status: "novo", assignee: null, assigned_to_user_id: null },
      catalogOverrides: {
        transitions: [{ from_status: "novo", to_status: "em_atendimento" }],
      },
    });

    await user.click(screen.getByRole("button", { name: "Atender" }));

    expect(await screen.findByText("SUP-1024 está com Ana Lima.")).toBeInTheDocument();
    expect(requestOf(fetchMock, 0)).toEqual({
      url: `/api/tickets/${TICKET_ID}/take-over`,
      method: "POST",
      body: {},
    });
    expect(toastMock.error).not.toHaveBeenCalled();
    // A tela está velha (lateral "Sem responsável", "Atender" oferecido): relê.
    expect(refreshMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Assumir mesmo assim" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requestOf(fetchMock, 1).body).toEqual({ reassign: true });
    expect(toastMock.success).toHaveBeenCalledWith("Você assumiu SUP-1024.");
  });
});

describe("TicketDetailView — cancelar", () => {
  it("cancelar exige motivo: sem ele nada sai; com ele, vai o motivo e a versão", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(
      jsonResponse(200, { ok: true, ticket: {}, from: "em_atendimento", to: "cancelado", changed: true })
    );
    renderDetail();

    const menu = await openMoreMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Cancelar ticket…" }));

    const panel = await screen.findByRole("group", { name: "Cancelar SUP-1024" });
    await user.click(within(panel).getByRole("button", { name: "Cancelar ticket" }));

    expect(await within(panel).findByText("Informe o motivo do cancelamento.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.type(
      within(panel).getByRole("textbox", { name: /Motivo do cancelamento/ }),
      "Cliente desistiu"
    );
    await user.click(within(panel).getByRole("button", { name: "Cancelar ticket" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/tickets/${TICKET_ID}/transition`,
      method: "POST",
      body: { to: "cancelado", version: 3, reason: "Cliente desistiu" },
    });
    expect(toastMock.success).toHaveBeenCalledWith("SUP-1024 movido para Cancelado.");
  });

  it("sem a aresta para cancelado na matriz, o menu não oferece cancelar", async () => {
    const user = userEvent.setup();
    renderDetail({ catalogOverrides: { transitions: [] } });

    const menu = await openMoreMenu(user);

    expect(within(menu).queryByRole("menuitem", { name: "Cancelar ticket…" })).toBeNull();
  });
});

describe("TicketDetailView — lateral", () => {
  it("trocar a fila manda product_id e category_id null num PATCH só", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(jsonResponse(200, { ok: true, changed: true, ticket: {} }));
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Alterar fila e categoria" }));
    await user.click(screen.getByRole("combobox", { name: "Fila" }));
    await user.click(await screen.findByRole("option", { name: /Fiscal/ }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/tickets/${TICKET_ID}`,
      method: "PATCH",
      body: { version: 3, product_id: "q2", category_id: null },
    });
  });

  it("a categoria oferece só as da fila escolhida e as gerais, e acompanha a troca de fila", async () => {
    const user = userEvent.setup();
    renderDetail({
      catalogOverrides: {
        categories: [
          { id: "c1", name: "Impressão", product_id: "q1", parent_id: null, archived_at: null },
          { id: "c2", name: "Geral", product_id: null, parent_id: null, archived_at: null },
          { id: "c3", name: "Rejeição", product_id: "q2", parent_id: null, archived_at: null },
          { id: "c4", name: "Duplicata", product_id: "q2", parent_id: "c3", archived_at: null },
        ],
      },
    });

    async function categoryOptions() {
      await user.click(screen.getByRole("combobox", { name: "Categoria" }));
      const names = (await screen.findAllByRole("option")).map((option) => option.textContent?.trim());
      await user.keyboard("{Escape}");
      return names;
    }

    await user.click(screen.getByRole("button", { name: "Alterar fila e categoria" }));
    expect(await categoryOptions()).toEqual(["Geral", "Impressão"]);

    await user.click(screen.getByRole("combobox", { name: "Fila" }));
    await user.click(await screen.findByRole("option", { name: /Fiscal/ }));

    expect(await categoryOptions()).toEqual(["Geral", "Rejeição", "Rejeição › Duplicata"]);
  });

  it("apagar a fila para buscar e reescolher a mesma não tira a categoria", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Alterar fila e categoria" }));
    const queue = screen.getByRole("combobox", { name: "Fila" });
    const category = screen.getByRole("combobox", { name: "Categoria" });
    expect(category).toHaveValue("Impressão");

    // O campo vazio no meio da busca é "sem fila": a categoria some da tela…
    await user.clear(queue);
    expect(category).toHaveValue("");
    await user.type(queue, "ER");
    await user.click(await screen.findByRole("option", { name: /ERP/ }));

    // …e volta com a fila dela; nada mudou, então nada sai.
    expect(queue).toHaveValue("ERP");
    expect(category).toHaveValue("Impressão");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Alterar fila e categoria" })).toBeInTheDocument();
  });

  it("fila arquivada: a atual vem do ticket, marcada, e não é oferecida", () => {
    renderDetail({
      ticketOverrides: {
        product: { id: "q9", name: "Legado", color: "gray" },
        product_id: "q9",
        category: { id: "c9", name: "Antiga", archived_at: "2026-09-01T00:00:00+00:00" },
        category_id: "c9",
      },
    });

    expect(screen.getByText("Legado")).toBeInTheDocument();
    expect(screen.getByText("Antiga")).toBeInTheDocument();
    // A fila (fora do catálogo ativo) e a categoria (archived_at) atuais.
    expect(screen.getAllByText(/\(arquivada\)/)).toHaveLength(2);
  });

  it("a dica da prioridade é o SLA gravado no ticket, não a política atual do catálogo", () => {
    // O admin mudou a política de "alta" depois da abertura: vale só para
    // tickets novos, e este guarda o snapshot 60/480.
    renderDetail({
      catalogOverrides: {
        priorities: [
          { priority: "alta", rank: 3, first_response_minutes: 120, resolution_minutes: 960, warn_pct: 80 },
          { priority: "critica", rank: 4, first_response_minutes: 15, resolution_minutes: 240, warn_pct: 80 },
        ],
      },
    });

    expect(
      screen.getByText(
        "Alta: 1ª resposta em até 1 h e solução em até 8 h, contadas da abertura."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/em até 2 h/)).toBeNull();
  });

  it("trocar a prioridade manda a nova e, enquanto grava, a dica é a política dela", async () => {
    const user = userEvent.setup();
    let respond: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderDetail();

    const select = screen.getByRole("combobox", { name: "Prioridade" });
    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "Crítica" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/tickets/${TICKET_ID}`,
      method: "PATCH",
      body: { version: 3, priority: "critica" },
    });
    // O rascunho: a política do catálogo é o que o novo snapshot aplica.
    expect(
      screen.getByText(
        "Crítica: 1ª resposta em até 15 min e solução em até 4 h, contadas da abertura."
      )
    ).toBeInTheDocument();

    respond(jsonResponse(200, { ok: true, changed: true, ticket: {} }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("Prioridade alterada para Crítica.")
    );
    expect(refreshMock).toHaveBeenCalled();
    // Sem o RSC novo (mock), o rascunho sai e a tela volta ao ticket que tem.
    await waitFor(() => expect(select).toHaveTextContent("Alta"));
  });

  it("atribuir oferece só a equipe ativa e grava com a versão", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(jsonResponse(200, { ok: true, changed: true, ticket: {} }));
    render(
      <TicketDetailView
        ticket={ticket()}
        attachments={[]}
        timeline={EMPTY_TIMELINE}
        catalog={catalog()}
        team={[
          ...TEAM,
          { id: "u-off", name: "Carlos Inativo", avatar_color: "gray", avatar_url: null, is_active: false },
        ]}
        viewerId={VIEWER}
        fetchedAt={FETCHED_AT}
      />
    );

    await user.click(screen.getByRole("button", { name: "Alterar responsável" }));
    const dialog = await screen.findByRole("dialog", { name: "Atribuir SUP-1024" });
    expect(within(dialog).queryByText("Carlos Inativo")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: /Ana Lima/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/tickets/${TICKET_ID}/assign`,
      method: "POST",
      body: { assignee_id: OTHER_USER, version: 3 },
    });
    expect(toastMock.success).toHaveBeenCalledWith("SUP-1024 atribuído a Ana Lima.");
  });

  it("'Tirar o responsável' grava sem responsável, com a versão", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(jsonResponse(200, { ok: true, changed: true, ticket: {} }));
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Alterar responsável" }));
    const dialog = await screen.findByRole("dialog", { name: "Atribuir SUP-1024" });
    await user.click(within(dialog).getByRole("button", { name: "Tirar o responsável" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/tickets/${TICKET_ID}/assign`,
      method: "POST",
      body: { assignee_id: null, version: 3 },
    });
    expect(toastMock.success).toHaveBeenCalledWith("SUP-1024 ficou sem responsável.");
  });

  it("'Definir empresa' grava a empresa escolhida, com a versão", async () => {
    const user = userEvent.setup();
    const fetchMock = routeFetch((url, init) => {
      if (url.startsWith("/api/customers")) return jsonResponse(200, { ok: true, items: CUSTOMERS });
      if (isTicketPatch(url, init)) return jsonResponse(200, { ok: true, changed: true, ticket: {} });
      throw new Error(`fetch inesperado: ${url}`);
    });
    renderDetail({ ticketOverrides: { customer: null, customer_id: null } });

    await user.click(screen.getByRole("button", { name: "Definir empresa" }));
    const dialog = await screen.findByRole("dialog", { name: "Definir empresa" });
    await user.click(await within(dialog).findByRole("button", { name: /Mercado Bom Preço/ }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("Empresa definida: Mercado Bom Preço.")
    );
    const patches = fetchMock.mock.calls.filter(([url, init]) => isTicketPatch(url, init));
    expect(patches.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { version: 3, customer_id: "a7" },
    ]);
  });

  it("'Definir empresa': enquanto a página relê, a lista trava (a versão da tela é velha)", async () => {
    const user = userEvent.setup();
    const fetchMock = routeFetch((url, init) => {
      if (url.startsWith("/api/customers")) return jsonResponse(200, { ok: true, items: CUSTOMERS });
      if (isTicketPatch(url, init)) return jsonResponse(200, { ok: true, changed: true, ticket: {} });
      throw new Error(`fetch inesperado: ${url}`);
    });
    refreshMock.mockImplementationOnce(() => refreshGate.suspend?.(true));
    render(
      <Suspense fallback={null}>
        <RefreshGate />
        <TicketDetailView
          ticket={ticket({ customer: null, customer_id: null })}
          attachments={[]}
          timeline={EMPTY_TIMELINE}
          catalog={catalog()}
          team={TEAM}
          viewerId={VIEWER}
          fetchedAt={FETCHED_AT}
        />
      </Suspense>
    );

    await user.click(screen.getByRole("button", { name: "Definir empresa" }));
    const dialog = await screen.findByRole("dialog", { name: "Definir empresa" });
    await user.click(await within(dialog).findByRole("button", { name: /Mercado Bom Preço/ }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    // O diálogo fecha junto com o RSC novo; até lá, uma 2ª escolha sairia com
    // a versão 3 e voltaria "mudou em outro lugar" sem ninguém ter mexido.
    expect(screen.getByRole("dialog", { name: "Definir empresa" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Oficina Beta/ })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([url, init]) => isTicketPatch(url, init))).toHaveLength(1);
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { pushMock, replaceMock, refreshMock, toastMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import type { TicketFilterUser } from "@/features/tickets/components/ticket-filters";
import {
  TicketsTable,
  type TicketsTableCatalog,
} from "@/features/tickets/components/tickets-table";
import type {
  TicketListItem,
  TicketListParams,
  TicketsPage,
  TicketStatusOption,
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
});

const ticket = (overrides: Partial<TicketListItem> = {}): TicketListItem => ({
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
  replied_after_resolve: false,
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
  assignee: { id: OTHER_USER, name: "Ana Lima", avatar_color: "violet", avatar_url: null },
  ...overrides,
});

const page = (items: TicketListItem[], overrides: Partial<TicketsPage> = {}): TicketsPage => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  pageCount: 1,
  failed: false,
  fetchedAt: FETCHED_AT,
  ...overrides,
});

const params = (overrides: Partial<TicketListParams> = {}): TicketListParams => ({
  q: "",
  status: "ativos",
  prioridade: null,
  fila: null,
  responsavel: null,
  sla: null,
  ordem: "prazo",
  page: 1,
  ...overrides,
});

const status = (key: TicketStatusOption["key"], label: string, position: number): TicketStatusOption => ({
  key,
  label,
  color: "blue",
  position,
  sla_mode: key === "aguardando_cliente" ? "paused" : "running",
  is_terminal: key === "cancelado" || key === "fechado",
});

const CATALOG: TicketsTableCatalog = {
  statuses: [
    status("em_atendimento", "Atendendo", 3),
    status("aguardando_cliente", "Esperando cliente", 4),
    status("resolvido", "Resolvido", 6),
    status("cancelado", "Cancelado", 8),
  ],
  transitions: [
    { from_status: "em_atendimento", to_status: "aguardando_cliente" },
    { from_status: "em_atendimento", to_status: "resolvido" },
    { from_status: "em_atendimento", to_status: "cancelado" },
    { from_status: "novo", to_status: "em_triagem" },
  ],
  queues: [{ id: "q1", name: "ERP" }],
};

const USERS: TicketFilterUser[] = [
  { id: VIEWER, name: "Eu Mesmo", is_active: true },
  { id: OTHER_USER, name: "Ana Lima", is_active: true },
];

type TableOptions = {
  items?: TicketListItem[];
  pageOverrides?: Partial<TicketsPage>;
  paramOverrides?: Partial<TicketListParams>;
  catalog?: TicketsTableCatalog;
  users?: readonly TicketFilterUser[] | null;
};

// Separado do render: o `rerender` com params novos é a URL mudando por fora.
function tableElement({
  items = [ticket()],
  pageOverrides = {},
  paramOverrides = {},
  catalog = CATALOG,
  users = USERS,
}: TableOptions = {}) {
  return (
    <TicketsTable
      page={page(items, pageOverrides)}
      params={params(paramOverrides)}
      catalog={catalog}
      users={users}
      viewerId={VIEWER}
    />
  );
}

function renderTable(options: TableOptions = {}) {
  return render(tableElement(options));
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

function requestOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return { url, method: init.method, body: JSON.parse(String(init.body)) as unknown };
}

// Tabela (desktop) e cartões (celular) estão no DOM ao mesmo tempo; o CSS
// esconde um dos dois. Os testes de menu usam o da tabela.
async function openRowMenu(user: ReturnType<typeof userEvent.setup>) {
  const [trigger] = screen.getAllByRole("button", { name: "Ações de SUP-1024" });
  await user.click(trigger!);
  return screen.findByRole("menu");
}

describe("TicketsTable — estados", () => {
  it("deve mostrar a falha com 'Tentar de novo', que relê a página", async () => {
    const user = userEvent.setup();
    renderTable({ items: [], pageOverrides: { failed: true } });

    expect(screen.getByText("Não foi possível carregar os tickets.")).toBeInTheDocument();
    expect(screen.queryByText(/Tickets nascem/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("deve dizer de onde vêm os tickets quando não há nenhum ativo", async () => {
    const user = userEvent.setup();
    renderTable({ items: [] });

    expect(screen.getByText("Nenhum ticket ativo.")).toBeInTheDocument();
    expect(screen.getByText("Tickets nascem de uma conversa no WhatsApp.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir o WhatsApp" })).toHaveAttribute("href", "/app/chat");
    expect(screen.getByText("0 tickets ativos")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ver todos os tickets" }));

    expect(replaceMock).toHaveBeenCalledWith("/app/tickets?status=todos", { scroll: false });
  });

  it("deve tratar 'todos' sem ticket como base vazia, sem o atalho 'Ver todos'", () => {
    renderTable({ items: [], paramOverrides: { status: "todos" } });

    expect(screen.getByText("Nenhum ticket ainda.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver todos os tickets" })).toBeNull();
  });

  it("filtro sem resultado oferece 'Limpar filtros', que mantém a ordem", async () => {
    const user = userEvent.setup();
    renderTable({ items: [], paramOverrides: { prioridade: "alta", ordem: "recentes" } });

    expect(screen.getByText("Nenhum ticket encontrado.")).toBeInTheDocument();
    expect(screen.getByText("0 tickets encontrados")).toBeInTheDocument();

    const emptyState = screen.getByText("Nenhum ticket encontrado.").parentElement!;
    await user.click(within(emptyState).getByRole("button", { name: "Limpar filtros" }));

    expect(replaceMock).toHaveBeenCalledWith("/app/tickets?ordem=recentes", { scroll: false });
  });

  it("deve contar os filtros do painel no botão 'Filtros'", () => {
    renderTable({ paramOverrides: { status: "todos", sla: "risco", q: "nota" } });

    expect(screen.getByRole("button", { name: "Filtros (2)" })).toBeInTheDocument();
    expect(screen.getByText("1 ticket encontrado")).toBeInTheDocument();
  });

  it("voltar para a aba relê a lista; aba oculta e lista desmontada não releem", () => {
    const { unmount } = renderTable();
    // Espião no getter, não defineProperty: o estado não vaza para os outros testes.
    const visibility = vi.spyOn(document, "visibilityState", "get");
    try {
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(refreshMock).not.toHaveBeenCalled();

      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(refreshMock).toHaveBeenCalledTimes(1);

      unmount();
      document.dispatchEvent(new Event("visibilitychange"));
      expect(refreshMock).toHaveBeenCalledTimes(1);
    } finally {
      visibility.mockRestore();
    }
  });
});

describe("TicketsTable — linhas", () => {
  it("deve mostrar protocolo, título, empresa · contato, status do catálogo, SLA e responsável", () => {
    renderTable();

    expect(screen.getAllByText("SUP-1024")).toHaveLength(2);
    for (const link of screen.getAllByRole("link", { name: "Erro ao emitir nota fiscal" })) {
      expect(link).toHaveAttribute("href", "/app/tickets/1024");
    }
    expect(screen.getAllByText("Padaria São João · Maria Souza")).toHaveLength(2);
    expect(screen.getAllByText("Atendendo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Alta").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Vence em 2 horas").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ana Lima").length).toBeGreaterThan(0);
    expect(screen.getByText("Atualizado há 2 horas")).toBeInTheDocument();
  });

  it("sem empresa, mostra só o contato (telefone quando não há nome)", () => {
    renderTable({
      items: [ticket({ customer: null, contact: { id: "p2", name: null, phone: "5527999990000" } })],
    });

    expect(screen.getAllByText("(27) 99999-0000")).toHaveLength(2);
  });

  it("no celular, a barra de acento do cartão tem a cor do SLA", () => {
    const { container } = renderTable({
      items: [
        // Solução venceu 1 hora antes do fetchedAt: estourado.
        ticket({
          resolution_due_at: "2026-09-25T14:00:00+00:00",
          next_due_at: "2026-09-25T14:00:00+00:00",
        }),
        ticket({ id: "3b241101-e2bb-4255-8caf-4136c566a962", number: 1025 }),
      ],
    });

    // Classes escritas aqui, sem ler SLA_TONE_STYLE: trocar a cor lá tem de falhar.
    const bars = container.querySelectorAll("article > span[aria-hidden]");
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveClass("bg-destructive");
    expect(bars[1]).toHaveClass("bg-primary");
  });

  it("clicar na linha abre o detalhe; clicar no menu não", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getAllByText("Ana Lima")[0]!);
    expect(pushMock).toHaveBeenCalledWith("/app/tickets/1024");

    pushMock.mockClear();
    const menu = await openRowMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Copiar protocolo" }));
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("TicketsTable — menu ⋯", () => {
  it("'Abrir conversa' leva à conversa do ticket no chat", async () => {
    const user = userEvent.setup();
    renderTable();

    const menu = await openRowMenu(user);

    expect(within(menu).getByRole("menuitem", { name: "Abrir conversa" })).toHaveAttribute(
      "href",
      `/app/chat?conversation=${CONVERSATION_ID}`
    );
  });

  it("'Mover para' oferece só os destinos da matriz, com os rótulos do catálogo", async () => {
    const user = userEvent.setup();
    renderTable();

    const menu = await openRowMenu(user);

    expect(within(menu).getByText("Mover para")).toBeInTheDocument();
    const moves = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(moves).toEqual([
      "Abrir conversa",
      "Atribuir a mim",
      "Esperando cliente",
      "Resolvido",
      "Cancelado…",
      "Copiar protocolo",
    ]);
  });

  it("sem a matriz do catálogo, não há 'Mover para'", async () => {
    const user = userEvent.setup();
    renderTable({ catalog: { ...CATALOG, transitions: null } });

    const menu = await openRowMenu(user);

    expect(within(menu).queryByText("Mover para")).toBeNull();
  });

  it("ticket já meu não oferece 'Atribuir a mim'", async () => {
    const user = userEvent.setup();
    renderTable({
      items: [ticket({ assignee: { id: VIEWER, name: "Eu Mesmo", avatar_color: "sky", avatar_url: null } })],
    });

    const menu = await openRowMenu(user);

    expect(within(menu).queryByRole("menuitem", { name: "Atribuir a mim" })).toBeNull();
  });

  it("ticket encerrado não oferece 'Atribuir a mim', mesmo sem responsável", async () => {
    const user = userEvent.setup();
    renderTable({
      // Sem responsável: só o encerramento explica a falta do item.
      items: [
        ticket({
          status: "fechado",
          is_terminal: true,
          sla_mode: "stopped",
          resolved_at: "2026-09-25T13:00:00+00:00",
          closed_at: "2026-09-25T14:00:00+00:00",
          assignee: null,
        }),
      ],
      paramOverrides: { status: "todos" },
    });

    const menu = await openRowMenu(user);

    expect(within(menu).getByRole("menuitem", { name: "Abrir conversa" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Atribuir a mim" })).toBeNull();
  });

  it("'Atribuir a mim' manda a versão que a tela leu e relê a lista", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(jsonResponse({ ok: true, changed: true }));
    renderTable();

    const menu = await openRowMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Atribuir a mim" }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("SUP-1024 agora é seu."));
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/tickets/${TICKET_ID}/assign`,
      method: "POST",
      body: { assignee_id: VIEWER, version: 3 },
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("versão velha: avisa que o ticket mudou em outro lugar e relê", async () => {
    const user = userEvent.setup();
    stubFetch(
      jsonResponse(
        { ok: false, code: "version_conflict", message: "O ticket mudou…", current_version: 4 },
        409
      )
    );
    renderTable();

    const menu = await openRowMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Atribuir a mim" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("O ticket mudou em outro lugar.")
    );
    expect(refreshMock).toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("transição recusada lista os destinos permitidos com os rótulos do catálogo", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(
      jsonResponse(
        {
          ok: false,
          code: "invalid_transition",
          message: "Esse movimento não é permitido.",
          allowed: ["aguardando_cliente", "resolvido"],
          current: "em_atendimento",
        },
        409
      )
    );
    renderTable();

    const menu = await openRowMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Resolvido" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "De Atendendo só vai para Esperando cliente, Resolvido."
      )
    );
    expect(requestOf(fetchMock).body).toEqual({ to: "resolvido", version: 3 });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("'Alguém já pegou' quando o ticket já tem outro responsável", async () => {
    const user = userEvent.setup();
    stubFetch(
      jsonResponse({ ok: false, code: "already_assigned", message: "Já está com outro." }, 409)
    );
    renderTable({ items: [ticket({ assignee: null })] });

    const menu = await openRowMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Atribuir a mim" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Alguém já pegou este ticket."));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("falha de rede não relê e não inventa sucesso", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    renderTable();

    const menu = await openRowMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Esperando cliente" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Não foi possível concluir a operação. Confira a conexão e tente de novo."
      )
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("'Cancelado…' pede o motivo antes de mover", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(jsonResponse({ ok: true, changed: true }));
    renderTable();

    const menu = await openRowMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Cancelado…" }));

    const dialog = await screen.findByRole("dialog", { name: "Cancelar SUP-1024?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancelar ticket" }));

    expect(await within(dialog).findByText("Informe o motivo do cancelamento.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/Motivo do cancelamento/), "Cliente desistiu");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar ticket" }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("SUP-1024 movido para Cancelado.")
    );
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/tickets/${TICKET_ID}/transition`,
      method: "POST",
      body: { to: "cancelado", version: 3, reason: "Cliente desistiu" },
    });
    expect(refreshMock).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("TicketsTable — filtros", () => {
  // Parte de uma busca e de outro filtro já ativos: escolher um campo não pode
  // levar os outros embora. NthCalledWith(1): se a busca se perdesse, o debounce
  // a devolveria num 2º replace.
  it.each([
    ["Status", "Todos", "/app/tickets?q=nota&status=todos&prioridade=alta"],
    ["Prioridade", "Baixa", "/app/tickets?q=nota&prioridade=baixa"],
    ["Fila", "ERP", "/app/tickets?q=nota&prioridade=alta&fila=q1"],
    ["Responsável", "Sem responsável", "/app/tickets?q=nota&prioridade=alta&responsavel=nenhum"],
    ["SLA", "Em risco", "/app/tickets?q=nota&prioridade=alta&sla=risco"],
  ])("%s → %s vai para a URL mantendo a busca e os outros filtros", async (field, option, href) => {
    const user = userEvent.setup();
    renderTable({ paramOverrides: { q: "nota", prioridade: "alta" } });

    await user.click(screen.getByRole("button", { name: "Filtros (1)" }));
    await user.click(await screen.findByRole("combobox", { name: field }));
    await user.click(await screen.findByRole("option", { name: option }));

    expect(replaceMock).toHaveBeenNthCalledWith(1, href, { scroll: false });
  });

  it("a ordem vai para a URL mantendo a busca e os filtros", async () => {
    const user = userEvent.setup();
    renderTable({ paramOverrides: { q: "nota", prioridade: "alta" } });

    await user.click(screen.getByRole("combobox", { name: "Ordenar por" }));
    await user.click(await screen.findByRole("option", { name: "Mais recentes" }));

    expect(replaceMock).toHaveBeenNthCalledWith(
      1,
      "/app/tickets?q=nota&prioridade=alta&ordem=recentes",
      { scroll: false }
    );
  });

  it("Responsável oferece 'Eu', 'Sem responsável' e a equipe, sem o próprio analista", async () => {
    const user = userEvent.setup();
    renderTable({
      users: [
        ...USERS,
        { id: "d4735e3a-265e-46ee-a18a-8f0b1c2d3e4f", name: "Bruno Costa", is_active: false },
      ],
    });

    await user.click(screen.getByRole("button", { name: "Filtros" }));
    await user.click(await screen.findByRole("combobox", { name: "Responsável" }));

    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(["Todos", "Eu", "Sem responsável", "Ana Lima", "Bruno Costa (inativo)"]);
    expect(screen.queryByText(/Não foi possível carregar a equipe/)).toBeNull();
  });

  it("sem a equipe, sobram 'Eu' e 'Sem responsável', e o painel diz que a leitura falhou", async () => {
    const user = userEvent.setup();
    renderTable({ users: null });

    await user.click(screen.getByRole("button", { name: "Filtros" }));

    expect(
      await screen.findByText("Não foi possível carregar a equipe. Recarregue a página.")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Responsável" }));

    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(["Todos", "Eu", "Sem responsável"]);
  });
});

describe("TicketsTable — busca", () => {
  it("vai para a URL depois da pausa, mantendo os filtros escolhidos", async () => {
    const user = userEvent.setup();
    renderTable({ paramOverrides: { prioridade: "alta" } });

    await user.type(screen.getByRole("searchbox"), "SUP-1024");

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/app/tickets?q=SUP-1024&prioridade=alta", {
        scroll: false,
      })
    );
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });

  it("protocolo na busca avisa, no painel, que o status é ignorado", async () => {
    const user = userEvent.setup();
    renderTable({ paramOverrides: { q: "#1024" } });

    await user.click(screen.getByRole("button", { name: "Filtros" }));

    expect(await screen.findByText("A busca por protocolo ignora o status.")).toBeInTheDocument();
  });

  // A URL mudou por fora ("Tickets" no menu, voltar do navegador): o campo
  // segue a URL, e a busca antiga não volta para ela depois da pausa.
  it.each([
    ["", "o menu 'Tickets' limpa a busca"],
    ["boleto", "voltar do navegador traz outra busca"],
  ])("URL com q=%j (%s): o campo segue a URL e a busca antiga não volta", (next) => {
    vi.useFakeTimers();
    try {
      const { rerender } = renderTable({ paramOverrides: { q: "nota" } });
      expect(screen.getByRole("searchbox")).toHaveValue("nota");

      rerender(tableElement({ paramOverrides: { q: next } }));
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(screen.getByRole("searchbox")).toHaveValue(next);
      expect(replaceMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a URL confirmar o termo que esta tela pediu não apaga o que a pessoa continuou digitando", async () => {
    const user = userEvent.setup();
    const { rerender } = renderTable();

    await user.type(screen.getByRole("searchbox"), "nota");
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/app/tickets?q=nota", { scroll: false })
    );
    await user.type(screen.getByRole("searchbox"), " fis");

    rerender(tableElement({ paramOverrides: { q: "nota" } }));

    expect(screen.getByRole("searchbox")).toHaveValue("nota fis");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, toastMock, fromMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  fromMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
// Só para o teste do recorte do "Ver todos": a lista e a fila montadas de verdade.
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

import { TicketQueuePanel } from "@/features/tickets/components/ticket-queue-panel";
import { getTicketQueue } from "@/features/tickets/queries/get-ticket-queue";
import {
  getTicketsPage,
  parseTicketListParams,
} from "@/features/tickets/queries/get-tickets-page";
import type {
  TicketListItem,
  TicketQueue,
  TicketQueueSection,
  TicketSummary,
} from "@/features/tickets/types";

const TICKET_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER_TICKET_ID = "3d6f4a8e-1b2c-4d5e-8f90-a1b2c3d4e5f6";
const VIEWER = "5b0e0c2a-1d3f-4c55-9a77-0c1d2e3f4a5b";
const FETCHED_AT = "2026-09-25T15:00:00.000Z";

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
  source: "ai",
  conversation_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
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
  updated_at: "2026-09-25T12:30:00+00:00",
  customer: {
    id: "a1",
    legal_name: "Padaria S. João Ltda",
    trade_name: "Padaria São João",
    contract_status: "ativo",
  },
  contact: { id: "p1", name: "Maria Souza", phone: "5527999990000" },
  product: null,
  assignee: null,
  ...overrides,
});

// Resolvido às 14:00 com o cliente escrevendo às 14:30: a view marca
// replied_after_resolve e o selo acende.
const repliedTicket = (overrides: Partial<TicketListItem> = {}) =>
  ticket({
    status: "resolvido",
    sla_mode: "stopped",
    resolved_at: "2026-09-25T14:00:00.5+00:00",
    last_inbound_at: "2026-09-25T14:30:00+00:00",
    replied_after_resolve: true,
    next_due_at: null,
    assignee: { id: "u1", name: "Eu Mesmo", avatar_color: "sky", avatar_url: null },
    ...overrides,
  });

const section = (items: TicketListItem[], overrides: Partial<TicketQueueSection> = {}) => ({
  items,
  total: items.length,
  failed: false,
  ...overrides,
});

const queue = (overrides: Partial<TicketQueue> = {}): TicketQueue => ({
  mine: section([]),
  unassigned: section([ticket()]),
  fetchedAt: FETCHED_AT,
  ...overrides,
});

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

/** 200 do take-over: o ticket com quem assumiu, em atendimento, e a conversa `human`. */
function takeOverOk(item: TicketListItem = ticket()) {
  return jsonResponse({
    ok: true,
    ticket: summaryOf(item, {
      status: "em_atendimento",
      assigned_to_user_id: VIEWER,
      version: item.version + 1,
    }),
    conversation: { id: item.conversation_id, status: "human" },
  });
}

function sectionOf(title: string) {
  return screen.getByRole("region", { name: title });
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

describe("TicketQueuePanel — estados", () => {
  it("cada seção tem o próprio vazio", () => {
    render(<TicketQueuePanel queue={queue({ unassigned: section([]) })} />);

    expect(within(sectionOf("Minha fila")).getByText("Nenhum ticket com você agora.")).toBeVisible();
    expect(
      within(sectionOf("Não atribuídos")).getByText("Nenhum ticket esperando responsável.")
    ).toBeVisible();
    // Vazio não oferece "Ver todos (0)".
    expect(screen.queryByRole("link", { name: /Ver todos/ })).toBeNull();
  });

  it("a falha de uma seção não apaga a outra, e 'Tentar de novo' relê a página", async () => {
    const user = userEvent.setup();
    render(<TicketQueuePanel queue={queue({ mine: section([], { failed: true }) })} />);

    const mine = sectionOf("Minha fila");
    expect(within(mine).getByText("Não foi possível carregar a sua fila.")).toBeVisible();
    expect(within(mine).queryByText("Nenhum ticket com você agora.")).toBeNull();
    expect(within(sectionOf("Não atribuídos")).getByText("Erro ao emitir nota fiscal")).toBeVisible();

    await user.click(within(mine).getByRole("button", { name: "Tentar de novo" }));

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("sem leitura (queue nula), as duas seções mostram a falha, nunca 'nenhum ticket'", () => {
    render(<TicketQueuePanel queue={null} />);

    expect(screen.getByText("Não foi possível carregar a sua fila.")).toBeVisible();
    expect(screen.getByText("Não foi possível carregar os tickets não atribuídos.")).toBeVisible();
    expect(screen.queryByText(/Nenhum ticket/)).toBeNull();
  });

  it("voltar para a aba relê a fila; aba oculta e painel desmontado não releem", () => {
    const { unmount } = render(<TicketQueuePanel queue={queue()} />);
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

describe("TicketQueuePanel — linhas", () => {
  it("mostra protocolo (link do detalhe), título, empresa · contato, SLA e prioridade", () => {
    render(<TicketQueuePanel queue={queue()} />);
    const unassigned = sectionOf("Não atribuídos");

    expect(within(unassigned).getByRole("link", { name: "SUP-1024" })).toHaveAttribute(
      "href",
      "/app/tickets/1024"
    );
    expect(within(unassigned).getByText("Erro ao emitir nota fiscal")).toBeVisible();
    expect(within(unassigned).getByText("Padaria São João · Maria Souza")).toBeVisible();
    expect(within(unassigned).getByText("Vence em 2 horas")).toBeVisible();
    expect(within(unassigned).getByText("Alta")).toBeVisible();
  });

  it("'Ver todos (N)' leva à lista 'pendentes' com o responsável e o total da seção", () => {
    render(
      <TicketQueuePanel
        queue={queue({
          mine: section([ticket({ id: OTHER_TICKET_ID, number: 1030 })], { total: 12 }),
          unassigned: section([ticket()], { total: 9 }),
        })}
      />
    );

    expect(
      within(sectionOf("Minha fila")).getByRole("link", { name: "Ver todos (12)" })
    ).toHaveAttribute("href", "/app/tickets?status=pendentes&responsavel=eu");
    expect(
      within(sectionOf("Não atribuídos")).getByRole("link", { name: "Ver todos (9)" })
    ).toHaveAttribute("href", "/app/tickets?status=pendentes&responsavel=nenhum");
  });

  it("na minha fila, só o resolvido com resposta do cliente tem o selo e Reabrir · Fechar", () => {
    render(
      <TicketQueuePanel
        queue={queue({
          mine: section([
            ticket({ id: OTHER_TICKET_ID, number: 1030 }),
            repliedTicket(),
          ]),
          unassigned: section([]),
        })}
      />
    );
    const mine = sectionOf("Minha fila");

    expect(within(mine).getAllByText("Respondeu após resolver")).toHaveLength(1);
    expect(within(mine).getByRole("button", { name: "Reabrir SUP-1024" })).toBeVisible();
    expect(within(mine).getByRole("button", { name: "Fechar SUP-1024" })).toBeVisible();
    // O ticket em atendimento não tem ação na linha: o detalhe é o caminho.
    expect(within(mine).queryByRole("button", { name: /SUP-1030/ })).toBeNull();
    expect(within(mine).queryByRole("button", { name: /Atender/ })).toBeNull();
  });

  it("o selo vem de replied_after_resolve, da view: a tela não recalcula pelos instantes", () => {
    render(
      <TicketQueuePanel
        queue={queue({
          // Mensagem depois da resolução, mas a view diz que não: sem selo.
          mine: section([repliedTicket({ replied_after_resolve: false })]),
          // Sem last_inbound_at na linha, mas a view diz que sim: com selo.
          unassigned: section([
            repliedTicket({ id: OTHER_TICKET_ID, number: 1030, last_inbound_at: null, assignee: null }),
          ]),
        })}
      />
    );
    const mine = sectionOf("Minha fila");

    expect(within(mine).queryByText("Respondeu após resolver")).toBeNull();
    expect(within(mine).queryByRole("button")).toBeNull();
    expect(
      within(sectionOf("Não atribuídos")).getByText("Respondeu após resolver")
    ).toBeVisible();
  });

  it("em Não atribuídos, o resolvido respondido tem o selo e Reabrir · Fechar no lugar de Atender", () => {
    render(
      <TicketQueuePanel
        queue={queue({
          unassigned: section([
            repliedTicket({ assignee: null }),
            ticket({ id: OTHER_TICKET_ID, number: 1030 }),
          ]),
        })}
      />
    );
    const unassigned = sectionOf("Não atribuídos");

    expect(within(unassigned).getAllByText("Respondeu após resolver")).toHaveLength(1);
    expect(within(unassigned).getByRole("button", { name: "Reabrir SUP-1024" })).toBeVisible();
    expect(within(unassigned).getByRole("button", { name: "Fechar SUP-1024" })).toBeVisible();
    expect(within(unassigned).queryByRole("button", { name: "Atender SUP-1024" })).toBeNull();
    expect(within(unassigned).getByRole("button", { name: "Atender SUP-1030" })).toBeVisible();
  });

  it("mantém a ordem da leitura: a linha respondida, que vem primeiro, fica no topo", () => {
    render(
      <TicketQueuePanel
        queue={queue({
          mine: section([repliedTicket(), ticket({ id: OTHER_TICKET_ID, number: 1030 })]),
          unassigned: section([]),
        })}
      />
    );
    const [first, second] = within(sectionOf("Minha fila")).getAllByRole("listitem");

    expect(within(first!).getByRole("link", { name: "SUP-1024" })).toBeVisible();
    expect(within(first!).getByText("Respondeu após resolver")).toBeVisible();
    expect(within(second!).getByRole("link", { name: "SUP-1030" })).toBeVisible();
  });
});

describe("TicketQueuePanel — o 'Ver todos' tem o recorte da seção", () => {
  const FILTER_METHODS = ["eq", "neq", "is", "not", "or", "ilike"];

  // Builder encadeável que grava cada chamada e resolve sem linhas: o mesmo de
  // get-tickets-page.test.ts, aqui só para comparar os filtros.
  function recordQuery() {
    const calls: unknown[][] = [];
    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject),
    };
    for (const method of ["select", "ilike", "eq", "neq", "is", "not", "or", "order", "range", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push([method, ...args]);
        return builder;
      };
    }
    fromMock.mockReturnValueOnce(builder);
    return calls;
  }

  // Os filtros como conjunto: a ordem dos filtros não muda o recorte.
  const cut = (calls: unknown[][]) =>
    calls
      .filter(([method]) => FILTER_METHODS.includes(String(method)))
      .map((call) => JSON.stringify(call))
      .sort();

  it.each([
    ["Minha fila", 0],
    ["Não atribuídos", 1],
  ] as const)(
    "%s: o link, lido pela allowlist e montado pela lista, filtra igual à seção (mesmo total)",
    async (title, sectionIndex) => {
      render(
        <TicketQueuePanel
          queue={queue({
            mine: section([ticket({ id: OTHER_TICKET_ID, number: 1030 })], { total: 12 }),
            unassigned: section([ticket()], { total: 9 }),
          })}
        />
      );
      const href = within(sectionOf(title))
        .getByRole("link", { name: /Ver todos/ })
        .getAttribute("href");
      const search = new URL(href ?? "", "http://localhost").searchParams;

      const listCalls = recordQuery();
      await getTicketsPage(parseTicketListParams(Object.fromEntries(search)), VIEWER);
      const queueCalls = [recordQuery(), recordQuery()];
      await getTicketQueue(VIEWER);

      const sectionCut = cut(queueCalls[sectionIndex]!);
      expect(sectionCut).toHaveLength(2);
      expect(cut(listCalls)).toEqual(sectionCut);
    }
  );
});

describe("TicketQueuePanel — ações", () => {
  it("'Atender' faz o take-over e relê a fila", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(takeOverOk());
    render(<TicketQueuePanel queue={queue()} />);

    await user.click(screen.getByRole("button", { name: "Atender SUP-1024" }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Você assumiu SUP-1024."));
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/tickets/${TICKET_ID}/take-over`,
      method: "POST",
      body: {},
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("'Alguém já pegou' com o nome de quem está com o ticket, e relê", async () => {
    const user = userEvent.setup();
    stubFetch(
      jsonResponse(
        {
          ok: false,
          code: "already_assigned",
          message: "O ticket já está com outro analista.",
          assigned_to_user_id: "u2",
          assigned_to_name: "Ana Lima",
        },
        409
      )
    );
    render(<TicketQueuePanel queue={queue()} />);

    await user.click(screen.getByRole("button", { name: "Atender SUP-1024" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Ana Lima já pegou SUP-1024."));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("sem o nome, 'Alguém já pegou'", async () => {
    const user = userEvent.setup();
    stubFetch(
      jsonResponse({ ok: false, code: "already_assigned", message: "Já está com outro." }, 409)
    );
    render(<TicketQueuePanel queue={queue()} />);

    await user.click(screen.getByRole("button", { name: "Atender SUP-1024" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Alguém já pegou SUP-1024."));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("'Reabrir' e 'Fechar' movem com a versão que a tela leu", async () => {
    const user = userEvent.setup();
    const replied = repliedTicket();
    const fetchMock = stubFetch(
      jsonResponse({
        ok: true,
        ticket: summaryOf(replied, { status: "em_atendimento", version: 4 }),
        from: "resolvido",
        to: "em_atendimento",
        changed: true,
      }),
      jsonResponse({
        ok: true,
        ticket: summaryOf(replied, { status: "fechado", version: 4 }),
        from: "resolvido",
        to: "fechado",
        changed: true,
      })
    );
    render(<TicketQueuePanel queue={queue({ mine: section([repliedTicket()]) })} />);

    await user.click(screen.getByRole("button", { name: "Reabrir SUP-1024" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("SUP-1024 reaberto."));
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/tickets/${TICKET_ID}/transition`,
      method: "POST",
      body: { to: "em_atendimento", version: 3 },
    });

    await user.click(screen.getByRole("button", { name: "Fechar SUP-1024" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("SUP-1024 fechado."));
    expect(requestOf(fetchMock, 1).body).toEqual({ to: "fechado", version: 3 });
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("versão velha: avisa que o ticket mudou em outro lugar e relê", async () => {
    const user = userEvent.setup();
    stubFetch(
      jsonResponse(
        { ok: false, code: "version_conflict", message: "O ticket mudou…", current_version: 4 },
        409
      )
    );
    render(<TicketQueuePanel queue={queue({ mine: section([repliedTicket()]) })} />);

    await user.click(screen.getByRole("button", { name: "Fechar SUP-1024" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("O ticket mudou em outro lugar.")
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("transição recusada lista os destinos permitidos (rótulos de recurso, sem catálogo)", async () => {
    const user = userEvent.setup();
    stubFetch(
      jsonResponse(
        {
          ok: false,
          code: "invalid_transition",
          message: "Esse movimento não é permitido.",
          allowed: ["em_atendimento"],
          current: "resolvido",
        },
        409
      )
    );
    render(<TicketQueuePanel queue={queue({ mine: section([repliedTicket()]) })} />);

    await user.click(screen.getByRole("button", { name: "Fechar SUP-1024" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("De Resolvido só vai para Em atendimento.")
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("falha de rede não relê e não inventa sucesso", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<TicketQueuePanel queue={queue()} />);

    await user.click(screen.getByRole("button", { name: "Atender SUP-1024" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Não foi possível concluir a operação. Confira a conexão e tente de novo."
      )
    );
    expect(refreshMock).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("'Fechar' com changed: false (já estava fechado) não avisa, mas relê", async () => {
    const user = userEvent.setup();
    const replied = repliedTicket();
    stubFetch(
      jsonResponse({
        ok: true,
        ticket: summaryOf(replied, { status: "fechado" }),
        from: "fechado",
        to: "fechado",
        changed: false,
      })
    );
    render(<TicketQueuePanel queue={queue({ mine: section([replied]) })} />);

    await user.click(screen.getByRole("button", { name: "Fechar SUP-1024" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("dois cliques em 'Atender' antes de o botão desabilitar ainda fazem UM POST (a trava é a ref)", async () => {
    let release: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<TicketQueuePanel queue={queue()} />);

    const button = screen.getByRole("button", { name: "Atender SUP-1024" });
    // No mesmo tique: o React ainda não desenhou o `disabled` da 1ª ação.
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await act(async () => release(takeOverOk()));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uma ação por vez: com uma em voo, os outros botões ficam desabilitados", async () => {
    const user = userEvent.setup();
    let resolveFetch: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => (resolveFetch = resolve))
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <TicketQueuePanel
        queue={queue({
          mine: section([repliedTicket({ id: OTHER_TICKET_ID, number: 1030 })]),
          unassigned: section([ticket()]),
        })}
      />
    );

    await user.click(screen.getByRole("button", { name: "Atender SUP-1024" }));

    expect(screen.getByRole("button", { name: "Atender SUP-1024" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reabrir SUP-1030" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fechar SUP-1030" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Reabrir SUP-1030" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(takeOverOk());
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Você assumiu SUP-1024."));
  });
});

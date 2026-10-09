import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { replaceMock, refreshMock, toastMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock, refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { FollowupsQueue } from "@/features/followups/components/followups-queue";
import type {
  FollowupQueueItem,
  FollowupQueueParams,
  FollowupsQueuePage,
} from "@/features/followups/types";

const FETCHED_AT = "2026-10-09T15:00:00.000Z";

const item = (overrides: Partial<FollowupQueueItem> = {}): FollowupQueueItem => ({
  id: "f1",
  kind: "retorno",
  status: "pendente",
  // Um dia depois da leitura: no prazo.
  due_at: "2026-10-10T15:00:00+00:00",
  notes: "Ligar para confirmar a correção.",
  done_at: null,
  ticket: {
    id: "t1",
    number: 1024,
    title: "Erro ao emitir nota fiscal",
    status: "em_atendimento",
    customer: { id: "c1", legal_name: "Padaria S. João Ltda", trade_name: "Padaria São João" },
  },
  ...overrides,
});

const queuePage = (overrides: Partial<FollowupsQueuePage> = {}): FollowupsQueuePage => ({
  items: [item()],
  total: 1,
  page: 1,
  pageSize: 25,
  pageCount: 1,
  failed: false,
  fetchedAt: FETCHED_AT,
  ...overrides,
});

const params = (overrides: Partial<FollowupQueueParams> = {}): FollowupQueueParams => ({
  situacao: "pendentes",
  responsavel: "todos",
  page: 1,
  ...overrides,
});

const originalMatchMedia = window.matchMedia;

// O Dialog/Popover decide entre caixa e gaveta pela largura: no teste, desktop.
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

/** A tabela do desktop (a pilha do celular repete as mesmas linhas). */
function table() {
  return within(screen.getByRole("table"));
}

describe("FollowupsQueue", () => {
  it("mostra o retorno com o protocolo levando ao ticket, a empresa e a contagem do recorte", () => {
    render(<FollowupsQueue page={queuePage()} params={params()} />);

    expect(screen.getByText("1 retorno pendente")).toBeInTheDocument();
    expect(table().getByRole("link", { name: "SUP-1024" })).toHaveAttribute("href", "/app/tickets/1024");
    expect(table().getByText("Erro ao emitir nota fiscal")).toBeInTheDocument();
    expect(table().getByText("Ligar para confirmar a correção.")).toBeInTheDocument();
    expect(table().getByText("Padaria São João")).toBeInTheDocument();
    expect(table().getByText("Retorno")).toBeInTheDocument();
    expect(table().getByText("Pendente")).toBeInTheDocument();
    expect(table().queryByText(/vencido/)).not.toBeInTheDocument();
  });

  it("destaca o pendente com prazo antes da leitura como vencido", () => {
    render(
      <FollowupsQueue
        page={queuePage({ items: [item({ due_at: "2026-10-09T09:00:00+00:00" })] })}
        params={params()}
      />
    );

    expect(table().getByText(/· vencido/)).toBeInTheDocument();
  });

  it("concluído não é vencido, e a ação dele é Reabrir", () => {
    render(
      <FollowupsQueue
        page={queuePage({
          items: [item({ status: "concluido", due_at: "2026-10-01T09:00:00+00:00", done_at: FETCHED_AT })],
        })}
        params={params({ situacao: "concluidos" })}
      />
    );

    expect(screen.getByText("1 retorno concluído")).toBeInTheDocument();
    expect(table().queryByText(/vencido/)).not.toBeInTheDocument();
    expect(table().getByRole("button", { name: "Reabrir" })).toBeInTheDocument();
    expect(table().queryByRole("button", { name: "Concluir" })).not.toBeInTheDocument();
  });

  it("Concluir faz o PATCH do retorno e relê a página", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FollowupsQueue page={queuePage()} params={params()} />);

    await user.click(table().getByRole("button", { name: "Concluir" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/followups/f1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ status: "concluido" });
    expect(toastMock.success).toHaveBeenCalledWith("Retorno concluído.");
  });

  it("recusa do servidor vira toast com a mensagem dele, sem reler", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "Retorno não encontrado." }), { status: 404 }))
    );
    render(<FollowupsQueue page={queuePage()} params={params()} />);

    await user.click(table().getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Retorno não encontrado."));
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("a situação escolhida vai para a URL", async () => {
    const user = userEvent.setup();
    render(<FollowupsQueue page={queuePage()} params={params()} />);

    await user.click(screen.getByRole("button", { name: "Filtros" }));
    await user.click(await screen.findByRole("combobox", { name: "Filtrar por situação" }));
    await user.click(await screen.findByRole("option", { name: "Vencidos" }));

    expect(replaceMock).toHaveBeenCalledWith("/app/follow-ups?situacao=vencidos", { scroll: false });
  });

  it("'Meus tickets' vai para a URL mantendo a situação", async () => {
    const user = userEvent.setup();
    render(<FollowupsQueue page={queuePage()} params={params({ situacao: "todos" })} />);

    await user.click(screen.getByRole("button", { name: "Filtros (1)" }));
    await user.click(await screen.findByRole("combobox", { name: "Filtrar por responsável do ticket" }));
    await user.click(await screen.findByRole("option", { name: "Meus tickets" }));

    expect(replaceMock).toHaveBeenCalledWith("/app/follow-ups?situacao=todos&responsavel=eu", {
      scroll: false,
    });
  });

  it("fila vazia sem filtro explica de onde vêm os retornos", () => {
    render(<FollowupsQueue page={queuePage({ items: [], total: 0 })} params={params()} />);

    expect(screen.getByText("Nenhum retorno pendente. Retornos nascem na ficha do ticket.")).toBeInTheDocument();
  });

  it("filtro sem resultado oferece Limpar, que volta à fila padrão", async () => {
    const user = userEvent.setup();
    render(
      <FollowupsQueue page={queuePage({ items: [], total: 0 })} params={params({ responsavel: "eu" })} />
    );

    expect(screen.getByText("Nenhum retorno encontrado.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Limpar" }));

    expect(replaceMock).toHaveBeenCalledWith("/app/follow-ups", { scroll: false });
  });

  it("leitura que falhou não diz 'nenhum retorno': oferece Tentar de novo", async () => {
    const user = userEvent.setup();
    render(<FollowupsQueue page={queuePage({ items: [], total: 0, failed: true })} params={params()} />);

    expect(screen.getByText("Não foi possível carregar os retornos.")).toBeInTheDocument();
    expect(screen.queryByText(/Nenhum retorno/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(refreshMock).toHaveBeenCalled();
  });
});

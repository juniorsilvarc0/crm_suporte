import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

import {
  IntegrationLogsTable,
  integrationLogsHref,
} from "@/features/integrations/components/integration-logs-table";
import { DEFAULT_INTEGRATION_LOG_FILTERS } from "@/features/integrations/lib/log-filters";
import type { IntegrationLogFilters, IntegrationLogItem, IntegrationLogsPage } from "@/features/integrations/types";

const TOKEN_ID = "0b8f2c1e-6a4d-4f2b-9c1a-7d3e5f6a8b90";

const log = (overrides: Partial<IntegrationLogItem> = {}): IntegrationLogItem => ({
  id: "00000000-0000-4000-8000-000000000001",
  created_at: "2026-10-02T14:30:00.123456+00:00",
  provider: "api_v1",
  direction: "inbound",
  action: "GET",
  status: "ok",
  http_status: 200,
  latency_ms: 12,
  route: "/api/v1/tickets",
  request_id: "pedido-1",
  error: null,
  token: { id: TOKEN_ID, name: "IA de triagem", prefix: "crmsuporte_ab" },
  actor: null,
  ...overrides,
});

const RELAY_ERROR = log({
  id: "00000000-0000-4000-8000-000000000002",
  provider: "relay",
  direction: "outbound",
  action: "conversation.message_received",
  status: "error",
  http_status: 502,
  latency_ms: 840,
  route: null,
  request_id: "msg-9",
  error: "O agente respondeu HTTP 502.",
  token: null,
});

const KEY_ROTATED = log({
  id: "00000000-0000-4000-8000-000000000003",
  provider: "relay",
  direction: null,
  action: "signing_secret.rotated",
  http_status: null,
  latency_ms: null,
  route: null,
  request_id: null,
  token: null,
  actor: { id: "11111111-1111-4111-8111-111111111111", name: "Ana Admin" },
});

const ok = (items: IntegrationLogItem[], nextCursor: string | null = null): IntegrationLogsPage => ({
  state: "ok",
  items,
  nextCursor,
});

const TOKENS = [{ id: TOKEN_ID, name: "IA de triagem" }];

function renderTable(page: IntegrationLogsPage, filters: IntegrationLogFilters = DEFAULT_INTEGRATION_LOG_FILTERS) {
  return render(<IntegrationLogsTable page={page} filters={filters} tokens={TOKENS} />);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("integrationLogsHref", () => {
  it("leva a aba e só os filtros fora do padrão; o cursor nunca vai para a URL da página", () => {
    expect(integrationLogsHref(DEFAULT_INTEGRATION_LOG_FILTERS)).toBe("/app/conexao?aba=registros");
    expect(
      integrationLogsHref({ ...DEFAULT_INTEGRATION_LOG_FILTERS, integracao: "relay", status: "error", periodo: "24h" })
    ).toBe("/app/conexao?aba=registros&integracao=relay&status=error&periodo=24h");
  });
});

describe("IntegrationLogsTable", () => {
  it("mostra cada registro com integração, ação, rota, erro, status com HTTP, quem e tempo", () => {
    renderTable(ok([log(), RELAY_ERROR, KEY_ROTATED]));

    const table = within(screen.getByRole("table"));
    const rows = table.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);

    const api = within(rows[0]);
    expect(api.getByText("API do CRM")).toBeInTheDocument();
    expect(api.getByText("GET")).toBeInTheDocument();
    expect(api.getByText("/api/v1/tickets")).toBeInTheDocument();
    expect(api.getByText("Sucesso · 200")).toBeInTheDocument();
    expect(api.getByText("IA de triagem (crmsuporte_ab…)")).toBeInTheDocument();
    expect(api.getByText("pedido-1")).toBeInTheDocument();
    expect(api.getByText("12 ms")).toBeInTheDocument();

    const relay = within(rows[1]);
    expect(relay.getByText("Agente de IA")).toBeInTheDocument();
    expect(relay.getByText("Repasse de mensagem")).toBeInTheDocument();
    expect(relay.getByText("Erro · 502")).toBeInTheDocument();
    expect(relay.getByText("O agente respondeu HTTP 502.")).toBeInTheDocument();

    const key = within(rows[2]);
    expect(key.getByText("Chave trocada")).toBeInTheDocument();
    expect(key.getByText("Ana Admin")).toBeInTheDocument();
    expect(key.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("ação ou integração que a tela não conhece aparece como veio, e não some", () => {
    renderTable(ok([log({ provider: "outra", action: "acao.nova" })]));

    const row = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(within(row).getByText("outra")).toBeInTheDocument();
    expect(within(row).getByText("acao.nova")).toBeInTheDocument();
  });

  it("quem fez sem nome legível não vira um nome inventado", () => {
    renderTable(ok([log({ token: null, actor: { id: "11111111-1111-4111-8111-111111111111", name: null } })]));

    expect(within(screen.getByRole("table")).getByText("Usuário não identificado")).toBeInTheDocument();
  });

  it("diz quantos registros mostra, e que há mais quando há", () => {
    renderTable(ok([log()], "cursor-1"));

    expect(screen.getByText(/1 registro, e há mais · últimos 7 dias/)).toBeInTheDocument();
  });

  it("leitura que falhou não diz \"nenhum registro\": avisa e oferece tentar de novo", async () => {
    renderTable({ state: "unavailable" });

    expect(screen.getByText("Não foi possível carregar os registros.")).toBeInTheDocument();
    expect(screen.queryByText(/Nenhum registro/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("lista vazia sem filtro e lista vazia com filtro dizem coisas diferentes", () => {
    const { unmount } = renderTable(ok([]));
    expect(screen.getByText("Nenhum registro de integração no período.")).toBeInTheDocument();
    unmount();

    renderTable(ok([]), { ...DEFAULT_INTEGRATION_LOG_FILTERS, status: "error" });
    expect(screen.getByText("Nenhum registro com esses filtros.")).toBeInTheDocument();
  });

  describe("carregar mais", () => {
    it("pede a página seguinte com os mesmos filtros e o cursor, e junta à lista", async () => {
      fetchMock.mockResolvedValue(Response.json({ ok: true, items: [RELAY_ERROR], nextCursor: null }));
      renderTable(ok([log()], "cursor-1"), { ...DEFAULT_INTEGRATION_LOG_FILTERS, integracao: "api_v1" });

      await userEvent.setup().click(screen.getByRole("button", { name: "Carregar mais" }));

      expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/connection/logs?integracao=api_v1&cursor=cursor-1", {
        cache: "no-store",
      });
      await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3));
      expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
    });

    it("a falha avisa com a mensagem do servidor e mantém o botão", async () => {
      fetchMock.mockResolvedValue(Response.json({ ok: false, message: "Cursor inválido." }, { status: 400 }));
      renderTable(ok([log()], "cursor-1"));

      await userEvent.setup().click(screen.getByRole("button", { name: "Carregar mais" }));

      await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Cursor inválido."));
      expect(screen.getByRole("button", { name: "Carregar mais" })).toBeEnabled();
      expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    });

    it("sem resposta legível, avisa com a frase padrão", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      renderTable(ok([log()], "cursor-1"));

      await userEvent.setup().click(screen.getByRole("button", { name: "Carregar mais" }));

      await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Não foi possível carregar mais registros."));
    });

    it("página nova do servidor zera o que tinha sido carregado em cima da anterior", async () => {
      fetchMock.mockResolvedValue(Response.json({ ok: true, items: [RELAY_ERROR], nextCursor: "cursor-2" }));
      const { rerender } = renderTable(ok([log()], "cursor-1"));
      await userEvent.setup().click(screen.getByRole("button", { name: "Carregar mais" }));
      await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3));

      rerender(
        <IntegrationLogsTable page={ok([KEY_ROTATED])} filters={DEFAULT_INTEGRATION_LOG_FILTERS} tokens={TOKENS} />
      );

      const rows = within(screen.getByRole("table")).getAllByRole("row");
      expect(rows).toHaveLength(2);
      expect(within(rows[1]).getByText("Chave trocada")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
    });

    it("a resposta que chega depois de a página trocar não entra na lista nova", async () => {
      let resolve!: (value: Response) => void;
      fetchMock.mockReturnValue(new Promise<Response>((done) => (resolve = done)));
      const { rerender } = renderTable(ok([log()], "cursor-1"));
      await userEvent.setup().click(screen.getByRole("button", { name: "Carregar mais" }));

      rerender(
        <IntegrationLogsTable page={ok([KEY_ROTATED])} filters={DEFAULT_INTEGRATION_LOG_FILTERS} tokens={TOKENS} />
      );
      await act(async () => resolve(Response.json({ ok: true, items: [RELAY_ERROR], nextCursor: null })));

      expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    });
  });

  describe("id do pedido", () => {
    it("vai para a URL depois da pausa de digitação, com os outros filtros", () => {
      vi.useFakeTimers();
      renderTable(ok([log()]), { ...DEFAULT_INTEGRATION_LOG_FILTERS, integracao: "api_v1" });

      fireEvent.change(screen.getByRole("textbox", { name: "Buscar pelo id do pedido" }), { target: { value: " req-42 " } });
      act(() => vi.advanceTimersByTime(299));
      expect(replaceMock).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));

      expect(replaceMock).toHaveBeenCalledExactlyOnceWith("/app/conexao?aba=registros&integracao=api_v1&pedido=req-42", {
        scroll: false,
      });
    });

    it("texto que não tem a forma de um id avisa e não navega", () => {
      vi.useFakeTimers();
      renderTable(ok([log()]));

      fireEvent.change(screen.getByRole("textbox", { name: "Buscar pelo id do pedido" }), { target: { value: "a b" } });
      act(() => vi.advanceTimersByTime(1000));

      expect(replaceMock).not.toHaveBeenCalled();
      expect(screen.getByText(/O id do pedido tem só letras, números/)).toBeInTheDocument();
    });

    it("com o pedido na URL, avisa que o período não vale", () => {
      renderTable(ok([log()]), { ...DEFAULT_INTEGRATION_LOG_FILTERS, pedido: "pedido-1" });

      expect(screen.getByRole("textbox", { name: "Buscar pelo id do pedido" })).toHaveValue("pedido-1");
      expect(screen.getByText("A busca pelo id do pedido vale para todo o registro, fora do período.")).toBeInTheDocument();
      expect(screen.getByText("1 registro")).toBeInTheDocument();
    });

    it("pedido que muda na URL por fora (voltar do navegador) atualiza o campo", () => {
      const { rerender } = renderTable(ok([log()]), { ...DEFAULT_INTEGRATION_LOG_FILTERS, pedido: "pedido-1" });

      rerender(
        <IntegrationLogsTable
          page={ok([log()])}
          filters={{ ...DEFAULT_INTEGRATION_LOG_FILTERS, pedido: "pedido-2" }}
          tokens={TOKENS}
        />
      );

      expect(screen.getByRole("textbox", { name: "Buscar pelo id do pedido" })).toHaveValue("pedido-2");
    });
  });

  it("limpar filtros volta à aba sem filtro e esvazia o campo do pedido", async () => {
    renderTable(ok([log()]), { ...DEFAULT_INTEGRATION_LOG_FILTERS, status: "error", pedido: "pedido-1" });

    await userEvent.setup().click(screen.getByRole("button", { name: "Limpar filtros" }));

    expect(replaceMock).toHaveBeenCalledWith("/app/conexao?aba=registros", { scroll: false });
    expect(screen.getByRole("textbox", { name: "Buscar pelo id do pedido" })).toHaveValue("");
  });

  it("o botão de filtros diz quantos estão ativos (o período só conta fora do padrão)", () => {
    renderTable(ok([log()]), { ...DEFAULT_INTEGRATION_LOG_FILTERS, integracao: "relay", status: "ok", periodo: "30d" });

    expect(screen.getByRole("button", { name: "Filtros (3)" })).toBeInTheDocument();
  });
});

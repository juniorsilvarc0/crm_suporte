import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, toastMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { WEBHOOK_EVENTS } from "@/features/webhooks/catalog";
import { WebhooksManager } from "@/features/webhooks/components/webhooks-manager";
import type { WebhookSubscription } from "@/features/webhooks/types";

const SECRET = "a1b2".repeat(16);

function subscription(over: Partial<WebhookSubscription> = {}): WebhookSubscription {
  return {
    id: "sub-1",
    name: "ERP",
    url: "https://erp.exemplo.com/hook",
    events: [...WEBHOOK_EVENTS],
    isActive: true,
    hasSecret: true,
    createdAt: "2026-10-09T12:00:00Z",
    updatedAt: "2026-10-09T12:00:00Z",
    ...over,
  };
}

type Route = (init: RequestInit | undefined) => Response;
let routes: Record<string, Route>;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (key: string) =>
  fetchMock.mock.calls.filter(([url, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${String(url).split("?")[0]}` === key);
const bodyOf = (key: string) => JSON.parse(String((calls(key).at(-1)?.[1] as RequestInit).body));

const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  // O Dialog decide entre caixa e gaveta pela largura: no teste, desktop.
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

beforeEach(() => {
  routes = {
    "GET /api/webhooks/deliveries": () => Response.json({ ok: true, deliveries: [] }),
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(url).split("?")[0]}`;
    const route = routes[key];
    if (!route) throw new Error(`rota não mockada: ${key}`);
    return route(init);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function openMenu(user: ReturnType<typeof userEvent.setup>, name = "ERP") {
  await user.click(screen.getByRole("button", { name: `Mais ações de ${name}` }));
  return screen.findByRole("menu");
}

describe("WebhooksManager: estados", () => {
  it("leitura que falhou: diz isso (nunca 'nenhum destino') e oferece reler", async () => {
    const user = userEvent.setup();
    render(<WebhooksManager subscriptions={null} />);

    expect(screen.getByText("Não foi possível carregar os destinos.")).toBeInTheDocument();
    expect(screen.queryByText(/Nenhum destino/)).toBeNull();
    expect(screen.getByRole("button", { name: "Novo destino" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem destino: estado vazio, e as entregas nem são lidas", () => {
    render(<WebhooksManager subscriptions={[]} />);
    expect(screen.getByText(/Nenhum destino cadastrado/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lista com status em texto, URL, eventos e o aviso de destino sem segredo", async () => {
    render(
      <WebhooksManager
        subscriptions={[
          subscription(),
          subscription({ id: "sub-2", name: "Painel", isActive: false, hasSecret: false, events: ["ticket.created", "ticket.reopened"] }),
        ]}
      />
    );

    const items = screen.getAllByRole("listitem").slice(0, 2);
    expect(within(items[0]).getByText("Ativo")).toBeInTheDocument();
    expect(within(items[0]).getByText("https://erp.exemplo.com/hook")).toBeInTheDocument();
    expect(within(items[0]).getByText("Todos os eventos")).toBeInTheDocument();
    expect(within(items[1]).getByText("Pausado")).toBeInTheDocument();
    expect(within(items[1]).getByText("Sem segredo: nada sai")).toBeInTheDocument();
    expect(within(items[1]).getByText("2 eventos")).toBeInTheDocument();
    // As entregas são lidas ao abrir a aba.
    await waitFor(() => expect(calls("GET /api/webhooks/deliveries")).toHaveLength(1));
  });
});

describe("WebhooksManager: cadastrar", () => {
  it("envia nome, URL e eventos; o segredo aparece uma vez e só depois de Concluir a tela relê", async () => {
    routes["POST /api/webhooks"] = () =>
      Response.json({ ok: true, subscription: subscription({ id: "sub-9", name: "Novo ERP" }), secret: SECRET });
    const user = userEvent.setup();
    render(<WebhooksManager subscriptions={[]} />);

    await user.click(screen.getByRole("button", { name: "Novo destino" }));
    await user.type(screen.getByRole("textbox", { name: "Nome" }), "Novo ERP");
    await user.type(screen.getByRole("textbox", { name: "URL" }), "https://novo.exemplo.com/hook");
    await user.click(screen.getByRole("checkbox", { name: "Ticket aberto (ticket.created)" }));
    await user.click(screen.getByRole("checkbox", { name: "SLA estourado (ticket.sla_breached)" }));
    await user.click(screen.getByRole("button", { name: "Cadastrar destino" }));

    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(bodyOf("POST /api/webhooks")).toEqual({
      name: "Novo ERP",
      url: "https://novo.exemplo.com/hook",
      events: ["ticket.created", "ticket.sla_breached"],
    });
    expect(screen.getByRole("heading", { name: "Destino cadastrado" })).toBeInTheDocument();
    // Com o segredo na tela, nada de refresh (ele poderia recarregar a página).
    expect(refreshMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Copiar o segredo" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Concluir" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText(SECRET)).toBeNull());
  });

  it("sem evento, o formulário não envia; a recusa da URL pelo servidor vai para o campo", async () => {
    routes["POST /api/webhooks"] = () =>
      Response.json(
        { ok: false, message: "A URL aponta para um host de rede interna (bloqueado).", errors: { url: ["A URL aponta para um host de rede interna (bloqueado)."] } },
        { status: 422 }
      );
    const user = userEvent.setup();
    render(<WebhooksManager subscriptions={[]} />);

    await user.click(screen.getByRole("button", { name: "Novo destino" }));
    await user.type(screen.getByRole("textbox", { name: "Nome" }), "Interno");
    await user.type(screen.getByRole("textbox", { name: "URL" }), "http://10.0.0.5/hook");
    await user.click(screen.getByRole("button", { name: "Cadastrar destino" }));
    expect(await screen.findByText("Escolha ao menos um evento.")).toBeInTheDocument();
    expect(calls("POST /api/webhooks")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Marcar todos" }));
    await user.click(screen.getByRole("button", { name: "Cadastrar destino" }));
    expect(await screen.findByText("A URL aponta para um host de rede interna (bloqueado).")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "URL" })).toHaveAttribute("aria-invalid", "true");
  });
});

describe("WebhooksManager: editar, testar e as ações do menu", () => {
  it("editar manda só o que mudou", async () => {
    routes["PATCH /api/webhooks/sub-1"] = () => Response.json({ ok: true, subscription: subscription({ name: "ERP novo" }) });
    const user = userEvent.setup();
    render(<WebhooksManager subscriptions={[subscription()]} />);

    const menu = await openMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Editar" }));
    const name = screen.getByRole("textbox", { name: "Nome" });
    await user.clear(name);
    await user.type(name, "ERP novo");
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(calls("PATCH /api/webhooks/sub-1")).toHaveLength(1));
    expect(bodyOf("PATCH /api/webhooks/sub-1")).toEqual({ name: "ERP novo" });
    expect(toastMock.success).toHaveBeenCalledWith("Destino salvo.");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("testar diz o host, o HTTP e o tempo; num 401, aponta o segredo", async () => {
    routes["POST /api/webhooks/sub-1/ping"] = () =>
      Response.json({ ok: true, result: { error: null, httpStatus: 200, latencyMs: 85 } });
    const user = userEvent.setup();
    render(<WebhooksManager subscriptions={[subscription()]} />);

    await user.click(screen.getByRole("button", { name: "Testar a conexão com ERP" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("erp.exemplo.com respondeu HTTP 200 em 85 ms."));

    routes["POST /api/webhooks/sub-1/ping"] = () =>
      Response.json({ ok: true, result: { error: "O destino respondeu HTTP 401.", httpStatus: 401, latencyMs: 30 } });
    await user.click(screen.getByRole("button", { name: "Testar a conexão com ERP" }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("erp.exemplo.com respondeu HTTP 401. Confira se o destino usa o segredo atual.")
    );

    routes["POST /api/webhooks/sub-1/ping"] = () =>
      Response.json({ ok: false, message: "Muitos testes seguidos. Tente de novo em 40 s." }, { status: 429 });
    await user.click(screen.getByRole("button", { name: "Testar a conexão com ERP" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Muitos testes seguidos. Tente de novo em 40 s."));
  });

  it("trocar o segredo pede confirmação e mostra o novo uma vez", async () => {
    routes["POST /api/webhooks/sub-1/secret"] = () => Response.json({ ok: true, secret: SECRET });
    const user = userEvent.setup();
    render(<WebhooksManager subscriptions={[subscription()]} />);

    const menu = await openMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Trocar segredo" }));
    expect(screen.getByText('O segredo atual de "ERP" deixa de valer na hora.')).toBeInTheDocument();
    expect(calls("POST /api/webhooks/sub-1/secret")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Trocar segredo" }));

    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Segredo trocado" })).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Concluir" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("troca sem resposta: avisa que o segredo pode ter mudado", async () => {
    routes["POST /api/webhooks/sub-1/secret"] = () => {
      throw new TypeError("rede");
    };
    const user = userEvent.setup();
    render(<WebhooksManager subscriptions={[subscription()]} />);

    const menu = await openMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Trocar segredo" }));
    await user.click(screen.getByRole("button", { name: "Trocar segredo" }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Não deu para confirmar a troca. Se o destino passar a recusar a assinatura, troque o segredo de novo."
      )
    );
  });

  it("pausar e excluir pedem confirmação; reativar não", async () => {
    routes["PATCH /api/webhooks/sub-1"] = () => Response.json({ ok: true, subscription: subscription({ isActive: false }) });
    routes["DELETE /api/webhooks/sub-1"] = () => Response.json({ ok: true });
    routes["PATCH /api/webhooks/sub-2"] = () => Response.json({ ok: true, subscription: subscription({ id: "sub-2" }) });
    const user = userEvent.setup();
    render(<WebhooksManager subscriptions={[subscription(), subscription({ id: "sub-2", name: "Painel", isActive: false })]} />);

    let menu = await openMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Pausar" }));
    await user.click(screen.getByRole("button", { name: "Pausar" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Destino pausado."));
    expect(bodyOf("PATCH /api/webhooks/sub-1")).toEqual({ is_active: false });

    menu = await openMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Excluir" }));
    await user.click(screen.getByRole("button", { name: "Excluir destino" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Destino excluído."));
    expect(calls("DELETE /api/webhooks/sub-1")).toHaveLength(1);

    menu = await openMenu(user, "Painel");
    await user.click(within(menu).getByRole("menuitem", { name: "Reativar" }));
    await waitFor(() => expect(calls("PATCH /api/webhooks/sub-2")).toHaveLength(1));
    expect(bodyOf("PATCH /api/webhooks/sub-2")).toEqual({ is_active: true });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, toastMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { AutomationSettings } from "@/features/settings/components/automation-settings";

const URL_OK = "https://agente.exemplo.com/webhook";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const none = { configuredUrl: null, state: "none", reason: null } as const;
const active = { configuredUrl: URL_OK, state: "active", reason: null } as const;

describe("AutomationSettings", () => {
  it("sem URL: avisa que o CRM não repassa, e não cita reserva de ambiente", () => {
    render(<AutomationSettings config={none} />);

    expect(screen.getByText(/Nenhuma URL configurada/)).toBeInTheDocument();
    expect(screen.getByText(/Deixe vazio para desligar o repasse/)).toBeInTheDocument();
    expect(screen.queryByText(/Ativo/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/fallback|N8N_WEBHOOK_URL|ambiente/i);
    expect(screen.getByLabelText("Webhook do agente de IA")).toBeEnabled();
  });

  it("com URL que o envio aceita: mostra que está ativo, com a URL no campo", () => {
    render(<AutomationSettings config={active} />);

    expect(screen.getByLabelText("Webhook do agente de IA")).toHaveValue(URL_OK);
    expect(screen.getByText(/Ativo — repassando para a URL acima/)).toBeInTheDocument();
    expect(screen.queryByText(/Nenhuma URL configurada/)).not.toBeInTheDocument();
    expect(screen.queryByText(/recusada/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("URL salva que o envio recusa: NÃO diz ativo; diz que nada é repassado, e por quê", () => {
    render(
      <AutomationSettings
        config={{
          configuredUrl: "http://10.0.0.5/hook",
          state: "refused",
          reason: "A URL aponta para um host de rede interna (bloqueado).",
        }}
      />
    );

    expect(screen.queryByText(/Ativo/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /A URL salva é recusada no envio, e nada está sendo repassado\. Motivo: A URL aponta para um host de rede interna \(bloqueado\)\./
      )
    ).toBeInTheDocument();
    // A URL fica no campo, para ser corrigida.
    expect(screen.getByLabelText("Webhook do agente de IA")).toHaveValue("http://10.0.0.5/hook");
    expect(screen.getByLabelText("Webhook do agente de IA")).toBeEnabled();
  });

  it("configuração que não pôde ser lida: não diz `nenhuma URL`, e trava o campo e o botão", async () => {
    const user = userEvent.setup();
    render(<AutomationSettings config={{ configuredUrl: null, state: "unreadable", reason: null }} />);

    expect(screen.getByText(/Não foi possível ler a configuração agora/)).toBeInTheDocument();
    expect(screen.queryByText(/Nenhuma URL configurada/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ativo/)).not.toBeInTheDocument();
    const field = screen.getByLabelText("Webhook do agente de IA");
    expect(field).toBeDisabled();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();

    // Nem colando dá para gravar por cima de uma URL que não foi vista.
    await user.click(field);
    await user.paste(URL_OK);
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(field).toHaveValue("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("limpar o campo e salvar desliga o repasse, e a mensagem diz isso", async () => {
    const user = userEvent.setup();
    render(<AutomationSettings config={active} />);

    await user.clear(screen.getByLabelText("Webhook do agente de IA"));
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/settings/automation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relayUrl: "" }),
    });
    expect(toastMock.success).toHaveBeenCalledWith("Campo limpo: o repasse está desligado.");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("salvar uma URL: confirma, e a recusa do servidor aparece com o motivo", async () => {
    const user = userEvent.setup();
    render(<AutomationSettings config={none} />);

    // Colar, e não digitar tecla a tecla: é uma URL inteira, e cada tecla é um ciclo de render.
    await user.click(screen.getByLabelText("Webhook do agente de IA"));
    await user.paste(URL_OK);
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(fetchMock).toHaveBeenLastCalledWith("/api/settings/automation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relayUrl: URL_OK }),
    });
    expect(toastMock.success).toHaveBeenCalledWith("Webhook salvo.");

    fetchMock.mockResolvedValue(
      Response.json({ ok: false, message: "Em produção a URL deve usar HTTPS." }, { status: 400 })
    );
    await user.paste("/v2");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(toastMock.error).toHaveBeenCalledWith("Em produção a URL deve usar HTTPS.");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["o pedido nem sai (rede)", () => Promise.reject(new TypeError("fetch failed"))],
    ["a resposta 200 não é JSON", async () => new Response("<html>proxy</html>", { status: 200 })],
    ["a resposta diz ok, mas o status é de erro", async () => Response.json({ ok: true }, { status: 502 })],
    ["o status é 200, mas a resposta diz que falhou", async () => Response.json({ ok: false }, { status: 200 })],
  ])("quando %s: avisa que não salvou, e não recarrega", async (_label, respond) => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(respond);
    render(<AutomationSettings config={none} />);

    await user.click(screen.getByLabelText("Webhook do agente de IA"));
    await user.paste(URL_OK);
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(toastMock.error).toHaveBeenCalledWith("Não foi possível salvar.");
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    // O botão volta a ficar disponível para tentar de novo.
    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
  });

  it("depois de salvar, o campo acompanha a configuração que o servidor devolve", () => {
    const { rerender } = render(<AutomationSettings config={none} />);
    expect(screen.getByLabelText("Webhook do agente de IA")).toHaveValue("");

    rerender(<AutomationSettings config={active} />);

    expect(screen.getByLabelText("Webhook do agente de IA")).toHaveValue(URL_OK);
    expect(screen.getByText(/Ativo — repassando para a URL acima/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
  });
});

describe("AutomationSettings: testar conexão", () => {
  const test = () => screen.getByRole("button", { name: "Testar conexão" });
  const HOST = "agente.exemplo.com";
  const delivered = { sent: true, host: HOST, delivered: true, error: null, httpStatus: 200, latencyMs: 132, signed: true };
  const HINT = "O teste vai à URL salva: salve antes de testar.";

  it.each([
    ["sem URL", none],
    ["com a URL recusada pelo envio", { configuredUrl: "http://10.0.0.5/hook", state: "refused", reason: "bloqueado" }],
    ["com a configuração ilegível", { configuredUrl: null, state: "unreadable", reason: null }],
  ] as const)("%s: o teste fica indisponível", (_label, config) => {
    render(<AutomationSettings config={config} />);

    expect(test()).toBeDisabled();
    // O campo não foi mexido: não há o que explicar sobre salvar.
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it("com o campo alterado e não salvo: o teste fica indisponível, e a tela diz por quê", async () => {
    const user = userEvent.setup();
    render(<AutomationSettings config={active} />);
    expect(test()).toBeEnabled();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Webhook do agente de IA"));
    await user.paste("/v2");

    expect(test()).toBeDisabled();
    expect(screen.getByText(HINT)).toBeInTheDocument();
    await user.click(test());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dispara um POST sem corpo (a URL testada é a salva, não a do campo) e diz para onde foi e o que voltou", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ ok: true, result: delivered }));
    render(<AutomationSettings config={active} />);

    await user.click(test());

    expect(fetchMock.mock.calls).toEqual([["/api/connection/agent/test", { method: "POST" }]]);
    expect(toastMock.success.mock.calls).toEqual([
      ["agente.exemplo.com respondeu HTTP 200 em 132 ms. Pedido enviado com assinatura."],
    ]);
    expect(toastMock.error).not.toHaveBeenCalled();
    // Testar não muda configuração: nada a recarregar.
    expect(refreshMock).not.toHaveBeenCalled();
    expect(test()).toBeEnabled();
  });

  it("o host do aviso é o que o SERVIDOR testou, e não o do campo (outro administrador pode ter salvo outra URL)", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ ok: true, result: { ...delivered, host: "outro-agente.exemplo.net:8443" } }));
    render(<AutomationSettings config={active} />);

    await user.click(test());

    expect(toastMock.success.mock.calls).toEqual([
      ["outro-agente.exemplo.net:8443 respondeu HTTP 200 em 132 ms. Pedido enviado com assinatura."],
    ]);
  });

  it("sem chave de assinatura: o sucesso diz que o pedido foi sem assinatura", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ ok: true, result: { ...delivered, signed: false } }));
    render(<AutomationSettings config={active} />);

    await user.click(test());

    expect(toastMock.success.mock.calls).toEqual([
      ["agente.exemplo.com respondeu HTTP 200 em 132 ms. Pedido enviado sem assinatura: não há chave."],
    ]);
  });

  it.each([
    [
      "o agente recusa (401), com o pedido assinado",
      { sent: true, host: HOST, delivered: false, error: "O agente respondeu HTTP 401.", httpStatus: 401, latencyMs: 80, signed: true },
      "agente.exemplo.com respondeu HTTP 401. Pedido enviado com assinatura.",
    ],
    [
      "o agente recusa (401), com o pedido sem assinatura",
      { sent: true, host: HOST, delivered: false, error: "O agente respondeu HTTP 401.", httpStatus: 401, latencyMs: 80, signed: false },
      "agente.exemplo.com respondeu HTTP 401. Pedido enviado sem assinatura: não há chave.",
    ],
    [
      "o agente redireciona (308): diz que o CRM não segue",
      { sent: true, host: HOST, delivered: false, error: "O agente respondeu HTTP 308.", httpStatus: 308, latencyMs: 20, signed: true },
      "agente.exemplo.com respondeu HTTP 308. O CRM não segue redirecionamento: salve o endereço final. Pedido enviado com assinatura.",
    ],
    [
      "o agente responde 300 (o primeiro da faixa de redirecionamento)",
      { sent: true, host: HOST, delivered: false, error: "O agente respondeu HTTP 300.", httpStatus: 300, latencyMs: 20, signed: false },
      "agente.exemplo.com respondeu HTTP 300. O CRM não segue redirecionamento: salve o endereço final. Pedido enviado sem assinatura: não há chave.",
    ],
    [
      "o agente responde 400 (logo depois da faixa de redirecionamento)",
      { sent: true, host: HOST, delivered: false, error: "O agente respondeu HTTP 400.", httpStatus: 400, latencyMs: 20, signed: true },
      "agente.exemplo.com respondeu HTTP 400. Pedido enviado com assinatura.",
    ],
    [
      "o agente não responde no prazo: sem falar de assinatura (nada voltou)",
      { sent: true, host: HOST, delivered: false, error: "O agente não respondeu em 10 s.", httpStatus: null, latencyMs: 10000, signed: true },
      "agente.exemplo.com: O agente não respondeu em 10 s.",
    ],
    [
      "o nome não existe (rede): sem falar de assinatura (nada chegou a ninguém)",
      { sent: true, host: HOST, delivered: false, error: "Falha de rede (ENOTFOUND).", httpStatus: null, latencyMs: 12, signed: true },
      "agente.exemplo.com: Falha de rede (ENOTFOUND).",
    ],
    [
      "nada saiu (URL recusada no servidor)",
      { sent: false, error: "URL do agente recusada: Em produção a URL deve usar HTTPS." },
      "URL do agente recusada: Em produção a URL deve usar HTTPS.",
    ],
    [
      "nada saiu (cofre ilegível)",
      { sent: false, error: "Cofre indisponível: não foi possível ler a chave de assinatura." },
      "Cofre indisponível: não foi possível ler a chave de assinatura.",
    ],
  ])("quando %s: o aviso é de erro, com o motivo", async (_label, result, message) => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ ok: true, result }));
    render(<AutomationSettings config={active} />);

    await user.click(test());

    expect(toastMock.error.mock.calls).toEqual([[message]]);
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it.each([
    ["o pedido nem sai (rede)", () => Promise.reject(new TypeError("fetch failed")), "Não foi possível testar a conexão."],
    ["a resposta 200 não é JSON", async () => new Response("<html>proxy</html>", { status: 200 }), "Não foi possível testar a conexão."],
    ["a resposta diz ok, mas não traz o desfecho", async () => Response.json({ ok: true }), "Não foi possível testar a conexão."],
    [
      "a resposta traz o desfecho, mas o status é de erro",
      async () => Response.json({ ok: true, result: delivered }, { status: 502 }),
      "Não foi possível testar a conexão.",
    ],
    [
      "o status é 200 e há desfecho, mas a resposta diz que falhou",
      async () => Response.json({ ok: false, message: "Sessão inválida.", result: delivered }),
      "Sessão inválida.",
    ],
    [
      "o servidor recusa (403), com mensagem",
      async () => Response.json({ ok: false, message: "Apenas administradores podem executar esta ação." }, { status: 403 }),
      "Apenas administradores podem executar esta ação.",
    ],
    [
      "passou do teto de testes por minuto (429)",
      async () => Response.json({ ok: false, message: "Muitos testes seguidos. Tente de novo em 40 s." }, { status: 429 }),
      "Muitos testes seguidos. Tente de novo em 40 s.",
    ],
  ])("quando %s: avisa que o teste não rodou, e nunca diz que o agente respondeu", async (_label, respond, message) => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(respond);
    render(<AutomationSettings config={active} />);

    await user.click(test());

    expect(toastMock.error.mock.calls).toEqual([[message]]);
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(test()).toBeEnabled();
  });

  it("enquanto testa, o botão fica travado (um clique, um pedido ao agente)", async () => {
    const user = userEvent.setup();
    let release: (response: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (release = resolve)));
    render(<AutomationSettings config={active} />);

    await user.click(test());

    expect(test()).toBeDisabled();
    await user.click(test());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(Response.json({ ok: true, result: delivered }));
    await vi.waitFor(() => expect(test()).toBeEnabled());
  });

  it("salvar e testar não se misturam: o Salvar segue travado sem alteração, e o teste não grava nada", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ ok: true, result: delivered }));
    render(<AutomationSettings config={active} />);

    await user.click(test());

    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/connection/agent/test"]);
  });
});

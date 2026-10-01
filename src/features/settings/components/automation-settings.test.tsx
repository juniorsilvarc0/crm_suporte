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

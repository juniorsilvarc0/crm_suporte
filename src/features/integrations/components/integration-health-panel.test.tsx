import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IntegrationHealthPanel } from "@/features/integrations/components/integration-health-panel";
import type { IntegrationHealth } from "@/features/integrations/types";

const HEALTH: IntegrationHealth = {
  generatedAt: "2026-10-02T17:05:00.000Z",
  windowHours: 24,
  whatsapp: { state: "open", instance: "5527999990000" },
  lastInbound: { state: "ok", at: "2026-10-02T16:58:00.000000+00:00", exact: true },
  connectionHistory: { state: "ok", events: [] },
  relay: {
    config: "active",
    reason: null,
    deliveries: {
      state: "ok",
      total: 40,
      errors: 3,
      lastOkAt: "2026-10-02T16:59:00.000000+00:00",
      lastErrorAt: "2026-10-02T12:10:00.000000+00:00",
    },
  },
  api: { calls: { state: "ok", total: 500, clientErrors: 12, serverErrors: 2 } },
};

const respond = (health: IntegrationHealth) => Response.json({ ok: true, health });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => respond(HEALTH));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderLoaded(health: IntegrationHealth = HEALTH) {
  fetchMock.mockResolvedValue(respond(health));
  render(<IntegrationHealthPanel />);
  await screen.findByText(/Lido às/);
}

describe("IntegrationHealthPanel", () => {
  it("lê a rota ao montar, e mostra o esqueleto até a resposta chegar", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((done) => (resolve = done)));

    render(<IntegrationHealthPanel />);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/connection/health", { cache: "no-store" });
    expect(screen.getByText("Lendo a saúde das integrações…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeDisabled();

    await act(async () => resolve(respond(HEALTH)));

    expect(screen.getByText("Lido às 14:05. Uma leitura vale por alguns segundos.")).toBeInTheDocument();
  });

  it("tudo respondendo: cada parte com o seu texto, as contagens como vieram", async () => {
    await renderLoaded();

    expect(screen.getByText("Conectado.")).toBeInTheDocument();
    expect(screen.getByText("Número: (27) 99999-0000.")).toBeInTheDocument();
    expect(screen.getByText("02/10/2026 13:58")).toBeInTheDocument();
    expect(screen.getByText("Ativo.")).toBeInTheDocument();
    expect(screen.getByText("3 de 40 com erro nas últimas 24 h.")).toBeInTheDocument();
    expect(screen.getByText("Último entregue: 02/10/2026 13:59.")).toBeInTheDocument();
    expect(screen.getByText("Último com erro: 02/10/2026 09:10.")).toBeInTheDocument();
    expect(screen.getByText("500 chamadas nas últimas 24 h.")).toBeInTheDocument();
    expect(
      screen.getByText("12 recusadas por erro de quem chamou (4xx) e 2 com erro do CRM (5xx).")
    ).toBeInTheDocument();
  });

  it("parte que não foi lida diz que não foi lida: nunca vira zero nem \"nenhuma\"", async () => {
    await renderLoaded({
      ...HEALTH,
      whatsapp: { state: "unavailable", cause: "crm", instance: null },
      lastInbound: { state: "unavailable" },
      connectionHistory: { state: "unavailable" },
      relay: { config: "unreadable", reason: null, deliveries: { state: "unavailable" } },
      api: { calls: { state: "unavailable" } },
    });

    expect(screen.getByText("Não foi possível ler a integração no CRM.")).toBeInTheDocument();
    expect(screen.getByText("Não foi possível ler as mensagens.")).toBeInTheDocument();
    expect(screen.getByText("Não foi possível ler o histórico.")).toBeInTheDocument();
    expect(screen.getByText("Não foi possível ler a configuração do agente.")).toBeInTheDocument();
    expect(screen.getByText("Não foi possível ler os repasses.")).toBeInTheDocument();
    expect(screen.getByText("Não foi possível ler as chamadas.")).toBeInTheDocument();
    expect(screen.queryByText(/Nenhum/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Número:/)).not.toBeInTheDocument();
  });

  it("o provedor sem resposta é dito como do provedor, com o telefone guardado", async () => {
    await renderLoaded({ ...HEALTH, whatsapp: { state: "unavailable", cause: "provider", instance: "5527999990000" } });

    expect(screen.getByText("A uazapi não respondeu agora.")).toBeInTheDocument();
    expect(screen.getByText("Número: (27) 99999-0000.")).toBeInTheDocument();
  });

  it.each([
    [{ state: "not_configured" } as const, "Nenhuma instância configurada."],
    [{ state: "connecting", instance: null } as const, "Conectando."],
    [{ state: "close", instance: null } as const, "Desconectado."],
    [{ state: "unknown", instance: null } as const, "Estado desconhecido."],
  ])("WhatsApp %o: %s", async (whatsapp, text) => {
    await renderLoaded({ ...HEALTH, whatsapp });

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("histórico da conexão: cada mudança com hora, estado em palavras e o motivo da uazapi", async () => {
    await renderLoaded({
      ...HEALTH,
      connectionHistory: {
        state: "ok",
        events: [
          { state: "open", reason: null, occurredAt: "2026-10-09T10:54:00.000Z" },
          { state: "close", reason: "logged out", occurredAt: "2026-10-08T19:07:00.000Z" },
        ],
      },
    });

    expect(screen.getByText("09/10/2026 07:54 · Conectado.")).toBeInTheDocument();
    expect(screen.getByText("08/10/2026 16:07 · Desconectado (logged out).")).toHaveClass("text-rose-600");
  });

  it("histórico vazio explica que o monitor grava na mudança", async () => {
    await renderLoaded();
    expect(
      screen.getByText("Nenhuma mudança registrada ainda: o monitor grava quando o estado muda.")
    ).toBeInTheDocument();
  });

  it("última mensagem que é piso diz que pode haver uma mais recente", async () => {
    await renderLoaded({ ...HEALTH, lastInbound: { state: "ok", at: "2026-10-02T09:00:00.000000+00:00", exact: false } });

    expect(
      screen.getByText("02/10/2026 06:00 ou mais recente (só as 50 conversas mais recentes foram olhadas).")
    ).toBeInTheDocument();
  });

  it.each([
    [true, "Nenhuma mensagem recebida ainda."],
    [false, "Nenhuma mensagem recebida nas 50 conversas mais recentes."],
  ])("sem mensagem recebida (exata: %s)", async (exact, text) => {
    await renderLoaded({ ...HEALTH, lastInbound: { state: "ok", at: null, exact } });

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("agente com URL recusada mostra o motivo; sem URL diz que nada é repassado", async () => {
    await renderLoaded({
      ...HEALTH,
      relay: { ...HEALTH.relay, config: "refused", reason: "O endereço aponta para uma rede interna." },
    });
    expect(
      screen.getByText("URL recusada, nada é repassado. Motivo: O endereço aponta para uma rede interna.")
    ).toBeInTheDocument();
  });

  it("sem repasse e sem chamada na janela: zeros ditos em palavras", async () => {
    await renderLoaded({
      ...HEALTH,
      relay: {
        ...HEALTH.relay,
        config: "none",
        deliveries: { state: "ok", total: 0, errors: 0, lastOkAt: null, lastErrorAt: null },
      },
      api: { calls: { state: "ok", total: 0, clientErrors: 0, serverErrors: 0 } },
    });

    expect(screen.getByText("Nenhuma URL configurada: o CRM não repassa as mensagens.")).toBeInTheDocument();
    expect(screen.getByText("Nenhum repasse nas últimas 24 h.")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma chamada registrada nas últimas 24 h.")).toBeInTheDocument();
  });

  it.each([
    ["recusa do servidor", () => Response.json({ ok: false, message: "Sem permissão." }, { status: 403 }), "Sem permissão."],
    ["resposta que não é do app", () => new Response("<html>", { status: 502 }), "Não foi possível ler a saúde das integrações."],
  ])("%s: mostra o motivo, e Atualizar segue disponível", async (_label, response, message) => {
    fetchMock.mockResolvedValue(response());

    render(<IntegrationHealthPanel />);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeEnabled();
  });

  it("rede fora do ar: a mesma frase, e não uma tela quebrada", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    render(<IntegrationHealthPanel />);

    expect(await screen.findByText("Não foi possível ler a saúde das integrações.")).toBeInTheDocument();
  });

  it("Atualizar lê de novo e troca o conteúdo pela leitura nova", async () => {
    await renderLoaded();
    fetchMock.mockResolvedValue(respond({ ...HEALTH, generatedAt: "2026-10-02T17:10:00.000Z" }));

    await userEvent.setup().click(screen.getByRole("button", { name: "Atualizar" }));

    await waitFor(() => expect(screen.getByText(/Lido às 14:10/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a resposta que chega depois de sair da aba é descartada sem erro", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((done) => (resolve = done)));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { unmount } = render(<IntegrationHealthPanel />);

    unmount();
    await act(async () => resolve(respond(HEALTH)));

    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

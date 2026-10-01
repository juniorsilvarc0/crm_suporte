import { useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { RelayConfig } from "@/features/settings/lib/get-relay-url";
import type { RelaySigning } from "@/features/settings/queries/get-relay-signing";

// A página é fina: confirma o admin no banco, faz as leituras e entrega cada
// uma ao bloco dela. O guard, as leituras e os blocos viram marcadores; as abas
// montam todos os painéis de uma vez (a de verdade só monta o painel ativo).
const m = vi.hoisted(() => ({
  admin: vi.fn(),
  apiTokens: vi.fn(),
  relayConfig: vi.fn(),
  relaySigning: vi.fn(),
  botSignature: vi.fn(),
  variables: vi.fn(),
  model: vi.fn(),
  AutomationSettings: vi.fn<(props: { config: RelayConfig }) => ReactNode>(() => <div data-testid="webhook" />),
  RelaySigningSettings: vi.fn<(props: { signing: RelaySigning }) => ReactNode>(() => <div data-testid="chave" />),
  signingMounts: vi.fn(),
  BotSignatureSettings: vi.fn<(props: { config: unknown }) => ReactNode>(() => <div data-testid="assinatura-bot" />),
  ApiTokensManager: vi.fn<(props: { tokens: unknown }) => ReactNode>(() => <div data-testid="tokens" />),
  EnvironmentVariablesManager: vi.fn<(props: { variables: unknown; transcriptionModel: unknown }) => ReactNode>(
    () => <div data-testid="cofre" />
  ),
}));

// Só o guard de admin: trocar por outro faz a página falhar aqui.
vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireAdminPage: m.admin }));
vi.mock("@/features/settings/queries/get-api-tokens", () => ({ getApiTokens: m.apiTokens }));
vi.mock("@/features/settings/lib/get-relay-url", () => ({ getRelayConfig: m.relayConfig }));
vi.mock("@/features/settings/queries/get-relay-signing", () => ({ getRelaySigning: m.relaySigning }));
vi.mock("@/features/settings/lib/get-bot-signature", () => ({ getBotSignatureConfig: m.botSignature }));
vi.mock("@/features/settings/queries/get-environment-variables", () => ({
  getEnvironmentVariables: m.variables,
  getTranscriptionModelConfig: m.model,
}));
vi.mock("@/features/settings/components/automation-settings", () => ({ AutomationSettings: m.AutomationSettings }));
vi.mock("@/features/settings/components/relay-signing-settings", () => ({
  RelaySigningSettings: (props: { signing: RelaySigning }) => {
    // Conta as MONTAGENS: um `key` que mudasse com o estado remontaria o bloco,
    // e fecharia o diálogo com a chave recém-gerada.
    useEffect(() => {
      m.signingMounts();
    }, []);
    return m.RelaySigningSettings(props);
  },
}));
vi.mock("@/features/settings/components/bot-signature-settings", () => ({ BotSignatureSettings: m.BotSignatureSettings }));
vi.mock("@/features/settings/components/api-tokens-manager", () => ({ ApiTokensManager: m.ApiTokensManager }));
vi.mock("@/features/settings/components/environment-variables-manager", () => ({
  EnvironmentVariablesManager: m.EnvironmentVariablesManager,
}));
vi.mock("@/components/layout/page-header", () => ({ PageHeader: () => null }));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  TabsContent: ({ children, value, keepMounted }: { children: ReactNode; value: string; keepMounted?: boolean }) => (
    <section data-testid={`aba-${value}`} data-keep-mounted={String(Boolean(keepMounted))}>
      {children}
    </section>
  ),
}));

import ConfiguracoesPage from "@/app/(dashboard)/app/configuracoes/page";

const RELAY_CONFIG: RelayConfig = { configuredUrl: "https://agente.exemplo.com/hook", state: "active", reason: null };
const SIGNING: RelaySigning = { state: "configured", updatedAt: "2026-10-01T12:00:00+00:00" };
const BOT_SIGNATURE = { marker: "assinatura do bot" };
const TOKENS = [{ id: "t1" }];
const VARIABLES = [{ name: "OPENAI_API_KEY" }];
const MODEL = { value: "whisper-1", source: "default" };

beforeEach(() => {
  m.admin.mockResolvedValue({ id: "admin-1", role: "admin" });
  m.apiTokens.mockResolvedValue(TOKENS);
  m.relayConfig.mockResolvedValue(RELAY_CONFIG);
  m.relaySigning.mockResolvedValue(SIGNING);
  m.botSignature.mockResolvedValue(BOT_SIGNATURE);
  m.variables.mockResolvedValue(VARIABLES);
  m.model.mockResolvedValue(MODEL);
});

afterEach(() => {
  vi.clearAllMocks();
});

const reads = [m.apiTokens, m.relayConfig, m.relaySigning, m.botSignature, m.variables, m.model];

describe("Configurações", () => {
  it("sem admin confirmado no banco, o redirect do guard interrompe antes de qualquer leitura", async () => {
    m.admin.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(ConfiguracoesPage()).rejects.toThrow("NEXT_REDIRECT");

    expect(m.admin).toHaveBeenCalledOnce();
    for (const read of reads) expect(read).not.toHaveBeenCalled();
  });

  it("cada leitura é feita uma vez e chega ao bloco dela", async () => {
    render(await ConfiguracoesPage());

    for (const read of reads) expect(read).toHaveBeenCalledOnce();
    expect(m.AutomationSettings.mock.calls[0]![0]).toEqual({ config: RELAY_CONFIG });
    expect(m.RelaySigningSettings.mock.calls[0]![0]).toEqual({ signing: SIGNING });
    expect(m.BotSignatureSettings.mock.calls[0]![0]).toEqual({ config: BOT_SIGNATURE });
    expect(m.ApiTokensManager.mock.calls[0]![0]).toEqual({ tokens: TOKENS });
    expect(m.EnvironmentVariablesManager.mock.calls[0]![0]).toEqual({
      variables: VARIABLES,
      transcriptionModel: MODEL,
    });
  });

  it.each<[string, RelaySigning]>([
    ["sem chave", { state: "absent" }],
    ["com chave", SIGNING],
    ["cofre ilegível (não vira `sem chave`)", { state: "unreadable" }],
  ])("%s: o estado da chave chega ao bloco como veio", async (_label, signing) => {
    m.relaySigning.mockResolvedValue(signing);

    render(await ConfiguracoesPage());

    expect(m.RelaySigningSettings.mock.calls[0]![0]).toEqual({ signing });
  });

  it("o refresh que muda o estado da chave NÃO remonta o bloco: o diálogo com a chave gerada continua aberto", async () => {
    m.relaySigning.mockResolvedValue({ state: "absent" });
    const { rerender } = render(await ConfiguracoesPage());

    m.relaySigning.mockResolvedValue(SIGNING);
    rerender(await ConfiguracoesPage());

    expect(m.RelaySigningSettings.mock.lastCall![0]).toEqual({ signing: SIGNING });
    expect(m.signingMounts).toHaveBeenCalledTimes(1);
  });

  it("a aba Agente de IA não desmonta ao trocar de aba (a chave gerada só aparece uma vez); as outras, sim", async () => {
    render(await ConfiguracoesPage());

    expect(screen.getByTestId("aba-agent")).toHaveAttribute("data-keep-mounted", "true");
    expect(screen.getByTestId("aba-variables")).toHaveAttribute("data-keep-mounted", "false");
    expect(screen.getByTestId("aba-api")).toHaveAttribute("data-keep-mounted", "false");
  });

  it("a aba Agente de IA traz o webhook, a chave de assinatura e a assinatura das mensagens, nessa ordem", async () => {
    render(await ConfiguracoesPage());

    const agent = screen.getByTestId("aba-agent");
    const blocks = within(agent)
      .getAllByTestId(/^(webhook|chave|assinatura-bot)$/)
      .map((block) => block.getAttribute("data-testid"));
    expect(blocks).toEqual(["webhook", "chave", "assinatura-bot"]);
    // Dois "assinatura" na mesma aba: os títulos dizem qual é qual.
    expect(
      within(agent)
        .getAllByRole("heading")
        .map((heading) => heading.textContent)
    ).toEqual(["Integração do agente", "Chave de assinatura do webhook", "Assinatura das mensagens da IA"]);
    // A chave fica no bloco dela: o título vem logo antes, no mesmo contêiner.
    const keyBlock = within(agent).getByTestId("chave").closest("div.border-t");
    expect(keyBlock).not.toBeNull();
    expect(within(keyBlock as HTMLElement).getByRole("heading")).toHaveTextContent("Chave de assinatura do webhook");
  });

  it("os blocos do agente não vazam para as outras abas", async () => {
    render(await ConfiguracoesPage());

    expect(within(screen.getByTestId("aba-variables")).getByTestId("cofre")).toBeInTheDocument();
    expect(within(screen.getByTestId("aba-api")).getByTestId("tokens")).toBeInTheDocument();
    for (const tab of ["aba-variables", "aba-api"]) {
      expect(within(screen.getByTestId(tab)).queryByTestId("chave")).not.toBeInTheDocument();
      expect(within(screen.getByTestId(tab)).queryByTestId("webhook")).not.toBeInTheDocument();
    }
  });
});

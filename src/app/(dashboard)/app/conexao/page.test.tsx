import { useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { RelayConfig } from "@/features/settings/lib/get-relay-url";
import type { RelaySigning } from "@/features/settings/queries/get-relay-signing";

// A página é fina: confirma o admin no banco, faz as leituras e entrega cada
// uma ao bloco dela. O guard, as leituras e os blocos viram marcadores; as abas
// montam todos os painéis de uma vez (a de verdade só monta o painel ativo).
// Até o PR 13a, estes blocos moravam em /app/configuracoes.
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
  logs: vi.fn(),
  health: vi.fn(),
  IntegrationLogsTable: vi.fn<(props: { page: unknown; filters: unknown; tokens: unknown }) => ReactNode>(
    () => <div data-testid="registros" />
  ),
  webhooks: vi.fn(),
  hasAdminEnv: vi.fn(),
  adminClient: { marker: "admin-client" },
  WebhooksManager: vi.fn<(props: { subscriptions: unknown }) => ReactNode>(() => <div data-testid="destinos" />),
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
vi.mock("@/features/webhooks/queries/get-webhooks", () => ({ getWebhookSubscriptions: m.webhooks }));
vi.mock("@/features/webhooks/components/webhooks-manager", () => ({ WebhooksManager: m.WebhooksManager }));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: m.hasAdminEnv,
  createSupabaseAdminClient: () => m.adminClient,
}));
vi.mock("@/components/layout/page-header", () => ({ PageHeader: () => null }));
vi.mock("@/features/integrations/queries/get-integration-logs", () => ({ getIntegrationLogs: m.logs }));
// A Saúde nunca é lida pela página: o painel pede a rota no navegador.
vi.mock("@/features/integrations/queries/get-integration-health", () => ({ getIntegrationHealth: m.health }));
vi.mock("@/features/integrations/components/integration-logs-table", () => ({
  IntegrationLogsTable: m.IntegrationLogsTable,
}));
vi.mock("@/features/integrations/components/integration-health-panel", () => ({
  IntegrationHealthPanel: () => <div data-testid="saude" />,
}));
vi.mock("@/features/connection/components/connection-panel", () => ({
  ConnectionPanel: () => <div data-testid="whatsapp" />,
}));
// As abas na URL viram marcadores: todos os painéis montados, cada um com o
// `keepMounted` que a lista de abas deu a ele.
vi.mock("@/components/layout/url-tabs", () => ({
  UrlTabs: ({
    tabs,
    panels,
  }: {
    tabs: ReadonlyArray<{ value: string; label: string; keepMounted?: boolean }>;
    panels: Record<string, ReactNode>;
  }) => (
    <div>
      {tabs.map(({ value, label, keepMounted }) => (
        <section key={value} data-testid={`aba-${value}`} data-label={label} data-keep-mounted={String(Boolean(keepMounted))}>
          {panels[value]}
        </section>
      ))}
    </div>
  ),
}));

import ConexaoPage from "@/app/(dashboard)/app/conexao/page";

const RELAY_CONFIG: RelayConfig = { configuredUrl: "https://agente.exemplo.com/hook", state: "active", reason: null };
const SIGNING: RelaySigning = { state: "configured", updatedAt: "2026-10-01T12:00:00+00:00" };
const BOT_SIGNATURE = { marker: "assinatura do bot" };
const TOKENS = [{ id: "t1", name: "IA de triagem", token_prefix: "crmsuporte_ab", scopes: [] }];
const LOGS_PAGE = { state: "ok", items: [], nextCursor: null };
const SUBSCRIPTIONS = [{ id: "sub-1", name: "ERP" }];

/** A página com a query string dada, como o Next a entrega. */
const open = (query: Record<string, string | string[]> = {}) => ConexaoPage({ searchParams: Promise.resolve(query) });
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
  m.logs.mockResolvedValue(LOGS_PAGE);
  m.hasAdminEnv.mockReturnValue(true);
  m.webhooks.mockResolvedValue(SUBSCRIPTIONS);
});

afterEach(() => {
  vi.clearAllMocks();
});

const reads = [m.apiTokens, m.relayConfig, m.relaySigning, m.botSignature, m.variables, m.model, m.webhooks];

describe("Integrações (/app/conexao)", () => {
  it("sem admin confirmado no banco, o redirect do guard interrompe antes de qualquer leitura", async () => {
    m.admin.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(open()).rejects.toThrow("NEXT_REDIRECT");

    expect(m.admin).toHaveBeenCalledOnce();
    for (const read of reads) expect(read).not.toHaveBeenCalled();
  });

  it("cada leitura é feita uma vez e chega ao bloco dela", async () => {
    render(await open());

    for (const read of reads) expect(read).toHaveBeenCalledOnce();
    expect(m.AutomationSettings.mock.calls[0]![0]).toEqual({ config: RELAY_CONFIG });
    expect(m.RelaySigningSettings.mock.calls[0]![0]).toEqual({ signing: SIGNING });
    expect(m.BotSignatureSettings.mock.calls[0]![0]).toEqual({ config: BOT_SIGNATURE });
    expect(m.ApiTokensManager.mock.calls[0]![0]).toEqual({ tokens: TOKENS });
    expect(m.webhooks).toHaveBeenCalledWith(m.adminClient);
    expect(m.WebhooksManager.mock.calls[0]![0]).toEqual({ subscriptions: SUBSCRIPTIONS });
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

    render(await open());

    expect(m.RelaySigningSettings.mock.calls[0]![0]).toEqual({ signing });
  });

  it("o refresh que muda o estado da chave NÃO remonta o bloco: o diálogo com a chave gerada continua aberto", async () => {
    m.relaySigning.mockResolvedValue({ state: "absent" });
    const { rerender } = render(await open());

    m.relaySigning.mockResolvedValue(SIGNING);
    rerender(await open());

    expect(m.RelaySigningSettings.mock.lastCall![0]).toEqual({ signing: SIGNING });
    expect(m.signingMounts).toHaveBeenCalledTimes(1);
  });

  it("sem Supabase admin, os destinos chegam como null (a aba diz que não leu), sem consultar", async () => {
    m.hasAdminEnv.mockReturnValue(false);

    render(await open());

    expect(m.webhooks).not.toHaveBeenCalled();
    expect(m.WebhooksManager.mock.calls[0]![0]).toEqual({ subscriptions: null });
  });

  it("as abas, na ordem: WhatsApp (a padrão), API do CRM, Webhooks, Agente de IA e Variáveis", async () => {
    render(await open());

    expect(screen.getAllByTestId(/^aba-/).map((tab) => [tab.dataset.testid, tab.dataset.label])).toEqual([
      ["aba-whatsapp", "WhatsApp"],
      ["aba-api", "API do CRM"],
      ["aba-webhooks", "Webhooks"],
      ["aba-agente", "Agente de IA"],
      ["aba-variaveis", "Variáveis"],
      ["aba-registros", "Registros"],
      ["aba-saude", "Saúde"],
    ]);
    expect(within(screen.getByTestId("aba-whatsapp")).getByTestId("whatsapp")).toBeInTheDocument();
  });

  it("a aba Agente de IA não desmonta ao trocar de aba (a chave gerada só aparece uma vez); as outras, sim", async () => {
    render(await open());

    expect(screen.getByTestId("aba-agente")).toHaveAttribute("data-keep-mounted", "true");
    for (const tab of ["aba-whatsapp", "aba-api", "aba-webhooks", "aba-variaveis", "aba-registros", "aba-saude"]) {
      expect(screen.getByTestId(tab)).toHaveAttribute("data-keep-mounted", "false");
    }
  });

  it("a aba Agente de IA traz o webhook, a chave de assinatura e a assinatura das mensagens, nessa ordem", async () => {
    render(await open());

    const agent = screen.getByTestId("aba-agente");
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
    render(await open());

    expect(within(screen.getByTestId("aba-variaveis")).getByTestId("cofre")).toBeInTheDocument();
    expect(within(screen.getByTestId("aba-api")).getByTestId("tokens")).toBeInTheDocument();
    expect(within(screen.getByTestId("aba-webhooks")).getByTestId("destinos")).toBeInTheDocument();
    for (const tab of ["aba-whatsapp", "aba-variaveis", "aba-api"]) {
      expect(within(screen.getByTestId(tab)).queryByTestId("chave")).not.toBeInTheDocument();
      expect(within(screen.getByTestId(tab)).queryByTestId("webhook")).not.toBeInTheDocument();
    }
  });

  describe("Registros e Saúde", () => {
    it("fora da aba Registros, os registros não são lidos, e a aba mostra só o esqueleto", async () => {
      for (const aba of [undefined, "api", "saude", "inexistente"]) {
        m.logs.mockClear();
        const { unmount } = render(await open(aba ? { aba } : {}));

        expect(m.logs).not.toHaveBeenCalled();
        expect(within(screen.getByTestId("aba-registros")).queryByTestId("registros")).not.toBeInTheDocument();
        expect(screen.getByTestId("aba-registros").querySelector("[aria-busy='true']")).not.toBeNull();
        unmount();
      }
    });

    it("na aba Registros, lê a 1ª página com os filtros da URL e entrega página, filtros e tokens", async () => {
      const filters = {
        integracao: "relay",
        status: "error",
        acao: "webhook.ping",
        token: null,
        pedido: null,
        periodo: "24h",
      };

      render(await open({ aba: "registros", integracao: "relay", status: "error", acao: "webhook.ping", periodo: "24h" }));

      expect(m.logs).toHaveBeenCalledExactlyOnceWith(filters);
      expect(m.IntegrationLogsTable.mock.calls[0]![0]).toEqual({
        page: LOGS_PAGE,
        filters,
        tokens: [{ id: "t1", name: "IA de triagem" }],
      });
      expect(within(screen.getByTestId("aba-registros")).getByTestId("registros")).toBeInTheDocument();
    });

    it("a 1ª ocorrência de `aba` vale, como em toda a query string", async () => {
      render(await open({ aba: ["registros", "api"] }));

      expect(m.logs).toHaveBeenCalledOnce();
    });

    it("a leitura dos registros só começa depois do admin confirmado", async () => {
      m.admin.mockRejectedValue(new Error("NEXT_REDIRECT"));

      await expect(open({ aba: "registros" })).rejects.toThrow("NEXT_REDIRECT");
      expect(m.logs).not.toHaveBeenCalled();
    });

    it("a Saúde nunca é lida no servidor, nem com a aba dela aberta: o painel pede a rota", async () => {
      render(await open({ aba: "saude" }));

      expect(m.health).not.toHaveBeenCalled();
      expect(within(screen.getByTestId("aba-saude")).getByTestId("saude")).toBeInTheDocument();
    });
  });
});

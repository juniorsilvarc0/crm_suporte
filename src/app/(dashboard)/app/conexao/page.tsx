import { PageHeader } from "@/components/layout/page-header";
import { parseUrlTab, URL_TAB_PARAM } from "@/components/layout/url-tab-state";
import { UrlTabs } from "@/components/layout/url-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectionPanel } from "@/features/connection/components/connection-panel";
import { CONNECTION_TABS } from "@/features/connection/lib/connection-tabs";
import { IntegrationHealthPanel } from "@/features/integrations/components/integration-health-panel";
import { IntegrationLogsTable } from "@/features/integrations/components/integration-logs-table";
import { parseIntegrationLogFilters } from "@/features/integrations/lib/log-filters";
import { getIntegrationLogs } from "@/features/integrations/queries/get-integration-logs";
import { ApiTokensManager } from "@/features/settings/components/api-tokens-manager";
import { AutomationSettings } from "@/features/settings/components/automation-settings";
import { BotSignatureSettings } from "@/features/settings/components/bot-signature-settings";
import { EnvironmentVariablesManager } from "@/features/settings/components/environment-variables-manager";
import { RelaySigningSettings } from "@/features/settings/components/relay-signing-settings";
import { getBotSignatureConfig } from "@/features/settings/lib/get-bot-signature";
import { getRelayConfig } from "@/features/settings/lib/get-relay-url";
import { getApiTokens } from "@/features/settings/queries/get-api-tokens";
import {
  getEnvironmentVariables,
  getTranscriptionModelConfig,
} from "@/features/settings/queries/get-environment-variables";
import { getRelaySigning } from "@/features/settings/queries/get-relay-signing";
import { WebhooksManager } from "@/features/webhooks/components/webhooks-manager";
import { getWebhookSubscriptions } from "@/features/webhooks/queries/get-webhooks";
import { requireAdminPage } from "@/lib/auth/require-dashboard-session";
import { firstParam, type SearchParams } from "@/lib/http/search-params";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Integrações",
};

export default async function ConexaoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Admin confirmado no BANCO antes da leitura: member vai para /app, e quem
  // foi desativado (com cookie ainda válido) sai pelo logout.
  await requireAdminPage();
  const query = await searchParams;
  const tab = parseUrlTab(CONNECTION_TABS, firstParam(query[URL_TAB_PARAM]));
  // Os registros só são lidos com a aba deles aberta. A Saúde nunca é lida
  // aqui: o painel dela pede a rota no navegador, porque o provedor pode
  // levar segundos para responder.
  const logFilters = tab === "registros" ? parseIntegrationLogFilters(query) : null;
  const [
    logs,

    apiTokens,
    relayConfig,
    relaySigning,
    botSignature,
    environmentVariables,
    transcriptionModel,
    webhookSubscriptions,
  ] = await Promise.all([
    logFilters ? getIntegrationLogs(logFilters) : null,
    getApiTokens(),
    getRelayConfig(),
    getRelaySigning(),
    getBotSignatureConfig(),
    getEnvironmentVariables(),
    getTranscriptionModelConfig(),
    // null = a leitura falhou: a aba diz isso, em vez de "nenhum destino".
    hasSupabaseAdminEnv() ? getWebhookSubscriptions(createSupabaseAdminClient()) : null,
  ]);

  return (
    <>
      <PageHeader
        title="Integrações"
        description="WhatsApp, API do CRM, webhooks, agente de IA, variáveis, registros e saúde das integrações"
      />
      <main className="min-w-0 p-4 sm:p-6 lg:p-8">
        <UrlTabs
          tabs={CONNECTION_TABS}
          panels={{
            whatsapp: <ConnectionPanel />,
            api: <ApiTokensManager tokens={apiTokens} />,
            webhooks: <WebhooksManager subscriptions={webhookSubscriptions} />,
            agente: (
              <section className="grid gap-5">
                <div>
                  <h2 className="text-sm font-semibold">Integração do agente</h2>
                  <p className="text-sm text-muted-foreground">
                    Entrega mensagens ao agente externo enquanto a conversa está no modo IA.
                  </p>
                </div>
                <AutomationSettings config={relayConfig} />

                <div className="border-t border-border/70 pt-5">
                  <h3 className="text-sm font-medium">Chave de assinatura do webhook</h3>
                  <p className="text-sm text-muted-foreground">
                    Com ela, o agente confere que o pedido veio do CRM.
                  </p>
                  <div className="mt-3">
                    <RelaySigningSettings signing={relaySigning} />
                  </div>
                </div>

                <div className="border-t border-border/70 pt-5">
                  <h3 className="text-sm font-medium">Assinatura das mensagens da IA</h3>
                  <p className="text-sm text-muted-foreground">
                    Define como as respostas automáticas aparecem para o contato.
                  </p>
                  <div className="mt-3">
                    <BotSignatureSettings config={botSignature} />
                  </div>
                </div>
              </section>
            ),
            variaveis: (
              <EnvironmentVariablesManager
                variables={environmentVariables}
                transcriptionModel={transcriptionModel}
              />
            ),
            // Fora da aba, a página não leu os registros: ao trocar para ela, o
            // esqueleto fica até a página relida chegar com a 1ª página.
            registros:
              logs && logFilters ? (
                <IntegrationLogsTable
                  page={logs}
                  filters={logFilters}
                  tokens={apiTokens.map((token) => ({ id: token.id, name: token.name }))}
                />
              ) : (
                <div className="grid gap-3" aria-busy="true">
                  <Skeleton className="h-11 w-full max-w-sm sm:h-9" />
                  <Skeleton className="h-64 w-full" />
                </div>
              ),
            saude: <IntegrationHealthPanel />,
          }}
        />
      </main>
    </>
  );
}

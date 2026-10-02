import { PageHeader } from "@/components/layout/page-header";
import { UrlTabs } from "@/components/layout/url-tabs";
import { ConnectionPanel } from "@/features/connection/components/connection-panel";
import { CONNECTION_TABS } from "@/features/connection/lib/connection-tabs";
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
import { requireAdminPage } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Integrações",
};

export default async function ConexaoPage() {
  // Admin confirmado no BANCO antes da leitura: member vai para /app, e quem
  // foi desativado (com cookie ainda válido) sai pelo logout.
  await requireAdminPage();
  const [
    apiTokens,
    relayConfig,
    relaySigning,
    botSignature,
    environmentVariables,
    transcriptionModel,
  ] = await Promise.all([
    getApiTokens(),
    getRelayConfig(),
    getRelaySigning(),
    getBotSignatureConfig(),
    getEnvironmentVariables(),
    getTranscriptionModelConfig(),
  ]);

  return (
    <>
      <PageHeader
        title="Integrações"
        description="WhatsApp, API do CRM, agente de IA e as variáveis que o CRM usa"
      />
      <main className="min-w-0 p-4 sm:p-6 lg:p-8">
        <UrlTabs
          tabs={CONNECTION_TABS}
          panels={{
            whatsapp: <ConnectionPanel />,
            api: <ApiTokensManager tokens={apiTokens} />,
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
          }}
        />
      </main>
    </>
  );
}

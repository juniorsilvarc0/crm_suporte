import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiTokensManager } from "@/features/settings/components/api-tokens-manager";
import { AutomationSettings } from "@/features/settings/components/automation-settings";
import { BotSignatureSettings } from "@/features/settings/components/bot-signature-settings";
import { EnvironmentVariablesManager } from "@/features/settings/components/environment-variables-manager";
import { getBotSignatureConfig } from "@/features/settings/lib/get-bot-signature";
import { getRelayConfig } from "@/features/settings/lib/get-relay-url";
import { getApiTokens } from "@/features/settings/queries/get-api-tokens";
import {
  getEnvironmentVariables,
  getTranscriptionModelConfig,
} from "@/features/settings/queries/get-environment-variables";
import { requireAdminPage } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Configurações",
};

export default async function ConfiguracoesPage() {
  await requireAdminPage();
  const [
    apiTokens,
    relayConfig,
    botSignature,
    environmentVariables,
    transcriptionModel,
  ] = await Promise.all([
    getApiTokens(),
    getRelayConfig(),
    getBotSignatureConfig(),
    getEnvironmentVariables(),
    getTranscriptionModelConfig(),
  ]);

  return (
    <>
      <PageHeader title="Configurações" />
      <main className="min-w-0 p-4 sm:p-6 lg:p-8">
        <Tabs defaultValue="variables" className="min-w-0 gap-5">
          <div className="overflow-x-auto overscroll-x-contain">
            <TabsList className="h-auto min-w-max gap-1 rounded-full bg-muted/60 p-1">
              <TabsTrigger value="variables" className="h-10 rounded-full px-4 font-display data-active:bg-brand-gradient data-active:text-primary-foreground data-active:shadow-sm sm:h-9">
                Variáveis
              </TabsTrigger>
              <TabsTrigger value="api" className="h-10 rounded-full px-4 font-display data-active:bg-brand-gradient data-active:text-primary-foreground data-active:shadow-sm sm:h-9">
                API do CRM
              </TabsTrigger>
              <TabsTrigger value="agent" className="h-10 rounded-full px-4 font-display data-active:bg-brand-gradient data-active:text-primary-foreground data-active:shadow-sm sm:h-9">
                Agente de IA
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="variables">
            <EnvironmentVariablesManager
              variables={environmentVariables}
              transcriptionModel={transcriptionModel}
            />
          </TabsContent>

          <TabsContent value="api">
            <ApiTokensManager tokens={apiTokens} />
          </TabsContent>

          <TabsContent value="agent">
            <section className="grid gap-5">
              <div>
                <h2 className="text-sm font-semibold">Integração do agente</h2>
                <p className="text-sm text-muted-foreground">
                  Entrega mensagens ao agente externo enquanto a conversa está no modo IA.
                </p>
              </div>
              <AutomationSettings config={relayConfig} />

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
          </TabsContent>
        </Tabs>
      </main>
    </>
  );
}

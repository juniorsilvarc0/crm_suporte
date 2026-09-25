import type { BotSignatureConfig } from "@/features/settings/lib/get-bot-signature";

export type AgentPushResult = {
  // O agente confirmou o recebimento (respondeu 2xx).
  delivered: boolean;
  // Não há endpoint do agente configurado (BOT_SIGNATURE_AGENT_URL vazio). A
  // config fica só no CRM: a leitura pelo agente (GET) saiu na Fase 1 e volta
  // na API v1 (Fase 5 de docs/PLANO-IMPLANTACAO.md).
  skipped: boolean;
  // Motivo da falha, quando delivered=false e skipped=false.
  error?: string;
};

const TIMEOUT_MS = 5000;

// "Push on save": avisa o endpoint do agente sempre que a config muda, para ele
// aplicar a assinatura sem depender do CRM em tempo real. Best-effort — NUNCA
// lança; devolve o resultado para a UI decidir o aviso. A falha aqui não desfaz
// o save no CRM; até a API v1, o push é o único caminho até o agente.
export async function pushBotSignatureToAgent(
  config: BotSignatureConfig
): Promise<AgentPushResult> {
  const url = process.env.BOT_SIGNATURE_AGENT_URL?.trim();
  if (!url) return { delivered: false, skipped: true };

  const secret = process.env.BOT_SIGNATURE_AGENT_SECRET?.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({
        enabled: config.enabled,
        apelido: config.apelido,
        updated_at: new Date().toISOString(),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { delivered: false, skipped: false, error: `HTTP ${res.status}` };
    }
    return { delivered: true, skipped: false };
  } catch (error) {
    return {
      delivered: false,
      skipped: false,
      error: error instanceof Error ? error.message : "erro desconhecido",
    };
  } finally {
    clearTimeout(timer);
  }
}

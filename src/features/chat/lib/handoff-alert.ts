import { randomUUID } from "node:crypto";

import { getUazapiIntegration } from "@/features/chat/lib/connection/integration";
import {
  sendUazapiNotice,
  uazapiSendDefinitelyFailed,
  UazapiHttpError,
} from "@/features/chat/lib/senders/uazapi";
import {
  readHandoffAlertConfig,
  type HandoffAlertConfig,
} from "@/features/settings/lib/get-handoff-alert";
import { formatProtocol } from "@/features/tickets/lib/protocol";
import { formatPhoneBR } from "@/lib/formatters/phone";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

// Aviso à equipe pelo WhatsApp do CRM quando a IA passa a conversa para um
// humano (o handoff da API v1). A equipe da Ticbox atende por outra plataforma
// e não acompanha a tela do CRM: sem o aviso, ninguém fica sabendo da
// transferência. Vai para o número e/ou o grupo de Integrações › Agente de IA
// (app_settings.handoff_alert).
//
// Melhor esforço, como o aviso ao agente (push-takeover): a falha nunca desfaz
// nem atrasa o handoff, e a nota interna e o ticket continuam no CRM. Nunca
// lança. Sem fila durável: um tipo novo no outbox exigiria migration.

export type AlertChannelOutcome = "sent" | "failed" | "off";

export type HandoffAlertResult =
  | { skipped: true; reason: "not_configured" | "no_whatsapp" | "error" }
  | { skipped: false; number: AlertChannelOutcome; group: AlertChannelOutcome };

const SUMMARY_MAX = 500;

/** O texto do "Enviar teste" (Integrações › Agente de IA). */
export const HANDOFF_ALERT_TEST_TEXT =
  "🔔 *Teste do aviso de handoff*\n" +
  "Quando a IA passar um cliente para a equipe, o aviso chega aqui: o cliente, o chamado, o motivo e o link.";

function cut(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Link absoluto do app (`APP_PUBLIC_URL`), ou null sem a URL pública. */
export function appLink(path: string): string | null {
  const base = process.env.APP_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//i.test(base)) return null;
  return `${base}${path}`;
}

export function handoffAlertText(input: {
  contactName: string | null;
  phone: string;
  protocol: string | null;
  reason: string;
  summary: string | null;
  link: string | null;
}): string {
  const lines = ["🔔 *Cliente aguardando analista*"];
  lines.push([input.contactName?.trim(), formatPhoneBR(input.phone)].filter(Boolean).join(" · "));
  lines.push([input.protocol, cut(input.reason, 200)].filter(Boolean).join(" · "));
  if (input.summary?.trim()) lines.push(`Resumo: ${cut(input.summary, SUMMARY_MAX)}`);
  if (input.link) lines.push(`Abrir: ${input.link}`);
  return lines.join("\n");
}

/**
 * Manda `text` para cada canal preenchido, cada um por si (a falha de um não
 * impede o outro). Repete UMA vez só quando a falha deixa certeza de que a
 * mensagem não saiu: com desfecho desconhecido, repetir poderia duplicar.
 */
export async function sendHandoffAlert(
  integration: { apiUrl: string; token: string },
  config: Pick<HandoffAlertConfig, "number" | "groupJid">,
  text: string
): Promise<{ number: AlertChannelOutcome; group: AlertChannelOutcome }> {
  const send = async (to: string | null, channel: "number" | "group"): Promise<AlertChannelOutcome> => {
    if (!to) return "off";
    // O mesmo `trackId` nas duas tentativas: o eco de qualquer uma é descartado.
    const opts = { trackId: randomUUID() };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await sendUazapiNotice(integration.apiUrl, integration.token, to, text, opts);
        return "sent";
      } catch (error) {
        // Sem o corpo da resposta nem o destino: só o canal e o status.
        console.error("[handoff-alert] envio falhou", {
          channel,
          attempt,
          status: error instanceof UazapiHttpError ? error.status : null,
        });
        if (!uazapiSendDefinitelyFailed(error)) return "failed";
      }
    }
    return "failed";
  };

  const [number, group] = await Promise.all([
    send(config.number, "number"),
    send(config.groupJid, "group"),
  ]);
  return { number, group };
}

export type HandoffAlertInput = {
  conversationId: string;
  /** O telefone do contato (conversation_external_id). */
  phone: string;
  /** O ticket do handoff (o informado ou o em foco), ou null. */
  ticketId: string | null;
  reason: string;
  summary: string | null;
};

export async function notifyTeamOfHandoff(input: HandoffAlertInput): Promise<HandoffAlertResult> {
  try {
    if (!hasSupabaseAdminEnv()) return { skipped: true, reason: "not_configured" };
    const admin = createSupabaseAdminClient();
    const config = await readHandoffAlertConfig(admin);
    if (!config.number && !config.groupJid) return { skipped: true, reason: "not_configured" };

    const integration = await getUazapiIntegration(admin);
    if (!integration) return { skipped: true, reason: "no_whatsapp" };

    const [conversation, ticket] = await Promise.all([
      admin
        .from("chat_conversations")
        .select("contact_name, contacts(name)")
        .eq("id", input.conversationId)
        .maybeSingle(),
      input.ticketId
        ? admin.from("tickets").select("number").eq("id", input.ticketId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    // Sem o nome ou o número, o aviso sai mesmo assim: o telefone e o motivo bastam.
    const contactName = conversation.data?.contacts?.name ?? conversation.data?.contact_name ?? null;
    const ticketNumber = ticket.data?.number ?? null;

    const text = handoffAlertText({
      contactName,
      phone: input.phone,
      protocol: ticketNumber ? formatProtocol(ticketNumber) : null,
      reason: input.reason,
      summary: input.summary,
      link: ticketNumber
        ? appLink(`/app/tickets/${ticketNumber}`)
        : appLink(`/app/chat?conversation=${encodeURIComponent(input.conversationId)}`),
    });
    const sent = await sendHandoffAlert(integration, config, text);
    return { skipped: false, ...sent };
  } catch (error) {
    console.error("[handoff-alert] falhou", error instanceof Error ? error.name : "erro");
    return { skipped: true, reason: "error" };
  }
}

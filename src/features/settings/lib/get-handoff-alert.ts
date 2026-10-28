import type { SupabaseClient } from "@supabase/supabase-js";

import { isGroupJid } from "@/features/chat/lib/whatsapp-group";
import { ALERT_NUMBER_RE } from "@/features/settings/schemas/handoff-alert";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";

export type HandoffAlertConfig = {
  // Telefone que recebe o aviso (55 + DDD + número), ou null.
  number: string | null;
  // JID do grupo que recebe o aviso, ou null.
  groupJid: string | null;
  // Nome do grupo quando foi escolhido, só para a tela.
  groupName: string | null;
};

export const EMPTY_HANDOFF_ALERT: HandoffAlertConfig = { number: null, groupJid: null, groupName: null };

// `value` é jsonb livre: só conta o que passa na mesma regra do save.
export function handoffAlertFrom(value: Json | undefined): HandoffAlertConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_HANDOFF_ALERT;
  const number = typeof value.number === "string" && ALERT_NUMBER_RE.test(value.number) ? value.number : null;
  const groupJid = isGroupJid(typeof value.group_jid === "string" ? value.group_jid : null)
    ? (value.group_jid as string)
    : null;
  const groupName =
    groupJid && typeof value.group_name === "string" && value.group_name.trim()
      ? value.group_name.trim()
      : null;
  return { number, groupJid, groupName };
}

// Para quem envia o aviso (o handoff da API v1, o teste). LANÇA se a leitura
// falhar: quem chama decide (o aviso é melhor esforço).
export async function readHandoffAlertConfig(
  supabase: SupabaseClient<Database>
): Promise<HandoffAlertConfig> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "handoff_alert")
    .maybeSingle();
  if (error) throw new Error(`app_settings: ${error.message}`);
  return handoffAlertFrom(data?.value);
}

// Para a tela (Integrações › Agente de IA). Nunca lança: em falha, vazio.
export async function getHandoffAlertConfig(): Promise<HandoffAlertConfig> {
  if (!hasSupabaseServerEnv()) return EMPTY_HANDOFF_ALERT;
  try {
    return await readHandoffAlertConfig(createSupabaseServerClient());
  } catch (error) {
    console.error("getHandoffAlertConfig failed", error instanceof Error ? error.message : error);
    return EMPTY_HANDOFF_ALERT;
  }
}

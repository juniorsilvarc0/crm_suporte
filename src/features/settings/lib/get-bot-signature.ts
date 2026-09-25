import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

export type BotSignatureConfig = {
  // Assinar as mensagens respondidas pela IA?
  enabled: boolean;
  // Nome/apelido que assina (obrigatório quando enabled).
  apelido: string;
};

const EMPTY: BotSignatureConfig = { enabled: false, apelido: "" };

// Config da assinatura do bot, guardada em app_settings.key = 'bot_signature'.
// O agente recebe isto por push a cada save (a leitura por GET volta na API v1,
// Fase 5) e aplica o prefixo no envio — o CRM não dispara as mensagens do bot,
// só é a fonte de verdade da config. Nunca lança: em qualquer falha devolve o
// default (desligado).
export async function getBotSignatureConfig(): Promise<BotSignatureConfig> {
  if (!hasSupabaseServerEnv()) return EMPTY;
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "bot_signature")
      .maybeSingle();
    if (error) {
      console.error("getBotSignatureConfig failed", error.message);
      return EMPTY;
    }
    const value = (data?.value ?? {}) as { enabled?: boolean; apelido?: string };
    return {
      enabled: Boolean(value.enabled),
      apelido: value.apelido?.trim() ?? "",
    };
  } catch (error) {
    console.error("getBotSignatureConfig threw", error);
    return EMPTY;
  }
}

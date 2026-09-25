import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

export type FunnelSettings = {
  // Exibir probabilidade (%) e situação (Aberto/Ganho/Perdido) das etapas no funil.
  showStageMeta: boolean;
};

const DEFAULT: FunnelSettings = { showStageMeta: false };

export async function getFunnelSettings(): Promise<FunnelSettings> {
  if (!hasSupabaseServerEnv()) return DEFAULT;
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "funnel")
      .maybeSingle();
    if (error) {
      console.error("getFunnelSettings failed", error.message);
      return DEFAULT;
    }
    const value = (data?.value ?? {}) as { showStageMeta?: boolean };
    return { showStageMeta: value.showStageMeta === true };
  } catch (error) {
    console.error("getFunnelSettings threw", error);
    return DEFAULT;
  }
}

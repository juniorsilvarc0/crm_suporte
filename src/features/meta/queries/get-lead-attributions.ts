import type { LeadAttribution } from "@/features/meta/lead-attribution";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

// `.in()` com lista gigante estoura o tamanho da URL do PostgREST.
const CHUNK = 200;

function toAttribution(row: {
  lead_id: string;
  source_id: string | null;
  source_type: "ad" | "post" | "unknown";
  message_at: string;
  ad_name_snapshot: string | null;
  adset_name_snapshot: string | null;
  campaign_id_snapshot: string | null;
  campaign_name_snapshot: string | null;
  enriched_at: string | null;
}): LeadAttribution {
  return {
    leadId: row.lead_id,
    campaignId: row.campaign_id_snapshot,
    campaignName: row.campaign_name_snapshot,
    adsetName: row.adset_name_snapshot,
    adName: row.ad_name_snapshot,
    sourceId: row.source_id,
    sourceType: row.source_type,
    messageAt: row.message_at,
    enriched: Boolean(row.enriched_at),
  };
}

// Primeiro toque por lead: o clique que originou o contato. Cliques posteriores
// não trocam a campanha exibida — o card mostra de onde o lead veio, não a
// última campanha que ele tocou. Mesma regra do relatório de rastreamento.
export async function getLeadAttributions(
  leadIds: string[]
): Promise<Map<string, LeadAttribution>> {
  const result = new Map<string, LeadAttribution>();
  const unique = [...new Set(leadIds.filter(Boolean))];
  if (unique.length === 0 || !hasSupabaseServerEnv()) return result;

  try {
    const supabase = createSupabaseServerClient();

    for (let i = 0; i < unique.length; i += CHUNK) {
      const { data, error } = await supabase
        .from("meta_attributions")
        .select(
          "lead_id, source_id, source_type, message_at, ad_name_snapshot, adset_name_snapshot, campaign_id_snapshot, campaign_name_snapshot, enriched_at"
        )
        .in("lead_id", unique.slice(i, i + CHUNK))
        .order("message_at", { ascending: true });

      if (error) {
        console.error("getLeadAttributions failed", error.message);
        return result;
      }

      // Ordenado por message_at asc: o primeiro que chega para cada lead vence.
      for (const row of data ?? []) {
        if (result.has(row.lead_id)) continue;
        result.set(row.lead_id, toAttribution(row));
      }
    }

    return result;
  } catch (error) {
    console.error("getLeadAttributions threw", error);
    return result;
  }
}

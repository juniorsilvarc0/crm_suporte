// Tipo + rótulo da origem publicitária de um lead. Fica fora de queries/ porque
// os componentes de client importam daqui — arrastar o módulo de query traria o
// client Supabase de servidor para o bundle do browser.

// `campaignName` é null enquanto o enriquecimento não rodou: o worker preenche
// os snapshots no ciclo seguinte à chegada do clique.
export type LeadAttribution = {
  leadId: string;
  campaignId: string | null;
  campaignName: string | null;
  adsetName: string | null;
  adName: string | null;
  sourceId: string | null;
  sourceType: "ad" | "post" | "unknown";
  messageAt: string;
  enriched: boolean;
};

export function attributionCampaignLabel(attribution: LeadAttribution): string {
  return attribution.campaignName ?? "Campanha não identificada";
}

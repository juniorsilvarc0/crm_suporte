import {
  buildStagePositionIndex,
  furthestStagePosition,
  resolveFunnelStages,
  type FunnelColumn,
  type FunnelStageDefinition,
} from "@/features/meta/funnel";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type MetaReportFilters = {
  from: string;
  to: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
};

export type MetaAttributionForReport = {
  id: string;
  lead_id: string;
  source_id: string | null;
  had_ctwa_clid: boolean;
  message_at: string;
  ad_id_snapshot: string | null;
  ad_name_snapshot: string | null;
  adset_id_snapshot: string | null;
  adset_name_snapshot: string | null;
  campaign_id_snapshot: string | null;
  campaign_name_snapshot: string | null;
};

type LeadOutcome = {
  leadId: string;
  name: string | null;
  phone: string | null;
  status: string;
  stages: Set<string>;
  agendadoAt: string | null;
  compareceuAt: string | null;
  clienteAt: string | null;
};

// Identidade do lead por trás do número da campanha. Sem isto o relatório só
// responde "quantos"; com isto responde "quem". `ctwa_clid` continua fora de
// propósito (META-LEAD-TRACKING §Privacidade) — só o booleano de cobertura sai.
export type MetaCampaignLead = {
  leadId: string;
  name: string | null;
  phone: string | null;
  status: string;
  firstTouchAt: string;
  adName: string | null;
  hasClickId: boolean;
  scheduled: boolean;
  attended: boolean;
  patient: boolean;
};

export type MetaCampaignReportRow = {
  campaignId: string;
  campaignName: string;
  nameVariants: string[];
  contacts: number;
  scheduled: number;
  attended: number;
  patients: number;
  covered: number;
  coveragePercent: number;
  leads: MetaCampaignLead[];
};

/**
 * Um lead da coorte reduzido ao que o funil e o cruzamento com o investimento
 * precisam: de qual anúncio veio e até onde chegou.
 *
 * Vive aqui, e não numa segunda consulta, porque a coorte já é montada neste
 * arquivo com o recorte de data e os filtros de campanha/conjunto/anúncio
 * aplicados. Refazer isso do lado do funil seria duas verdades para a mesma
 * pergunta.
 */
export type MetaCohortLead = {
  leadId: string;
  adId: string | null;
  adName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  /** ISO do primeiro toque. Alimenta a série diária de contatos. */
  firstTouchAt: string;
  /** Posição mais avançada alcançada no board; `-1` sem etapa conhecida. */
  furthestPosition: number;
  scheduled: boolean;
  patient: boolean;
};

export type MetaFilterOption = { value: string; label: string };

/**
 * Opções dos seletores de campanha, conjunto e anúncio.
 *
 * ⚠️ **Saem do período, não do filtro aplicado.** Escolher uma campanha não pode
 * fazer as outras sumirem da própria lista de opções — é a mesma regra de
 * `buildTipoFilterOptions` na agenda. Antes disso aqui, filtrar exigia colar o
 * ID numérico da campanha à mão.
 */
export type MetaFilterOptions = {
  campaigns: MetaFilterOption[];
  adsets: MetaFilterOption[];
  ads: MetaFilterOption[];
};

export type MetaTrackingReport = {
  filters: MetaReportFilters;
  totals: Omit<
    MetaCampaignReportRow,
    "campaignId" | "campaignName" | "nameVariants" | "leads"
  >;
  campaigns: MetaCampaignReportRow[];
  cohort: MetaCohortLead[];
  /** Etapas do funil derivadas do board. Vazio quando o board não veio. */
  funnelStages: FunnelStageDefinition[];
  /** Leads da coorte cuja etapa atual é uma coluna de perda. */
  lost: number;
  options: MetaFilterOptions;
};

/**
 * O primeiro toque do lead, guardado uma vez e reusado pelas duas saídas.
 *
 * Conjunto e campanha entram aqui porque a tabela de custos agrupa por nível, e
 * refazer esse mapeamento do lado de lá seria uma segunda verdade para a mesma
 * pergunta — a coorte já sai daqui com data, filtro e desfecho aplicados.
 */
type FirstTouch = {
  at: string;
  adId: string | null;
  adName: string | null;
  adsetId: string | null;
  adsetName: string | null;
};

function sortOptions(entries: Map<string, string>): MetaFilterOption[] {
  return [...entries.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

function dateBounds(filters: MetaReportFilters) {
  return {
    start: new Date(`${filters.from}T00:00:00-03:00`).getTime(),
    endExclusive: new Date(`${filters.to}T00:00:00-03:00`).getTime() + 86_400_000,
  };
}

function emptyTotals() {
  return {
    contacts: 0,
    scheduled: 0,
    attended: 0,
    patients: 0,
    covered: 0,
    coveragePercent: 0,
  };
}

export function buildMetaTrackingReport(
  attributions: MetaAttributionForReport[],
  outcomes: LeadOutcome[],
  filters: MetaReportFilters,
  stages: { qualified: string; attended: string; patient: string },
  columns: readonly FunnelColumn[] = []
): MetaTrackingReport {
  const ordered = [...attributions].sort(
    (a, b) =>
      new Date(a.message_at).getTime() - new Date(b.message_at).getTime() ||
      a.id.localeCompare(b.id)
  );
  const touchesByLead = new Map<string, MetaAttributionForReport[]>();
  for (const attribution of ordered) {
    const current = touchesByLead.get(attribution.lead_id) ?? [];
    current.push(attribution);
    touchesByLead.set(attribution.lead_id, current);
  }

  const outcomesByLead = new Map(outcomes.map((outcome) => [outcome.leadId, outcome]));
  const { start, endExclusive } = dateBounds(filters);
  const groups = new Map<
    string,
    {
      latestName: string;
      latestAt: number;
      variants: Set<string>;
      leads: string[];
      covered: Set<string>;
      firstTouch: Map<string, FirstTouch>;
    }
  >();

  const campaignOptions = new Map<string, string>();
  const adsetOptions = new Map<string, string>();
  const adOptions = new Map<string, string>();

  for (const [leadId, touches] of touchesByLead) {
    const first = touches[0];
    const firstAt = new Date(first.message_at).getTime();
    if (firstAt < start || firstAt >= endExclusive) continue;

    // Opções antes dos filtros de propósito: escolher uma campanha não pode
    // esvaziar a lista de campanhas.
    if (first.campaign_id_snapshot) {
      campaignOptions.set(
        first.campaign_id_snapshot,
        first.campaign_name_snapshot ?? first.campaign_id_snapshot
      );
    }
    if (first.adset_id_snapshot) {
      adsetOptions.set(
        first.adset_id_snapshot,
        first.adset_name_snapshot ?? first.adset_id_snapshot
      );
    }
    if (first.ad_id_snapshot) {
      adOptions.set(first.ad_id_snapshot, first.ad_name_snapshot ?? first.ad_id_snapshot);
    }

    if (filters.campaignId && first.campaign_id_snapshot !== filters.campaignId) continue;
    if (filters.adsetId && first.adset_id_snapshot !== filters.adsetId) continue;
    if (filters.adId && first.ad_id_snapshot !== filters.adId) continue;

    const campaignId = first.campaign_id_snapshot ?? first.source_id ?? "unknown";
    const campaignName = first.campaign_name_snapshot ?? "Campanha não identificada";
    const group = groups.get(campaignId) ?? {
      latestName: campaignName,
      latestAt: firstAt,
      variants: new Set<string>(),
      leads: [],
      covered: new Set<string>(),
      firstTouch: new Map<string, FirstTouch>(),
    };
    group.leads.push(leadId);
    group.firstTouch.set(leadId, {
      at: first.message_at,
      adId: first.ad_id_snapshot,
      adName: first.ad_name_snapshot,
      adsetId: first.adset_id_snapshot,
      adsetName: first.adset_name_snapshot,
    });
    group.variants.add(campaignName);
    if (firstAt >= group.latestAt) {
      group.latestAt = firstAt;
      group.latestName = campaignName;
    }
    if (touches.some((touch) => touch.had_ctwa_clid)) group.covered.add(leadId);
    groups.set(campaignId, group);
  }

  // Índice de posição e etapas do funil saem da configuração do board. Sem
  // board (chamada legada de teste), a coorte ainda existe — só não tem funil.
  const positionByStage = buildStagePositionIndex(columns);
  const funnelStages = resolveFunnelStages(columns);
  const lostKeys = new Set(
    columns.filter((column) => column.stage_type === "lost").map((column) => column.key)
  );
  const cohort: MetaCohortLead[] = [];
  let lost = 0;

  const campaigns = [...groups.entries()].map(([campaignId, group]) => {
    const metrics = emptyTotals();
    const uniqueLeads = [...new Set(group.leads)];
    metrics.contacts = uniqueLeads.length;
    metrics.covered = group.covered.size;
    const leads: MetaCampaignLead[] = [];

    for (const leadId of uniqueLeads) {
      const outcome = outcomesByLead.get(leadId);
      const touch = group.firstTouch.get(leadId);

      // Histórico de deal + etapa atual + marcos legados do lead. Os três
      // juntos porque nenhum sozinho cobre a verdade toda: o histórico começou
      // depois de leads existentes, e a etapa atual não lembra por onde passou.
      const reached = new Set(outcome?.stages ?? []);
      if (outcome?.status) reached.add(outcome.status);
      if (outcome?.agendadoAt) reached.add(stages.qualified);
      if (outcome?.compareceuAt) reached.add(stages.attended);
      if (outcome?.clienteAt) reached.add(stages.patient);
      if (outcome?.status && lostKeys.has(outcome.status)) lost += 1;
      const scheduled = Boolean(
        outcome && (outcome.stages.has(stages.qualified) || outcome.agendadoAt)
      );
      const attended = Boolean(
        outcome && (outcome.stages.has(stages.attended) || outcome.compareceuAt)
      );
      const patient = Boolean(
        outcome && (outcome.stages.has(stages.patient) || outcome.clienteAt)
      );
      cohort.push({
        leadId,
        adId: touch?.adId ?? null,
        adName: touch?.adName ?? null,
        adsetId: touch?.adsetId ?? null,
        adsetName: touch?.adsetName ?? null,
        // A mesma identidade que a tabela de campanhas usa: quando o snapshot
        // não trouxe `campaign_id`, o grupo cai em `source_id` ou "unknown" e o
        // rótulo já é "Campanha não identificada". Duas chaves para a mesma
        // campanha fariam a soma dos custos divergir da soma dos contatos.
        campaignId,
        campaignName: group.latestName,
        firstTouchAt: touch?.at ?? "",
        furthestPosition: furthestStagePosition(reached, positionByStage),
        scheduled,
        patient,
      });
      if (scheduled) metrics.scheduled += 1;
      if (attended) metrics.attended += 1;
      if (patient) metrics.patients += 1;

      leads.push({
        leadId,
        name: outcome?.name ?? null,
        phone: outcome?.phone ?? null,
        status: outcome?.status ?? "novo",
        firstTouchAt: touch?.at ?? "",
        adName: touch?.adName ?? null,
        hasClickId: group.covered.has(leadId),
        scheduled,
        attended,
        patient,
      });
    }

    // Mais recente primeiro: é a ordem em que o operador espera achar quem
    // acabou de entrar pela campanha.
    leads.sort((a, b) => b.firstTouchAt.localeCompare(a.firstTouchAt));

    metrics.coveragePercent = metrics.contacts
      ? Math.round((metrics.covered / metrics.contacts) * 10_000) / 100
      : 0;

    return {
      campaignId,
      campaignName: group.latestName,
      nameVariants: [...group.variants].filter((name) => name !== group.latestName).sort(),
      ...metrics,
      leads,
    };
  });

  campaigns.sort((a, b) => b.contacts - a.contacts || a.campaignName.localeCompare(b.campaignName));
  const totals = campaigns.reduce((sum, row) => {
    sum.contacts += row.contacts;
    sum.scheduled += row.scheduled;
    sum.attended += row.attended;
    sum.patients += row.patients;
    sum.covered += row.covered;
    return sum;
  }, emptyTotals());
  totals.coveragePercent = totals.contacts
    ? Math.round((totals.covered / totals.contacts) * 10_000) / 100
    : 0;

  return {
    filters,
    totals,
    campaigns,
    cohort,
    funnelStages,
    lost,
    options: {
      campaigns: sortOptions(campaignOptions),
      adsets: sortOptions(adsetOptions),
      ads: sortOptions(adOptions),
    },
  };
}

async function fetchAttributions(): Promise<MetaAttributionForReport[]> {
  const supabase = createSupabaseAdminClient();
  const rows: MetaAttributionForReport[] = [];
  const pageSize = 1_000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("meta_attributions")
      .select(
        "id, lead_id, source_id, had_ctwa_clid, message_at, ad_id_snapshot, ad_name_snapshot, adset_id_snapshot, adset_name_snapshot, campaign_id_snapshot, campaign_name_snapshot"
      )
      .order("message_at")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error("meta_report_attributions_failed");
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function chunks<T>(values: T[], size = 400): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function getMetaTrackingReport(filters: MetaReportFilters) {
  const supabase = createSupabaseAdminClient();
  const attributions = await fetchAttributions();
  const leadIds = [...new Set(attributions.map((row) => row.lead_id))];
  const outcomes = new Map<string, LeadOutcome>();

  for (const ids of chunks(leadIds)) {
    const [{ data: leads, error: leadError }, { data: history, error: historyError }] =
      await Promise.all([
        supabase
          .from("leads")
          .select("id, name, phone, status, agendado_at, compareceu_at, cliente_at")
          .in("id", ids),
        supabase.from("deal_stage_history").select("lead_id, to_stage").in("lead_id", ids),
      ]);
    if (leadError || historyError) throw new Error("meta_report_outcomes_failed");

    for (const lead of leads ?? []) {
      outcomes.set(lead.id, {
        leadId: lead.id,
        name: lead.name,
        phone: lead.phone,
        status: lead.status,
        stages: new Set<string>(),
        agendadoAt: lead.agendado_at,
        compareceuAt: lead.compareceu_at,
        clienteAt: lead.cliente_at,
      });
    }
    for (const row of history ?? []) {
      const outcome = outcomes.get(row.lead_id);
      if (outcome) outcome.stages.add(row.to_stage);
    }
  }

  const [{ data: settings, error: settingsError }, { data: columns, error: columnsError }] =
    await Promise.all([
      supabase.from("app_settings").select("value").eq("key", "meta_tracking").maybeSingle(),
      supabase
        .from("board_columns")
        .select("key, label, position, stage_type, counts_as_conversion")
        .order("position"),
    ]);
  if (settingsError) throw new Error("meta_report_settings_failed");
  // Board ausente degrada o funil, não o relatório: campanhas e CSV seguem.
  if (columnsError) console.error("meta_report_columns_failed", columnsError.message);
  const value = settings?.value;
  const object = value && !Array.isArray(value) && typeof value === "object" ? value : {};

  return buildMetaTrackingReport(
    attributions,
    [...outcomes.values()],
    filters,
    {
      qualified: typeof object.qualifiedStageKey === "string" ? object.qualifiedStageKey : "agendado",
      attended: typeof object.attendedStageKey === "string" ? object.attendedStageKey : "compareceu",
      patient: typeof object.patientStageKey === "string" ? object.patientStageKey : "cliente",
    },
    columns ?? []
  );
}

export function metaReportToCsv(report: MetaTrackingReport): string {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const header = [
    "campaign_id",
    "campaign_name",
    "historical_name_variants",
    "new_meta_contacts",
    "already_scheduled",
    "already_attended",
    "already_patients",
    "coverage_percent",
  ];
  const rows = report.campaigns.map((row) =>
    [
      row.campaignId,
      row.campaignName,
      row.nameVariants.join(" | "),
      row.contacts,
      row.scheduled,
      row.attended,
      row.patients,
      row.coveragePercent,
    ]
      .map(escape)
      .join(",")
  );
  return [header.map(escape).join(","), ...rows].join("\n");
}

export async function getRecentMetaDeadLetters() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("meta_conversion_outbox")
    .select("id, event_name, attempt_count, last_error_category, updated_at")
    .eq("status", "dead_letter")
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) throw new Error("meta_dead_letters_failed");
  return data ?? [];
}

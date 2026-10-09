import type { MetricRange } from "@/features/metrics/lib/period";
import { summarizeSupportMetrics } from "@/features/metrics/lib/summarize";
import type { CreatedTicketRow, ResolvedTicketRow, SupportMetricsResult } from "@/features/metrics/types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

// Teto de linhas por leitura. As contagens vêm do `count` (exatas); medianas,
// IA e gráfico saem das linhas lidas — passou do teto, a tela avisa "amostra".
export const METRIC_ROW_CAP = 10_000;

// "Em aberto" = nem encerrado (fechado/cancelado) nem resolvido. O SLA
// estourado é o da view `ticket_queue`, calculado na leitura (o mesmo selo da
// lista de tickets).
const OPEN_STATUS_EXCLUDED = "resolvido";

/**
 * As métricas de suporte de uma janela, numa ida ao banco (5 leituras em
 * paralelo, service role). Qualquer falha devolve `failed` (logado): a tela
 * diz "não foi possível carregar", nunca mostra zero no lugar de erro.
 */
export async function getSupportMetrics(range: MetricRange): Promise<SupportMetricsResult> {
  if (!hasSupabaseAdminEnv()) return { failed: true, range };
  try {
    const supabase = createSupabaseAdminClient();
    const [created, resolved, openNow, breachedNow, reopened] = await Promise.all([
      supabase
        .from("tickets")
        .select("created_at, source, first_responded_at", { count: "exact" })
        .gte("created_at", range.startIso)
        .lt("created_at", range.endIso)
        .order("created_at", { ascending: true })
        .limit(METRIC_ROW_CAP),
      supabase
        .from("tickets")
        .select("created_at, resolved_at", { count: "exact" })
        .gte("resolved_at", range.startIso)
        .lt("resolved_at", range.endIso)
        .order("resolved_at", { ascending: true })
        .limit(METRIC_ROW_CAP),
      supabase
        .from("ticket_queue")
        .select("id", { count: "exact", head: true })
        .eq("is_terminal", false)
        .neq("status", OPEN_STATUS_EXCLUDED),
      supabase
        .from("ticket_queue")
        .select("id", { count: "exact", head: true })
        .eq("is_terminal", false)
        .neq("status", OPEN_STATUS_EXCLUDED)
        .eq("sla_breached", true),
      // Reabrir = sair de "resolvido" para atendimento; ir de "resolvido" para
      // fechado/cancelado é encerrar, não reabrir.
      supabase
        .from("ticket_status_history")
        .select("id", { count: "exact", head: true })
        .eq("from_status", "resolvido")
        .not("to_status", "in", "(fechado,cancelado)")
        .gte("occurred_at", range.startIso)
        .lt("occurred_at", range.endIso),
    ]);

    const failure = [created, resolved, openNow, breachedNow, reopened].find((result) => result.error);
    if (failure?.error) {
      console.error("[metrics] getSupportMetrics", failure.error.code, failure.error.message);
      return { failed: true, range };
    }

    const createdRows = (created.data ?? []) as CreatedTicketRow[];
    const resolvedRows = (resolved.data ?? []).flatMap((row): ResolvedTicketRow[] =>
      row.resolved_at ? [{ created_at: row.created_at, resolved_at: row.resolved_at }] : []
    );

    return {
      failed: false,
      range,
      ...summarizeSupportMetrics(
        {
          created: createdRows,
          createdTotal: created.count ?? createdRows.length,
          resolved: resolvedRows,
          resolvedTotal: resolved.count ?? resolvedRows.length,
          openNow: openNow.count ?? 0,
          breachedNow: breachedNow.count ?? 0,
          reopened: reopened.count ?? 0,
        },
        range
      ),
    };
  } catch (error) {
    console.error("[metrics] getSupportMetrics lançou", error);
    return { failed: true, range };
  }
}

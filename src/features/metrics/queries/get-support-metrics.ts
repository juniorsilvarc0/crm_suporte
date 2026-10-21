import type { MetricRange } from "@/features/metrics/lib/period";
import { summarizeSupportMetrics, topCustomerIds, type MetricNames } from "@/features/metrics/lib/summarize";
import type {
  CreatedTicketRow,
  OpenTicketRow,
  ResolvedTicketRow,
  SupportMetricsResult,
} from "@/features/metrics/types";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

// Teto de linhas por leitura. As contagens vêm do `count` (exatas); medianas,
// IA e gráfico saem das linhas lidas — passou do teto, a tela avisa "amostra".
export const METRIC_ROW_CAP = 10_000;

// "Em aberto" = nem encerrado (fechado/cancelado) nem resolvido. O SLA
// estourado é o da view `ticket_queue`, calculado na leitura (o mesmo selo da
// lista de tickets).
const OPEN_STATUS_EXCLUDED = "resolvido";

// As etiquetas vêm junto de cada ticket (embed pela FK de ticket_tags): uma
// leitura só, sem lista de ids na URL.
const TAGS_EMBED = "ticket_tags(tag_id)";

type TagEmbed = { ticket_tags: Array<{ tag_id: string }> };

function withTagIds<Row extends TagEmbed>({ ticket_tags, ...row }: Row): Omit<Row, "ticket_tags"> & { tag_ids: string[] } {
  return { ...row, tag_ids: ticket_tags.map(({ tag_id }) => tag_id) };
}

// "Mãe › Filha" na subcategoria, como no detalhe do ticket; arquivadas
// inclusive (o ticket guarda a categoria que tinha).
function categoryNames(rows: Array<{ id: string; name: string; parent_id: string | null }>): Record<string, string> {
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  return Object.fromEntries(
    rows.map((row) => {
      const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
      return [row.id, parent ? `${parent} › ${row.name}` : row.name];
    })
  );
}

/**
 * As métricas de suporte de uma janela: 5 leituras em paralelo e, depois de
 * agregar, os nomes dos recortes (service role). Qualquer falha devolve
 * `failed` (logado): a tela diz "não foi possível carregar", nunca mostra zero
 * no lugar de erro.
 */
export async function getSupportMetrics(range: MetricRange): Promise<SupportMetricsResult> {
  if (!hasSupabaseAdminEnv()) return { failed: true, range };
  try {
    const supabase = createSupabaseAdminClient();
    const [created, resolved, openNow, breachedNow, reopened] = await Promise.all([
      supabase
        .from("tickets")
        .select(
          `created_at, source, first_responded_at, first_ai_response_at, product_id, customer_id, assigned_to_user_id, category_id, ${TAGS_EMBED}`,
          { count: "exact" }
        )
        .gte("created_at", range.startIso)
        .lt("created_at", range.endIso)
        .order("created_at", { ascending: true })
        .limit(METRIC_ROW_CAP),
      supabase
        .from("tickets")
        .select(
          `created_at, resolved_at, first_responded_at, product_id, customer_id, assigned_to_user_id, category_id, ${TAGS_EMBED}`,
          { count: "exact" }
        )
        .gte("resolved_at", range.startIso)
        .lt("resolved_at", range.endIso)
        .order("resolved_at", { ascending: true })
        .limit(METRIC_ROW_CAP),
      // Em aberto: as linhas servem aos recortes; o total é o `count` exato.
      supabase
        .from("ticket_queue")
        .select(`product_id, customer_id, assigned_to_user_id, category_id, ${TAGS_EMBED}`, { count: "exact" })
        .eq("is_terminal", false)
        .neq("status", OPEN_STATUS_EXCLUDED)
        .limit(METRIC_ROW_CAP),
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

    const createdRows = (created.data ?? []).map(withTagIds) as CreatedTicketRow[];
    const resolvedRows = (resolved.data ?? []).flatMap((row): ResolvedTicketRow[] =>
      row.resolved_at ? [{ ...withTagIds(row), resolved_at: row.resolved_at }] : []
    );
    const openRows = (openNow.data ?? []).map(withTagIds) as OpenTicketRow[];

    // Os nomes, só depois de agregar: filas, equipe, categorias e etiquetas são
    // poucas (lidas inteiras); dos clientes, só os do ranking.
    const topIds = topCustomerIds({ created: createdRows, resolved: resolvedRows, open: openRows });
    const [products, users, categories, tags, customers] = await Promise.all([
      supabase.from("products").select("id, name"),
      supabase.from("app_users").select("id, name"),
      supabase.from("ticket_categories").select("id, name, parent_id"),
      supabase.from("tags").select("id, name"),
      topIds.length > 0
        ? supabase.from("customers").select("id, legal_name, trade_name").in("id", topIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const namesFailure = [products, users, categories, tags, customers].find((result) => result.error);
    if (namesFailure?.error) {
      console.error("[metrics] getSupportMetrics (nomes)", namesFailure.error.code, namesFailure.error.message);
      return { failed: true, range };
    }
    const names: MetricNames = {
      products: Object.fromEntries((products.data ?? []).map((row) => [row.id, row.name])),
      users: Object.fromEntries((users.data ?? []).map((row) => [row.id, row.name])),
      customers: Object.fromEntries((customers.data ?? []).map((row) => [row.id, customerDisplayName(row)])),
      categories: categoryNames(categories.data ?? []),
      tags: Object.fromEntries((tags.data ?? []).map((row) => [row.id, row.name])),
    };

    return {
      failed: false,
      range,
      ...summarizeSupportMetrics(
        {
          created: createdRows,
          createdTotal: created.count ?? createdRows.length,
          resolved: resolvedRows,
          resolvedTotal: resolved.count ?? resolvedRows.length,
          open: openRows,
          openNow: openNow.count ?? openRows.length,
          breachedNow: breachedNow.count ?? 0,
          reopened: reopened.count ?? 0,
        },
        range,
        names
      ),
    };
  } catch (error) {
    console.error("[metrics] getSupportMetrics lançou", error);
    return { failed: true, range };
  }
}

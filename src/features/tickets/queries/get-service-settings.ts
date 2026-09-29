import type { ProductOption } from "@/features/products/types";
import { isSlaMode } from "@/features/tickets/lib/sla-mode";
import { isTicketPriority } from "@/features/tickets/lib/ticket-priority";
import { isTicketStatus } from "@/features/tickets/lib/ticket-status";
import type {
  ServiceSettings,
  TicketCategoryOption,
  TicketSlaPolicy,
  TicketStatusOption,
} from "@/features/tickets/types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

type ReadResult<Row> = { data: Row[] | null; error: { message: string } | null };

/**
 * Converte uma parte linha a linha (molde de get-ticket-catalog). `null`
 * (logado) quando a leitura falhou OU quando alguma linha não fecha com o
 * tipo: a tela diz que a parte falhou em vez de esconder um status.
 */
function mapPart<Row, Item>(
  part: string,
  result: ReadResult<Row>,
  toItem: (row: Row) => Item | null
): Item[] | null {
  if (result.error) {
    console.error(`getServiceSettings ${part} failed`, result.error.message);
    return null;
  }
  const items: Item[] = [];
  for (const row of result.data ?? []) {
    const item = toItem(row);
    if (!item) {
      console.error(`getServiceSettings ${part}: linha inesperada`);
      return null;
    }
    items.push(item);
  }
  return items;
}

/**
 * O que /app/configuracoes/atendimento edita: filas, categorias, SLA por
 * prioridade e status. Ao contrário do catálogo (getTicketCatalog), filas e
 * categorias vêm TODAS, arquivadas inclusive: é aqui que se reativa. As filas
 * saem ativas primeiro e, em cada grupo, por nome; as categorias, por nome
 * (a tela agrupa por fila e mãe).
 *
 * Leitura resiliente por parte: cada uma é `null` quando falha, nunca `[]`, e
 * a tela diz "não foi possível carregar" só naquela aba.
 */
export async function getServiceSettings(): Promise<ServiceSettings> {
  const unavailable: ServiceSettings = {
    products: null,
    categories: null,
    policies: null,
    statuses: null,
  };
  if (!hasSupabaseAdminEnv()) return unavailable;

  try {
    const supabase = createSupabaseAdminClient();
    const [productsRes, categoriesRes, policiesRes, statusesRes] = await Promise.all([
      supabase
        .from("products")
        .select("id, name, niche, color, archived_at")
        .order("name", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("ticket_categories")
        .select("id, name, product_id, parent_id, archived_at")
        .order("name", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("sla_policies")
        .select("priority, rank, first_response_minutes, resolution_minutes, warn_pct")
        .order("rank", { ascending: true }),
      supabase
        .from("ticket_statuses")
        .select("key, label, color, position, sla_mode, is_terminal")
        .order("position", { ascending: true }),
    ]);

    // O nome ordena no banco; aqui só as ativas passam à frente, sem mexer na
    // ordem dentro de cada grupo.
    const byName = mapPart("products", productsRes, (row): ProductOption => ({
      id: row.id,
      name: row.name,
      niche: row.niche,
      color: row.color,
      archived_at: row.archived_at,
    }));
    const products = byName && [
      ...byName.filter((product) => product.archived_at === null),
      ...byName.filter((product) => product.archived_at !== null),
    ];

    const categories = mapPart("categories", categoriesRes, (row): TicketCategoryOption => ({
      id: row.id,
      name: row.name,
      product_id: row.product_id,
      parent_id: row.parent_id,
      archived_at: row.archived_at,
    }));

    const policies = mapPart("policies", policiesRes, (row): TicketSlaPolicy | null =>
      isTicketPriority(row.priority)
        ? {
            priority: row.priority,
            rank: row.rank,
            first_response_minutes: row.first_response_minutes,
            resolution_minutes: row.resolution_minutes,
            warn_pct: row.warn_pct,
          }
        : null
    );

    const statuses = mapPart("statuses", statusesRes, (row): TicketStatusOption | null =>
      isTicketStatus(row.key) && isSlaMode(row.sla_mode)
        ? {
            key: row.key,
            label: row.label,
            color: row.color,
            position: row.position,
            sla_mode: row.sla_mode,
            is_terminal: row.is_terminal,
          }
        : null
    );

    return { products, categories, policies, statuses };
  } catch (error) {
    console.error("getServiceSettings threw", error);
    return unavailable;
  }
}

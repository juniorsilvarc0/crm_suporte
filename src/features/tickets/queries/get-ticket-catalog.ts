import { getProducts } from "@/features/products/queries/get-products";
import type { ProductOption } from "@/features/products/types";
import { isTicketPriority } from "@/features/tickets/lib/ticket-priority";
import { isTicketStatus, TICKET_STATUS_KEYS } from "@/features/tickets/lib/ticket-status";
import type {
  SlaMode,
  TicketCatalog,
  TicketCategoryOption,
  TicketSlaPolicy,
  TicketStatusOption,
  TicketTransition,
} from "@/features/tickets/types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

// 2º uso do guard (o 1º é get-tickets-page): duplicado de propósito (AGENTS §0.2.2).
const SLA_MODES = ["running", "paused", "stopped"] as const satisfies readonly SlaMode[];

function isSlaMode(value: unknown): value is SlaMode {
  return SLA_MODES.some((mode) => mode === value);
}

type ReadResult<Row> = { data: Row[] | null; error: { message: string } | null };

/**
 * Converte uma parte do catálogo linha a linha. `null` (logado) quando a
 * leitura falhou OU quando alguma linha não fecha com o tipo: a parte inteira
 * falha em vez de sumir com um status ou uma prioridade.
 */
function mapPart<Row, Item>(
  part: string,
  result: ReadResult<Row>,
  toItem: (row: Row) => Item | null
): Item[] | null {
  if (result.error) {
    console.error(`getTicketCatalog ${part} failed`, result.error.message);
    return null;
  }
  const items: Item[] = [];
  for (const row of result.data ?? []) {
    const item = toItem(row);
    if (!item) {
      console.error(`getTicketCatalog ${part}: linha inesperada`);
      return null;
    }
    items.push(item);
  }
  return items;
}

const statusPosition = (key: string) => TICKET_STATUS_KEYS.findIndex((status) => status === key);

/**
 * As categorias que o catálogo oferece: a consulta só corta a própria
 * categoria arquivada, então aqui sai a da fila arquivada (fora de `products`,
 * que só traz as ativas) e a subcategoria cuja mãe não ficou (arquivada ou
 * cortada pela fila): a filha sozinha não faz sentido no "Novo ticket".
 *
 * Sem as filas (`products` null), a parte inteira é `null`: não dá para saber
 * qual fila está ativa. Devolver todas ofereceria categoria de fila arquivada;
 * devolver só as gerais esconderia as da fila e pareceria a lista completa.
 */
function offeredCategories(
  categories: TicketCategoryOption[] | null,
  products: ProductOption[] | null
): TicketCategoryOption[] | null {
  if (!categories) return null;
  if (!products) {
    console.error("getTicketCatalog categories: filas indisponíveis, sem como conferir a fila");
    return null;
  }
  const activeProducts = new Set(products.map((product) => product.id));
  const inActiveQueue = categories.filter(
    (category) => category.product_id === null || activeProducts.has(category.product_id)
  );
  const offered = new Set(inActiveQueue.map((category) => category.id));
  return inActiveQueue.filter(
    (category) => category.parent_id === null || offered.has(category.parent_id)
  );
}

/**
 * O catálogo dos tickets: status (rótulo e cor do admin), a matriz de
 * transições, as prioridades com os minutos de SLA, as filas e as categorias
 * ATIVAS (categoria geral ou de fila ativa, com a mãe também oferecida).
 * Arquivada só aparece no ticket que já a tinha.
 *
 * Leitura resiliente por parte: cada uma é `null` quando falha, nunca `[]` —
 * vazio seria "não há status", e a tela cai nos rótulos de recurso
 * (lib/ticket-status.ts) ou diz "não foi possível carregar".
 */
export async function getTicketCatalog(): Promise<TicketCatalog> {
  const unavailable: TicketCatalog = {
    statuses: null,
    transitions: null,
    priorities: null,
    products: null,
    categories: null,
  };
  if (!hasSupabaseAdminEnv()) return unavailable;

  try {
    const supabase = createSupabaseAdminClient();
    const [statusesRes, transitionsRes, prioritiesRes, products, categoriesRes] =
      await Promise.all([
        supabase
          .from("ticket_statuses")
          .select("key, label, color, position, sla_mode, is_terminal")
          .order("position", { ascending: true }),
        supabase.from("ticket_status_transitions").select("from_status, to_status"),
        supabase
          .from("sla_policies")
          .select("priority, rank, first_response_minutes, resolution_minutes, warn_pct")
          .order("rank", { ascending: true }),
        getProducts(),
        supabase
          .from("ticket_categories")
          .select("id, name, product_id, parent_id, archived_at")
          .is("archived_at", null)
          .order("name", { ascending: true })
          .order("id", { ascending: true }),
      ]);

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

    // Na ordem de `position` da origem e do destino: "De Novo só vai para
    // Em triagem, Em atendimento…" sai na ordem das colunas do quadro.
    const transitions = mapPart("transitions", transitionsRes, (row): TicketTransition | null =>
      isTicketStatus(row.from_status) && isTicketStatus(row.to_status)
        ? { from_status: row.from_status, to_status: row.to_status }
        : null
    );
    transitions?.sort(
      (a, b) =>
        statusPosition(a.from_status) - statusPosition(b.from_status) ||
        statusPosition(a.to_status) - statusPosition(b.to_status)
    );

    const priorities = mapPart("priorities", prioritiesRes, (row): TicketSlaPolicy | null =>
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

    const categories = offeredCategories(
      mapPart("categories", categoriesRes, (row) => ({
        id: row.id,
        name: row.name,
        product_id: row.product_id,
        parent_id: row.parent_id,
        archived_at: row.archived_at,
      })),
      products
    );

    return { statuses, transitions, priorities, products, categories };
  } catch (error) {
    console.error("getTicketCatalog threw", error);
    return unavailable;
  }
}

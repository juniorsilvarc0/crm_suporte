import {
  buildListQuery,
  orderByDue,
  toTicketListItems,
} from "@/features/tickets/queries/get-tickets-page";
import type { TicketListParams, TicketsBoard } from "@/features/tickets/types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

// Teto do quadro: os tickets ATIVOS de uma casa de suporte cabem de sobra aqui.
// Se um dia passar, a tela avisa (capped) em vez de esconder em silêncio.
const BOARD_MAX = 500;

/**
 * Os tickets do Quadro (/app/tickets/quadro): só os ATIVOS (status "ativos" =
 * `sla_mode != stopped` = as colunas não-terminais), sem paginação, para a tela
 * agrupar por coluna. Respeita os MESMOS filtros da lista (prioridade, fila,
 * responsável, SLA, busca) — menos o status, que o quadro força em "ativos"
 * porque as colunas SÃO os status.
 *
 * Leitura resiliente (AGENTS §4): erro devolve `items: null` (marcado), não
 * lista vazia. Ordenado por prazo, como a lista e o Início.
 */
export async function getTicketsBoard(
  params: TicketListParams,
  viewerId: string
): Promise<TicketsBoard> {
  const fetchedAt = new Date().toISOString();
  const failed: TicketsBoard = { items: null, capped: false, fetchedAt };

  if (!hasSupabaseAdminEnv()) return failed;

  try {
    const supabase = createSupabaseAdminClient();
    // Força "ativos": o quadro é a pilha de trabalho; terminais (resolvido,
    // fechado, cancelado) saem do quadro ao mover (não há coluna para eles).
    const query = buildListQuery(supabase, { ...params, status: "ativos" }, viewerId, false);
    // `limit + 1` só para saber se bateu no teto.
    const { data, error } = await orderByDue(query).limit(BOARD_MAX + 1);
    if (error) {
      console.error("getTicketsBoard failed", error.message);
      return failed;
    }

    const rows = data ?? [];
    const capped = rows.length > BOARD_MAX;
    const items = toTicketListItems(capped ? rows.slice(0, BOARD_MAX) : rows, "getTicketsBoard");
    if (!items) return failed;

    return { items, capped, fetchedAt };
  } catch (error) {
    console.error("getTicketsBoard threw", error);
    return failed;
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";

import { TICKET_LIST_SELECT, toTicketListItem } from "@/features/tickets/queries/get-tickets-page";
import { toApiTicketDetail, type ApiTicketDetail } from "@/lib/api/v1/tickets";
import type { Database } from "@/lib/supabase/types";

// O ticket inteiro como a API v1 o entrega (GET /tickets/{ref} e o retorno das
// escritas, relido depois da RPC). A categoria vem pelo embed com hint pela FK,
// arquivada inclusive, como no detalhe da tela.
const TICKET_API_SELECT =
  `${TICKET_LIST_SELECT}, description, category:ticket_categories!tickets_category_id_fkey(id, name)` as const;

export type TicketRef = { id: string } | { number: number };

/**
 * `null` = não existe. LANÇA em erro de leitura e em linha fora do tipo: quem
 * chama responde 503, nunca "não encontrado".
 */
export async function getApiTicket(
  supabase: SupabaseClient<Database>,
  ref: TicketRef,
  now: Date = new Date()
): Promise<ApiTicketDetail | null> {
  const query = supabase.from("ticket_queue").select(TICKET_API_SELECT);
  const { data, error } = await ("id" in ref ? query.eq("id", ref.id) : query.eq("number", ref.number)).maybeSingle();
  if (error) throw new Error(`ticket_queue: ${error.message}`);
  if (!data) return null;

  const item = toTicketListItem(data);
  if (!item) throw new Error(`ticket_queue: linha inesperada ${data.id}`);
  return toApiTicketDetail(item, { description: data.description, category: data.category }, now);
}

/**
 * O id do ticket pelo `{ref}` da rota: o uuid como veio, ou o do protocolo.
 * `null` = protocolo que não existe. LANÇA em erro de leitura.
 */
export async function resolveTicketId(supabase: SupabaseClient<Database>, ref: TicketRef): Promise<string | null> {
  if ("id" in ref) return ref.id;
  const { data, error } = await supabase.from("tickets").select("id").eq("number", ref.number).maybeSingle();
  if (error) throw new Error(`tickets: ${error.message}`);
  return data?.id ?? null;
}

/**
 * O id do ticket CONFERINDO que existe (por id ou protocolo), para as rotas
 * que não passam por RPC (timeline, anexo). `null` = não existe. LANÇA em erro.
 */
export async function findTicketId(supabase: SupabaseClient<Database>, ref: TicketRef): Promise<string | null> {
  const query = supabase.from("tickets").select("id");
  const { data, error } = await ("id" in ref ? query.eq("id", ref.id) : query.eq("number", ref.number)).maybeSingle();
  if (error) throw new Error(`tickets: ${error.message}`);
  return data?.id ?? null;
}

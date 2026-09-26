import { isContractStatus } from "@/features/contracts/lib/contract-status";
import {
  TICKET_LIST_SELECT,
  toTicketListItem,
  type TicketListRow,
} from "@/features/tickets/queries/get-tickets-page";
import type {
  TicketAttachment,
  TicketContractRef,
  TicketDetail,
} from "@/features/tickets/types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

// As colunas da lista mais o que só o detalhe usa. description entra (é o
// detalhe); ai_triage, idempotency_key e external_id nem estão na view.
// ⚠️ Colunas SEMPRE explícitas em support_contracts: o service_role não lê
// monthly_amount, e um embed support_contracts(*) falha com 42501. Hint pelo
// nome da FK: quem abriu é a 2ª relação de tickets com app_users (PGRST201).
// A categoria vem pelo embed (arquivada inclusive: o catálogo só tem as
// ativas), e da conversa só o foco, para o "Responder no WhatsApp".
const TICKET_DETAIL_SELECT =
  `${TICKET_LIST_SELECT}, description, contact_id, customer_id, contract_id, product_id, category_id, assigned_to_user_id, first_ai_response_at, contract:support_contracts!tickets_contract_id_fkey(id, status, starts_on, ends_on), creator:app_users!tickets_created_by_user_id_fkey(id, name), category:ticket_categories!tickets_category_id_fkey(id, name, archived_at), conversation:chat_conversations!tickets_conversation_id_fkey(active_ticket_id)` as const;

// Nunca bucket, object_key nem sha256: o arquivo sai pela rota do anexo.
const ATTACHMENT_SELECT =
  "id, file_name, mime, size_bytes, uploaded_by_user_id, uploaded_by_token_id, created_at";
const MAX_ATTACHMENTS = 100;

type TicketDetailRow = TicketListRow & {
  description: string | null;
  contact_id: string | null;
  customer_id: string | null;
  contract_id: string | null;
  product_id: string | null;
  category_id: string | null;
  assigned_to_user_id: string | null;
  first_ai_response_at: string | null;
  contract: { id: string; status: string; starts_on: string; ends_on: string | null } | null;
  creator: { id: string; name: string } | null;
  category: { id: string; name: string; archived_at: string | null } | null;
  conversation: { active_ticket_id: string | null } | null;
};

/**
 * `attachments` = `null` quando AQUELA leitura falhou: a tela diz "não foi
 * possível carregar", nunca "sem anexos". A timeline é outra leitura
 * (getTicketTimeline), que a página faz com o `ticket.id`. `fetchedAt` (ISO)
 * inicializa o relógio do selo de SLA.
 */
export type TicketDetailResult =
  | {
      status: "ok";
      ticket: TicketDetail;
      attachments: TicketAttachment[] | null;
      fetchedAt: string;
    }
  | { status: "not_found" }
  | { status: "error" };

// Campo a campo, como toTicketListItem (o spread é do item que ele já montou).
// `null` = linha que o banco não deveria produzir (contact_id é NOT NULL; a
// situação do contrato tem check).
function toTicketDetail(row: TicketDetailRow): TicketDetail | null {
  const item = toTicketListItem(row);
  if (!item || row.contact_id === null) return null;

  let contract: TicketContractRef | null = null;
  if (row.contract) {
    if (!isContractStatus(row.contract.status)) return null;
    contract = {
      id: row.contract.id,
      status: row.contract.status,
      starts_on: row.contract.starts_on,
      ends_on: row.contract.ends_on,
    };
  }

  return {
    ...item,
    description: row.description,
    contact_id: row.contact_id,
    customer_id: row.customer_id,
    contract_id: row.contract_id,
    product_id: row.product_id,
    category_id: row.category_id,
    assigned_to_user_id: row.assigned_to_user_id,
    first_ai_response_at: row.first_ai_response_at,
    contract,
    creator: row.creator ? { id: row.creator.id, name: row.creator.name } : null,
    category: row.category
      ? { id: row.category.id, name: row.category.name, archived_at: row.category.archived_at }
      : null,
    in_focus: row.conversation?.active_ticket_id === item.id,
  };
}

/**
 * Ticket pelo protocolo (tickets.number, o número da URL /app/tickets/[number]),
 * terminal inclusive (o histórico continua existindo).
 *
 * Só a leitura do ticket decide not_found/error. A dos anexos depende do id e
 * corre depois; se falhar, vira `null` NAQUELA seção, e o detalhe abre.
 */
export async function getTicketDetail(number: number): Promise<TicketDetailResult> {
  if (!Number.isSafeInteger(number) || number < 1) return { status: "not_found" };
  if (!hasSupabaseAdminEnv()) return { status: "error" };

  try {
    const supabase = createSupabaseAdminClient();
    const fetchedAt = new Date().toISOString();

    const { data, error } = await supabase
      .from("ticket_queue")
      .select(TICKET_DETAIL_SELECT)
      .eq("number", number)
      .maybeSingle();

    if (error) {
      console.error("getTicketDetail failed", error.message);
      return { status: "error" };
    }
    if (!data) return { status: "not_found" };

    const ticket = toTicketDetail(data);
    if (!ticket) {
      console.error("getTicketDetail: linha inesperada", data.id);
      return { status: "error" };
    }

    const attachmentsRes = await supabase
      .from("ticket_attachments")
      .select(ATTACHMENT_SELECT)
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_ATTACHMENTS);

    let attachments: TicketAttachment[] | null = null;
    if (attachmentsRes.error) {
      console.error("getTicketDetail attachments failed", attachmentsRes.error.message);
    } else {
      attachments = (attachmentsRes.data ?? []).map((attachment) => ({
        id: attachment.id,
        file_name: attachment.file_name,
        mime: attachment.mime,
        size_bytes: attachment.size_bytes,
        uploaded_by_user_id: attachment.uploaded_by_user_id,
        uploaded_by_token_id: attachment.uploaded_by_token_id,
        created_at: attachment.created_at,
      }));
    }

    return { status: "ok", ticket, attachments, fetchedAt };
  } catch (error) {
    console.error("getTicketDetail threw", error);
    return { status: "error" };
  }
}

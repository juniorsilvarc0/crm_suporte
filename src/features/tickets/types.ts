import type {
  MessageDeliveryStatus,
  MessageDirection,
  MessageType,
} from "@/features/chat/types";
import type { ContractView } from "@/features/contracts/types";
import type { CustomerSummary } from "@/features/customers/types";
import type { ProductOption } from "@/features/products/types";
import type { AppUser } from "@/features/settings/types";
import type { TicketPriority } from "@/features/tickets/lib/ticket-priority";
import type { TicketStatusKey } from "@/features/tickets/lib/ticket-status";

export type { TicketPriority } from "@/features/tickets/lib/ticket-priority";
export type { TicketStatusKey } from "@/features/tickets/lib/ticket-status";

// ⚠️ Escritos à mão, NUNCA derivados do Row de tickets: o Row traz ai_triage,
// idempotency_key, external_id e created_by_token_id, que não saem do servidor
// (nem o conversation_external_id que as RPCs devolvem para o push à IA).
// Nomes das colunas como o banco e o PostgREST entregam. Instantes são o ISO
// cru do PostgREST (microssegundos e fuso): não passam por Date para comparar
// ordem (emenda 2 da Fase 4). Neutro: a rota, a query e o client importam.

// ticket_statuses.sla_mode: `paused` = aguardando cliente; `stopped` = resolvido,
// fechado e cancelado.
export type SlaMode = "running" | "paused" | "stopped";

// Quem abriu (tickets.source): tela = `agent`; integração = `ai` ou `api`.
export type TicketSource = "ai" | "agent" | "api";

// actor_type da trilha (ticket_status_history, ticket_events). A trilha não tem
// FK de ator: um actor_user_id sem nome na lista de usuários é "Usuário removido".
export type TicketActorType = "agent" | "ai" | "api" | "system";

// chat_messages.sender_type (check chat_messages_sender_type_check). `device` =
// o celular da empresa, fora do CRM.
export type TicketMessageSender = "contact" | "agent" | "ai" | "system" | "device";

// O jsonb de public.ticket_summary, que toda RPC de ticket devolve em `ticket`.
// O serviço confere com zod antes de repassar.
export type TicketSummary = {
  id: string;
  number: number;
  title: string;
  status: TicketStatusKey;
  priority: TicketPriority;
  version: number;
  conversation_id: string;
  assigned_to_user_id: string | null;
  product_id: string | null;
  category_id: string | null;
  customer_id: string | null;
  contract_id: string | null;
  first_response_due_at: string;
  resolution_due_at: string;
  first_responded_at: string | null;
  sla_paused_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  updated_at: string;
};

// O que lib/sla.ts lê: as mesmas colunas que a view ticket_queue usa na regra
// do SLA (snapshot de minutos e aviso, prazos, carimbos e o modo do status).
export type TicketSlaFields = {
  status: TicketStatusKey;
  sla_mode: SlaMode;
  sla_first_response_minutes: number;
  sla_resolution_minutes: number;
  sla_warn_pct: number;
  first_response_due_at: string;
  resolution_due_at: string;
  first_responded_at: string | null;
  sla_paused_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
};

// Embeds da ticket_queue (colunas explícitas, com hint onde há duas relações).
export type TicketCustomerRef = Pick<
  CustomerSummary,
  "id" | "legal_name" | "trade_name" | "contract_status"
>;
export type TicketContactRef = { id: string; name: string | null; phone: string };
export type TicketProductRef = Pick<ProductOption, "id" | "name" | "color">;
export type TicketUserRef = Pick<AppUser, "id" | "name" | "avatar_color" | "avatar_url">;
export type TicketContractRef = Pick<ContractView, "id" | "status" | "starts_on" | "ends_on">;

// Linha da lista, do quadro e do Início (ticket_queue). Sem description: a
// lista não a mostra. `contact` nunca é nulo (contact_id NOT NULL, FK restrict).
// `next_due_at` nulo = relógio parado; `last_inbound_at` > `resolved_at` é o
// "Respondeu após resolver".
export type TicketListItem = TicketSlaFields & {
  id: string;
  number: number;
  title: string;
  priority: TicketPriority;
  version: number;
  source: TicketSource;
  conversation_id: string;
  is_terminal: boolean;
  reopened_count: number;
  next_due_at: string | null;
  last_inbound_at: string | null;
  created_at: string;
  updated_at: string;
  customer: TicketCustomerRef | null;
  contact: TicketContactRef;
  product: TicketProductRef | null;
  assignee: TicketUserRef | null;
};

// Página /app/tickets/[number]: a linha da lista mais o que só o detalhe usa
// (descrição, ids editáveis do PATCH, contrato e quem abriu). `creator` nulo =
// aberto por integração ou por usuário já removido (`source` diz qual).
export type TicketDetail = TicketListItem & {
  description: string | null;
  contact_id: string;
  customer_id: string | null;
  contract_id: string | null;
  product_id: string | null;
  category_id: string | null;
  assigned_to_user_id: string | null;
  first_ai_response_at: string | null;
  contract: TicketContractRef | null;
  creator: { id: string; name: string } | null;
};

// Comentário interno do ticket. Apagado não guarda texto: `body` nulo ⇔
// `deleted_at` preenchido (check ticket_comments_body_check). Sem autor = usuário
// removido (FK set null); `author_token_id` = escrito por integração.
export type TicketComment = {
  id: string;
  author_user_id: string | null;
  author_token_id: string | null;
  body: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

// Anexo do ticket. Nunca leva bucket nem object_key: o arquivo sai por
// /api/tickets/<id>/attachments/<attachmentId> (sessão + URL assinada curta).
export type TicketAttachment = {
  id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  uploaded_by_user_id: string | null;
  uploaded_by_token_id: string | null;
  created_at: string;
};

// Timeline do detalhe: união discriminada por `kind`. `at` é o instante que
// ordena (occurred_at da trilha, created_at do resto), cru do PostgREST. Na
// mesma transação a trilha grava tudo com o MESMO occurred_at: a ordem entre
// status e evento é `seq` (sequência comum às duas tabelas), nunca o id.
export type TimelineStatusItem = {
  kind: "status";
  id: string;
  at: string;
  seq: number;
  from_status: TicketStatusKey | null;
  to_status: TicketStatusKey;
  actor_type: TicketActorType;
  actor_user_id: string | null;
  reason: string | null;
};

// `event_type` segue o padrão ticket.<nome> (não é lista fechada: a Fase 6
// acrescenta tipos), e `metadata` é o objeto que a RPC gravou.
export type TimelineEventItem = {
  kind: "event";
  id: string;
  at: string;
  seq: number;
  event_type: string;
  actor_type: TicketActorType;
  actor_user_id: string | null;
  metadata: Record<string, unknown>;
};

export type TimelineCommentItem = Omit<TicketComment, "created_at"> & {
  kind: "comment";
  at: string;
};

// Mensagem do WhatsApp carimbada com o ticket (chat_messages.ticket_id), em
// versão compacta: `type: "note"` é a "Nota no chat". `file_name` vem de
// metadata->>fileName.
export type TimelineMessageItem = {
  kind: "message";
  id: string;
  at: string;
  direction: MessageDirection;
  sender_type: TicketMessageSender;
  type: MessageType;
  content: string | null;
  file_name: string | null;
  delivery_status: MessageDeliveryStatus;
  sent_by_user_id: string | null;
  is_deleted: boolean;
};

export type TimelineAttachmentItem = Omit<TicketAttachment, "created_at"> & {
  kind: "attachment";
  at: string;
};

export type TimelineItem =
  | TimelineStatusItem
  | TimelineEventItem
  | TimelineCommentItem
  | TimelineMessageItem
  | TimelineAttachmentItem;

export type TimelineItemKind = TimelineItem["kind"];

// Uma página da timeline (getTicketTimeline e GET /api/tickets/[id]/timeline):
// `items` do mais novo para o mais antigo; `nextBefore` é o `before` da página
// seguinte (o instante do item mais antigo, cru), nulo quando `hasMore` é falso.
export type TicketTimelinePage = {
  items: TimelineItem[];
  hasMore: boolean;
  nextBefore: string | null;
};

// Catálogo (getTicketCatalog e GET /api/tickets/catalog). Cada parte é `null`
// quando a leitura dela falhou, nunca `[]`: vazio seria "não há status", e a
// tela cai nos rótulos de recurso (lib/ticket-status.ts).
export type TicketStatusOption = {
  key: TicketStatusKey;
  label: string;
  // Nome da paleta (features/tags/schemas/colors.ts); a tela confere com isColorName.
  color: string;
  position: number;
  sla_mode: SlaMode;
  is_terminal: boolean;
};

// Um par da matriz (ticket_status_transitions). É a única fonte de "para onde
// vai": lib/state-machine.ts não tem matriz própria.
export type TicketTransition = {
  from_status: TicketStatusKey;
  to_status: TicketStatusKey;
};

// sla_policies: minutos e aviso valem para tickets abertos daqui em diante (o
// ticket guarda o snapshot). O rótulo da prioridade é fixo (lib/ticket-priority.ts).
export type TicketSlaPolicy = {
  priority: TicketPriority;
  rank: number;
  first_response_minutes: number;
  resolution_minutes: number;
  warn_pct: number;
};

// Categoria: 2 níveis (parent_id), da fila (`product_id`) ou geral (nulo).
export type TicketCategoryOption = {
  id: string;
  name: string;
  product_id: string | null;
  parent_id: string | null;
  archived_at: string | null;
};

export type TicketCatalog = {
  statuses: TicketStatusOption[] | null;
  transitions: TicketTransition[] | null;
  priorities: TicketSlaPolicy[] | null;
  products: ProductOption[] | null;
  categories: TicketCategoryOption[] | null;
};

// Campo marcado em `errors` quando o erro é de um input das rotas de ticket
// (corpo de POST /api/tickets, PATCH, transition, assign e active-ticket).
export type TicketErrorField =
  | "conversation_id"
  | "title"
  | "description"
  | "priority"
  | "product_id"
  | "category_id"
  | "customer_id"
  | "assignee_id"
  | "ticket_id"
  | "to"
  | "reason"
  | "version"
  | "idempotency_key";

// Erro de negócio do serviço de tickets (map-ticket-error). `message` é
// amigável e nunca repassa error.message do banco. Extras por código:
// invalid_transition → `allowed` e `current`; version_conflict →
// `currentVersion` (a rota responde `current_version`; a API v1, 412);
// already_assigned → `assignedToUserId` (a rota busca o nome).
export type TicketError = {
  status: 400 | 403 | 404 | 409 | 422 | 500;
  code: string;
  message: string;
  field?: TicketErrorField;
  allowed?: TicketStatusKey[];
  current?: TicketStatusKey;
  currentVersion?: number;
  assignedToUserId?: string;
};

export type TicketResult<T> = { ok: true; data: T } | { ok: false; error: TicketError };

// O que cada função de server/ticket-service.ts devolve em `data`: é o corpo de
// sucesso da rota. Moram aqui para a tela ler sem importar o serviço (servidor).
export type CreateTicketData = {
  ticket: TicketSummary;
  // false = replay da mesma idempotency_key: a rota responde 200 em vez de 201.
  created: boolean;
  linked_messages: number;
};

export type TicketChangeData = { ticket: TicketSummary; changed: boolean };

export type TransitionTicketData = {
  ticket: TicketSummary;
  from: TicketStatusKey;
  to: TicketStatusKey;
  changed: boolean;
};

export type ActiveTicketData = { active_ticket_id: string | null; changed: boolean };

export type TakeOverTicketData = {
  ticket: TicketSummary;
  conversation: { id: string; status: "human" };
};

// Corpo de erro de negócio das rotas de ticket (ticketErrorBody), como a tela o
// lê. `errors` marca o campo do input; os extras só vêm no `code` que os tem.
// O 400 do zod na rota tem o mesmo `errors`, mas sem `code`.
export type TicketErrorBody = {
  ok: false;
  code: string;
  message: string;
  errors?: Partial<Record<TicketErrorField, string[]>>;
  allowed?: TicketStatusKey[];
  current?: TicketStatusKey;
  current_version?: number;
  assigned_to_user_id?: string;
};

// O 409 `already_assigned` de POST /api/tickets/[id]/take-over: o corpo de erro
// mais o nome de quem está com o ticket ("SUP-1024 está com Ana"). Sem o nome
// quando a leitura dele falhou: a tela cai num texto sem nome.
export type TicketTakeOverErrorBody = TicketErrorBody & { assigned_to_name?: string };

// Campo marcado em `errors` pelas rotas de catálogo (4f, admin): os formulários
// de fila, categoria, SLA e status. À parte de TicketErrorField, que é o dos
// inputs do ticket.
export type TicketCatalogErrorField =
  | "name"
  | "niche"
  | "color"
  | "archived"
  | "product_id"
  | "parent_id"
  | "label"
  | "first_response_minutes"
  | "resolution_minutes"
  | "warn_pct";

// Erro de negócio das rotas de catálogo (mapCatalogError): status, `code` e
// mensagem do mapa de tickets, com o campo do catálogo e sem os extras do
// ticket (allowed, versão, responsável), que um catálogo nunca tem.
export type TicketCatalogError = Pick<TicketError, "status" | "code" | "message"> & {
  field?: TicketCatalogErrorField;
};

// Corpo de erro das rotas de catálogo, como a tela o lê. `item` só no 409
// `duplicate`: o registro ativo que já tem o nome ou o rótulo (molde de POST
// /api/products); ausente quando a releitura dele falhou. O 400 do zod tem o
// mesmo `errors`, mas sem `code`.
export type TicketCatalogErrorBody<Item> = {
  ok: false;
  code: string;
  message: string;
  errors?: Partial<Record<TicketCatalogErrorField, string[]>>;
  item?: Item;
};

// Filtros da lista /app/tickets, lidos da URL por parseTicketListParams. Valor
// fora da allowlist vira o padrão em vez de erro (link velho ou editado à mão
// abre a lista padrão), e nada da URL é interpolado no filtro do PostgREST.
// ?status= aceita um grupo ou uma das chaves de TICKET_STATUS_KEYS. "ativos" é o
// padrão e fica fora da URL: relógio não parado (sla_mode <> stopped).
export const TICKET_LIST_STATUS_GROUPS = ["ativos", "resolvidos", "encerrados", "todos"] as const;

export type TicketListStatusGroup = (typeof TICKET_LIST_STATUS_GROUPS)[number];
export type TicketListStatusFilter = TicketListStatusGroup | TicketStatusKey;

// ?sla=: estourado = sla_breached; risco = sla_at_risk; pausado = sla_mode paused
// (as colunas da view ticket_queue, calculadas com o now() do banco).
export const TICKET_LIST_SLA_FILTERS = ["estourado", "risco", "pausado"] as const;

export type TicketListSlaFilter = (typeof TICKET_LIST_SLA_FILTERS)[number];

// ?ordem=: "prazo" (padrão) = o que vence antes, relógio parado no fim.
export const TICKET_LIST_ORDERS = ["prazo", "recentes", "atualizados"] as const;

export type TicketListOrder = (typeof TICKET_LIST_ORDERS)[number];

export type TicketListParams = {
  q: string;
  status: TicketListStatusFilter;
  prioridade: TicketPriority | null;
  // uuid da fila (products.id) ou "sem" (ticket sem fila). null = todas.
  fila: string | null;
  // "eu", "nenhum" ou o uuid de um usuário. null = todos.
  responsavel: string | null;
  sla: TicketListSlaFilter | null;
  ordem: TicketListOrder;
  page: number;
};

// `failed` = a leitura deu erro: a tela diz "não foi possível carregar", nunca
// "nenhum ticket". `fetchedAt` (ISO) é o instante da leitura, que inicializa o
// relógio da tela: o texto do SLA sai igual no servidor e na hidratação.
export type TicketsPage = {
  items: TicketListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  failed: boolean;
  fetchedAt: string;
};

// Uma seção do Início (getTicketQueue): até 8 itens, e `total` para o
// "Ver todos (N)". `failed` isola a falha na seção.
export type TicketQueueSection = {
  items: TicketListItem[];
  total: number;
  failed: boolean;
};

export type TicketQueue = {
  mine: TicketQueueSection;
  unassigned: TicketQueueSection;
  fetchedAt: string;
};

// GET /api/tickets?conversation_id=: os tickets NÃO terminais da conversa
// (resolvido entra) e o ticket em foco, que é sempre um deles (o foco sai
// quando o ticket termina, invariante 5 da migration).
export type ConversationTickets = {
  active_ticket_id: string | null;
  tickets: TicketListItem[];
};

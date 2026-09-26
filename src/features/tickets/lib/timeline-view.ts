import { ticketStatusLabel } from "@/features/tickets/lib/ticket-actions";
import { isTicketPriority, TICKET_PRIORITY_LABEL } from "@/features/tickets/lib/ticket-priority";
import { compareTimelineItems, isTimelineInstant } from "@/features/tickets/lib/ticket-timeline";
import type {
  TicketActorType,
  TicketCatalog,
  TicketComment,
  TicketMessageSender,
  TicketTimelinePage,
  TimelineCommentItem,
  TimelineEventItem,
  TimelineItem,
  TimelineMessageItem,
  TimelineStatusItem,
} from "@/features/tickets/types";

// Como a timeline do detalhe mostra cada item: a junção das páginas e os
// textos. Puro e neutro: o componente (client) importa. Nenhum texto vaza id
// cru — o que não tem nome conhecido vira uma frase genérica, nunca um uuid.

// O que a timeline lê do catálogo para dar nome a status, fila e categoria. O
// catálogo só traz as ATIVAS: fila ou categoria arquivada cai na frase genérica.
export type TimelineCatalog = Pick<TicketCatalog, "statuses" | "products" | "categories">;

/** Chave estável do item: status e evento vêm de tabelas diferentes. */
export function timelineItemKey(item: Pick<TimelineItem, "kind" | "id">): string {
  return `${item.kind}:${item.id}`;
}

/**
 * Junta o que a tela já tem com o que chegou (a página do servidor depois do
 * `router.refresh()`, uma página do "Carregar anteriores" ou o comentário que a
 * rota devolveu), sem duplicar, em ordem CRONOLÓGICA (o mais antigo primeiro).
 *
 * O que chegou vence: é a versão nova do comentário editado ou apagado. Nada
 * sai da lista (a timeline não perde item: comentário e mensagem apagados
 * continuam, como "apagado"). Item com instante fora do formato do PostgREST é
 * descartado em vez de derrubar a ordenação (compareTimelineItems lança).
 */
export function mergeTimelineItems(
  current: readonly TimelineItem[],
  incoming: readonly TimelineItem[]
): TimelineItem[] {
  const byKey = new Map<string, TimelineItem>();
  for (const item of [...current, ...incoming]) {
    if (!isTimelineInstant(item.at)) continue;
    byKey.set(timelineItemKey(item), item);
  }
  return [...byKey.values()].sort(compareTimelineItems);
}

/** O comentário que a rota devolve (POST, PATCH, DELETE) como item da timeline. */
export function commentToTimelineItem(comment: TicketComment): TimelineCommentItem {
  const { created_at, ...rest } = comment;
  return { ...rest, kind: "comment", at: created_at };
}

/**
 * Corpo de GET /api/tickets/[id]/timeline, conferido no formato. `null` =
 * resposta que não é uma página (erro, JSON estranho): a tela mostra a falha.
 */
export function readTimelinePage(body: unknown): TicketTimelinePage | null {
  if (typeof body !== "object" || body === null) return null;
  const { ok, items, hasMore, nextBefore } = body as Record<string, unknown>;
  if (ok !== true || !Array.isArray(items) || typeof hasMore !== "boolean") return null;
  if (nextBefore !== null && typeof nextBefore !== "string") return null;
  return { items: items as TimelineItem[], hasMore, nextBefore };
}

/**
 * Nomes da equipe para assinar a timeline. `loaded` = a lista veio: ela sempre
 * tem quem está vendo (usuário ativo). Sem ele, a leitura falhou, e um id sem
 * nome NÃO é "Usuário removido" — a timeline só não sabe o nome.
 */
export type TimelinePeople = {
  names: ReadonlyMap<string, string>;
  loaded: boolean;
  viewerId: string;
};

export function buildTimelinePeople(
  users: ReadonlyArray<{ id: string; name: string }>,
  viewerId: string
): TimelinePeople {
  const names = new Map(users.map((user) => [user.id, user.name]));
  return { names, loaded: names.has(viewerId), viewerId };
}

/**
 * Quem aparece na TRILHA (status e eventos). A trilha não tem FK de ator: o id
 * de quem foi excluído continua lá, e com a lista carregada ele é "Usuário
 * removido". Com a lista fora do ar, `null` (quem chama cai no genérico).
 */
export function trailUserLabel(id: string | null, people: TimelinePeople): string | null {
  if (!id) return null;
  if (id === people.viewerId) return "Você";
  const name = people.names.get(id);
  if (name) return name;
  return people.loaded ? "Usuário removido" : null;
}

const ACTOR_LABEL: Record<Exclude<TicketActorType, "agent">, string> = {
  ai: "IA",
  api: "Integração",
  system: "Automático",
};

/** Autor de uma linha da trilha: a pessoa, a IA, a integração ou o próprio sistema. */
export function trailActorLabel(
  item: Pick<TimelineStatusItem, "actor_type" | "actor_user_id">,
  people: TimelinePeople
): string {
  if (item.actor_type === "agent") return trailUserLabel(item.actor_user_id, people) ?? "Analista";
  return ACTOR_LABEL[item.actor_type];
}

/** "Status inicial: Novo" ou "Status: de Em atendimento para Resolvido". */
export function statusChangeText(
  item: Pick<TimelineStatusItem, "from_status" | "to_status">,
  statuses: TimelineCatalog["statuses"]
): string {
  const to = ticketStatusLabel(item.to_status, statuses);
  if (item.from_status === null) return `Status inicial: ${to}`;
  return `Status: de ${ticketStatusLabel(item.from_status, statuses)} para ${to}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// jsonb_strip_nulls tira as chaves nulas de `changes`: `to` ausente é "tirou".
function referenceChangeText(
  change: Record<string, unknown>,
  noun: "Fila" | "Categoria",
  options: ReadonlyArray<{ id: string; name: string }> | null | undefined
): string {
  const to = typeof change.to === "string" ? change.to : null;
  if (to === null) return `${noun} removida`;
  const name = options?.find((option) => option.id === to)?.name.trim();
  return name ? `${noun}: ${name}` : `${noun} alterada`;
}

// ticket.updated grava `changes` com o de/para de cada campo que mudou
// (ticket_update, migration 20260925120900). Empresa e contrato só dizem que
// mudaram: o nome da empresa não está na timeline, e o contrato acompanha a
// empresa (não vira linha à parte quando a empresa também mudou).
function updatedLines(raw: unknown, catalog: TimelineCatalog | null | undefined): string[] {
  const changes = asRecord(raw);
  if (!changes) return ["Dados do ticket alterados"];

  const lines: string[] = [];
  const title = asRecord(changes.title);
  if (title) {
    const to = typeof title.to === "string" ? title.to.trim() : "";
    lines.push(to ? `Título alterado para “${to}”` : "Título alterado");
  }
  if (changes.description !== undefined) lines.push("Descrição editada");

  const priority = asRecord(changes.priority);
  if (priority) {
    lines.push(
      isTicketPriority(priority.from) && isTicketPriority(priority.to)
        ? `Prioridade: de ${TICKET_PRIORITY_LABEL[priority.from]} para ${TICKET_PRIORITY_LABEL[priority.to]}`
        : "Prioridade alterada"
    );
  }

  const product = asRecord(changes.product_id);
  if (product) lines.push(referenceChangeText(product, "Fila", catalog?.products));
  const category = asRecord(changes.category_id);
  if (category) lines.push(referenceChangeText(category, "Categoria", catalog?.categories));

  const customer = asRecord(changes.customer_id);
  if (customer) {
    lines.push(
      customer.to == null
        ? "Empresa removida"
        : customer.from == null
          ? "Empresa definida"
          : "Empresa alterada"
    );
  }
  const contract = asRecord(changes.contract_id);
  if (contract && !customer) {
    lines.push(
      contract.to == null
        ? "Contrato desvinculado"
        : contract.from == null
          ? "Contrato vinculado"
          : "Contrato alterado"
    );
  }

  return lines.length > 0 ? lines : ["Dados do ticket alterados"];
}

/**
 * O texto de um evento da trilha, uma linha por fato. `event_type` não é lista
 * fechada (a Fase 6 acrescenta tipos): o desconhecido vira "Atividade
 * registrada", nunca a chave crua.
 */
export function eventLines(
  item: Pick<TimelineEventItem, "event_type" | "metadata">,
  people: TimelinePeople,
  catalog?: TimelineCatalog | null
): string[] {
  const meta = item.metadata;
  switch (item.event_type) {
    case "ticket.created":
      return ["Ticket aberto"];
    case "ticket.assigned": {
      if (meta.via === "take_over") return ["Assumiu o ticket"];
      const to = typeof meta.to === "string" ? meta.to : null;
      if (to === null) return ["Responsável removido"];
      const name = trailUserLabel(to, people);
      return [name ? `Responsável: ${name}` : "Responsável alterado"];
    }
    case "ticket.focused":
      return ["Ticket em foco na conversa"];
    case "ticket.unfocused":
      return [
        meta.reason === "terminal"
          ? "Saiu do foco da conversa ao ser encerrado"
          : "Saiu do foco da conversa",
      ];
    case "ticket.messages_linked": {
      const count =
        typeof meta.count === "number" && Number.isSafeInteger(meta.count) && meta.count > 0
          ? meta.count
          : null;
      if (count === null) return ["Mensagens da conversa vinculadas ao ticket"];
      return [
        count === 1
          ? "1 mensagem da conversa vinculada ao ticket"
          : `${count} mensagens da conversa vinculadas ao ticket`,
      ];
    }
    case "ticket.updated":
      return updatedLines(meta.changes, catalog);
    default:
      return ["Atividade registrada"];
  }
}

const SENDER_LABEL: Record<TicketMessageSender, string> = {
  contact: "Cliente",
  ai: "IA",
  agent: "Analista",
  device: "Celular da empresa",
  system: "Automático",
};

/** Remetente da mensagem do WhatsApp na timeline. */
export function messageSenderLabel(item: Pick<TimelineMessageItem, "sender_type">): string {
  return SENDER_LABEL[item.sender_type];
}

const MEDIA_LABEL: Partial<Record<TimelineMessageItem["type"], string>> = {
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
  contact: "Contato",
};

export type MessageSummary = {
  /** "Imagem", "Documento"… `null` = mensagem de texto (ou nota). */
  media: string | null;
  /** Texto, legenda ou nome do arquivo. `null` = nada a mostrar. */
  text: string | null;
  deleted: boolean;
};

/**
 * O resumo compacto da mensagem: o tipo da mídia e o texto que ela tem. O
 * vCard do contato não aparece cru; o documento mostra o nome do arquivo.
 */
export function messageSummary(
  item: Pick<TimelineMessageItem, "type" | "content" | "file_name" | "is_deleted">
): MessageSummary {
  if (item.is_deleted) return { media: null, text: null, deleted: true };
  const media = MEDIA_LABEL[item.type] ?? null;
  const content = item.content?.trim() || null;
  switch (item.type) {
    case "contact":
    case "audio":
    case "sticker":
      return { media, text: null, deleted: false };
    case "document":
      return { media, text: item.file_name?.trim() || null, deleted: false };
    default:
      return { media, text: content, deleted: false };
  }
}

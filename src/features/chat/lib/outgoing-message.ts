import type { ChatMessage } from "@/features/chat/types";

/**
 * Envio otimista de texto — a bolha antes da confirmação do servidor.
 *
 * O caminho de uma mensagem enviada por nós é:
 *
 *   bolha local (`local:<clientId>`, delivery_status `pending`)
 *     → linha do banco (a rota insere ANTES de chamar o provedor)
 *     → Realtime INSERT → reconcilia com a bolha local
 *     → Realtime UPDATE → ticks (`sent` → `delivered` → `read`)
 *
 * ⚠️ Como a rota insere a linha antes de falar com a uazapi, o INSERT do
 * Realtime chega quase sempre ANTES da resposta do `fetch`. Sem uma chave que
 * ligue as duas representações, a mesma mensagem apareceria duas vezes por um
 * segundo — e, pior, a bolha local ficaria de enfeite para sempre. Essa chave é
 * o `clientId`: nasce aqui, vai no corpo do POST, é gravado em
 * `metadata.clientId` e volta em todo evento daquela linha.
 *
 * Nada aqui inventa estado novo: `delivery_status` já modela
 * `pending → sent → delivered → read` e `failed`, e a bolha já sabe desenhar os
 * quatro. A mensagem otimista é só mais uma `pending` — que por acaso ainda não
 * existe no banco.
 */

/**
 * Prefixo do id local. Precisa ser reconhecível à vista porque é ele que separa
 * "mensagem que existe no banco" de "mensagem que só existe nesta aba": sem
 * `external_id` e sem id real, responder/encaminhar/apagar não têm o que citar.
 */
const LOCAL_ID_PREFIX = "local:";

/** Charset aceito pela rota — mantido restrito porque entra num filtro do PostgREST. */
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Identificador do envio. `randomUUID` exige contexto seguro (https/localhost);
 * o fallback existe para não derrubar o envio num ambiente sem ele — e produz o
 * mesmo charset que a rota valida.
 */
export function newClientId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function localMessageId(clientId: string): string {
  return `${LOCAL_ID_PREFIX}${clientId}`;
}

/** A mensagem ainda só existe nesta aba (não tem linha no banco). */
export function isOptimistic(message: Pick<ChatMessage, "id">): boolean {
  return message.id.startsWith(LOCAL_ID_PREFIX);
}

/**
 * O `clientId` da mensagem, venha ela da bolha local ou da linha do banco — nos
 * dois casos mora em `metadata.clientId`, que é o que torna a reconciliação
 * simétrica.
 */
export function readClientId(message: ChatMessage): string | null {
  const value = (message.metadata as { clientId?: unknown } | null)?.clientId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * A bolha que aparece no instante do Enter.
 *
 * `content` é o texto **exato que sairá para o contato** — com a assinatura do
 * operador, quando ela existe. Mostrar o texto cru e deixar a assinatura brotar
 * um segundo depois faria a bolha crescer sozinha na cara de quem enviou.
 */
export function createOptimisticMessage(input: {
  conversationId: string;
  clientId: string;
  content: string;
  quotedMessageId?: string | null;
  createdAt?: string;
}): ChatMessage {
  return {
    id: localMessageId(input.clientId),
    conversation_id: input.conversationId,
    external_id: null,
    direction: "outbound",
    type: "text",
    content: input.content,
    media_url: null,
    media_mime_type: null,
    quoted_message_id: input.quotedMessageId ?? null,
    delivery_status: "pending",
    sent_by_user_id: null,
    is_deleted: false,
    metadata: { clientId: input.clientId },
    created_at: input.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Insere ou atualiza uma mensagem na lista, **sem duplicar e sem reordenar**.
 *
 * Três chaves, nesta ordem: o id (caso normal), o `external_id` (o eco `fromMe`
 * do provedor volta com o mesmo id dele) e o `clientId` (a bolha otimista, que
 * ainda não tem nenhum dos dois). A troca é no LUGAR: uma mensagem confirmada
 * que pulasse para o fim da lista bagunçaria a ordem de dois envios seguidos
 * quando o segundo confirma primeiro.
 */
export function upsertMessage(
  list: readonly ChatMessage[],
  incoming: ChatMessage
): ChatMessage[] {
  const clientId = readClientId(incoming);
  const index = list.findIndex((current) => {
    if (current.id === incoming.id) return true;
    if (current.external_id && current.external_id === incoming.external_id) return true;
    return clientId !== null && readClientId(current) === clientId;
  });

  if (index < 0) return [...list, incoming];

  const next = [...list];
  next[index] = { ...next[index], ...incoming };
  return next;
}

/**
 * Muda o estado de UM envio, achado pelo `clientId`.
 *
 * É como a falha e o "tentar de novo" acontecem sem tocar em nenhuma outra
 * mensagem — o estado de envio pertence à mensagem, não à conversa.
 */
export function setSendStatus(
  list: ChatMessage[],
  clientId: string,
  status: "pending" | "failed"
): ChatMessage[] {
  let changed = false;
  const next = list.map((message) => {
    if (readClientId(message) !== clientId) return message;
    if (message.delivery_status === status) return message;
    changed = true;
    return { ...message, delivery_status: status };
  });
  // A MESMA lista quando nada mudou: é o que faz o React desistir do render em
  // vez de repintar a conversa inteira por um envio que não mexeu em nada.
  return changed ? next : list;
}

/**
 * Recarregar a janela (voltar do pulo da busca) não pode engolir um envio que
 * ainda está no ar: a lista vem do banco e a bolha local não está nela.
 *
 * Só sobrevive o que continua sem par — assim que a linha correspondente existe,
 * a bolha local sai de cena.
 */
export function keepUnconfirmed(
  fetched: ChatMessage[],
  previous: readonly ChatMessage[]
): ChatMessage[] {
  const optimistic = previous.filter(isOptimistic);
  if (optimistic.length === 0) return fetched;

  const confirmed = new Set(
    fetched.map(readClientId).filter((id): id is string => id !== null)
  );
  const orphans = optimistic.filter((message) => {
    const clientId = readClientId(message);
    return clientId !== null && !confirmed.has(clientId);
  });

  return orphans.length > 0 ? [...fetched, ...orphans] : fetched;
}

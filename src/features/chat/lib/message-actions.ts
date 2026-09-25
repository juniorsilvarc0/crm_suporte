import type { UazapiMediaType } from "@/features/chat/lib/senders/uazapi";
import type { ChatMessage } from "@/features/chat/types";

/**
 * Quem pode ser editado, apagado e encaminhado — num lugar só.
 *
 * A UI usa isto para decidir quais itens do menu existem; a rota usa o MESMO
 * predicado para recusar. Duplicar a regra nos dois lados é como se ganha um
 * item de menu que sempre dá erro, ou uma rota que aceita o que a tela proíbe.
 *
 * Funções puras de propósito: é o que dá para testar sem provedor nem banco.
 */

/**
 * Janela de edição do WhatsApp: 15 minutos a partir do envio. Não é limite
 * nosso nem da uazapi — é do próprio WhatsApp, e passado isso o provedor
 * recusa. Some do menu em vez de falhar.
 */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Máximo de conversas por encaminhamento — mesmo limite do WhatsApp. */
export const MAX_FORWARD_TARGETS = 5;

/** Tipos cujo conteúdo é texto editável (mensagem ou legenda). */
const EDITABLE_TYPES: ChatMessage["type"][] = ["text", "image", "video", "document"];

/** Tipos que sabemos reenviar como mídia. */
const FORWARDABLE_MEDIA: Partial<Record<ChatMessage["type"], UazapiMediaType>> = {
  image: "image",
  video: "video",
  audio: "ptt",
  document: "document",
  sticker: "sticker",
};

/**
 * Nota interna nunca vai ao WhatsApp, e mensagem apagada não tem o que mexer.
 * É o piso das três ações.
 */
function isActionable(message: ChatMessage): boolean {
  return message.type !== "note" && !message.is_deleted;
}

/** Nome do arquivo gravado no envio — `content` guarda a legenda. */
function fileNameOf(message: ChatMessage): string | undefined {
  const name = (message.metadata as { fileName?: unknown })?.fileName;
  return typeof name === "string" && name.trim() ? name : undefined;
}

/** A mensagem foi editada depois de enviada? */
export function wasEdited(message: ChatMessage): boolean {
  const at = (message.metadata as { editedAt?: unknown })?.editedAt;
  return typeof at === "string" && at.length > 0;
}

/**
 * A mensagem chegou aqui por encaminhamento?
 *
 * A rota de encaminhar grava `metadata.forwarded` desde que existe; faltava só
 * quem lesse. Aceita booleano e string porque `jsonb` volta do PostgREST com o
 * tipo que foi gravado, e provedor externo pode mandar `"true"` como texto —
 * comparar só com `=== true` perderia esse caso em silêncio.
 */
export function isForwardedMessage(message: ChatMessage): boolean {
  const flag = (message.metadata as { forwarded?: unknown })?.forwarded;
  return flag === true || flag === "true";
}

/**
 * A mensagem é do tipo que se edita — **sem olhar o relógio**.
 *
 * Existe separada porque ler a hora durante a renderização é impuro (o lint do
 * React barra). Quem só precisa saber "esta mensagem em algum momento pôde ser
 * editada?" usa esta; quem vai mostrar o item do menu usa `canEditMessage`.
 *
 * `external_id` nulo significa que o envio ainda não voltou (ou falhou): sem o
 * id do provedor não há o que editar do lado do WhatsApp.
 */
export function isEditableMessage(message: ChatMessage): boolean {
  if (!isActionable(message)) return false;
  if (message.direction !== "outbound") return false;
  if (!message.external_id) return false;
  return EDITABLE_TYPES.includes(message.type);
}

/** `isEditableMessage` + a janela de 15 minutos do WhatsApp. */
export function canEditMessage(message: ChatMessage, now: number): boolean {
  if (!isEditableMessage(message)) return false;

  const sentAt = new Date(message.created_at).getTime();
  if (Number.isNaN(sentAt)) return false;
  return now - sentAt < EDIT_WINDOW_MS;
}

/**
 * Apagar é "para todos", e o WhatsApp só apaga para todos o que nós enviamos.
 * Mensagem do contato não ganha o item — um "apagar" que só some da nossa tela
 * ensinaria que a mensagem sumiu do celular do paciente, e não sumiu.
 *
 * Sem janela de tempo: o limite do WhatsApp (≈2 dias) não está documentado no
 * OpenAPI da uazapi, e chutar prazo esconde uma ação que ainda funcionaria.
 * Expirado, o provedor recusa e a rota devolve o erro.
 */
export function canDeleteMessage(message: ChatMessage): boolean {
  if (!isActionable(message)) return false;
  return message.direction === "outbound" && Boolean(message.external_id);
}

/** Encaminhar é reenviar: precisa haver conteúdo reenviável. */
export function canForwardMessage(message: ChatMessage): boolean {
  if (!isActionable(message)) return false;
  return buildForwardPayload(message) !== null;
}

export type ForwardPayload =
  | { kind: "text"; text: string }
  | {
      kind: "media";
      type: UazapiMediaType;
      file: string;
      mimeType?: string;
      caption?: string;
      docName?: string;
    };

/**
 * O que reenviar para encaminhar esta mensagem, ou null se não dá.
 *
 * A mídia reusa a `media_url` como está: ela já foi re-hospedada no bucket
 * público `chat-media`, que é exatamente o que `/send/media` pede em `file`.
 * Sem re-upload e sem `/message/download`.
 *
 * Devolve null para mídia ainda sem URL (a que aparece como "carregando…"):
 * encaminhar ali mandaria uma mensagem vazia.
 */
export function buildForwardPayload(message: ChatMessage): ForwardPayload | null {
  if (!isActionable(message)) return null;

  const mediaType = FORWARDABLE_MEDIA[message.type];
  if (mediaType) {
    if (!message.media_url) return null;
    const caption = captionOf(message);
    return {
      kind: "media",
      type: mediaType,
      file: message.media_url,
      // O mimetype acompanha a cópia: sem ele a bolha do destino perde o que o
      // player de áudio e o link do documento usam para se comportar.
      ...(message.media_mime_type ? { mimeType: message.media_mime_type } : {}),
      ...(caption ? { caption } : {}),
      ...(message.type === "document" ? { docName: fileNameOf(message) } : {}),
    };
  }

  const text = message.content?.trim();
  if (message.type === "text" && text) return { kind: "text", text };

  // `contact` (vCard) exigiria /send/contact, e `template` não é nosso.
  return null;
}

/**
 * Legenda da mídia. Em documento sem legenda o `content` guarda o nome do
 * arquivo — reenviar isso como legenda escreveria "relatorio.pdf" embaixo do
 * anexo, que não é o que o operador vê hoje.
 */
function captionOf(message: ChatMessage): string | undefined {
  const content = message.content?.trim();
  if (!content) return undefined;
  if (message.type === "document" && content === fileNameOf(message)) return undefined;
  return content;
}

// Envio e manutenção de mensagem via uazapi.
//
// Contrato conferido contra o OpenAPI oficial (uazapiGO 2.1.1). A doc é uma SPA
// que carrega `https://docs.uazapi.com/openapi-bundled.json` — é esse arquivo, e
// não engenharia reversa, que está por trás de cada campo abaixo.
//
//   Auth:    header `token`
//   Texto:   POST {base}/send/text  { number, text, linkPreview?, replyid?, forward?, track_id }
//   Checar:  POST {base}/chat/check { numbers: string[] }
//   Mídia:   POST {base}/send/media { number, type, file, text?, docName?, replyid?, forward?, track_id }
//   Apagar:  POST {base}/message/delete { id }
//   Editar:  POST {base}/message/edit   { id, text }
//   Resposta: { id (uuid uazapi), messageid (id WhatsApp), status, ... }
//
// `track_id` recebe o id da NOSSA mensagem (chat_messages.id): serve p/ casar o
// status (messages_update) e p/ deduplicar o echo `fromMe` no webhook.

import { siteConfig } from "@/config/site";
import { safeBaseUrl } from "@/features/chat/lib/connection/ssrf-guard";
import {
  buildMessageLinkPreview,
  type MessageLinkPreview,
} from "@/features/chat/lib/message-content";

const TRACK_SOURCE = siteConfig.slug;

export type UazapiSendResult = {
  id: string | null;
  messageid: string | null;
  linkPreview?: MessageLinkPreview;
};

export type UazapiNumberCheck = {
  exists: boolean;
  phone: string;
  jid: string | null;
  verifiedName: string | null;
};

export type UazapiMediaType =
  | "image"
  | "video"
  | "audio"
  | "myaudio"
  | "ptt"
  | "ptv"
  | "document"
  | "sticker";

/** Número para envio: só dígitos (DDI incluso), sem '+' nem sufixos. */
export function toUazapiNumber(phone: string): string {
  return phone.replace(/\D/g, "");
}

async function postUazapi(
  apiUrl: string,
  token: string,
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 20000,
  previewText?: string
): Promise<UazapiSendResult> {
  const base = safeBaseUrl(apiUrl);
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`uazapi ${path} ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json().catch(() => ({}))) as {
    id?: unknown;
    messageid?: unknown;
  };
  const id = typeof json.id === "string" ? json.id : null;
  const messageid = typeof json.messageid === "string" ? json.messageid : id;
  const linkPreview = previewText
    ? buildMessageLinkPreview(previewText, json)
    : null;
  return { id, messageid, ...(linkPreview ? { linkPreview } : {}) };
}

/** Opções comuns a texto e mídia. */
type SendOptions = {
  /** Id da NOSSA chat_messages, devolvido no webhook para conciliar. */
  trackId?: string;
  /**
   * `replyId` é o **messageid da uazapi** (nosso `external_id`), não o id da
   * nossa tabela. Vai no campo `replyid`, documentado no OpenAPI oficial como
   * "ID da mensagem para responder".
   */
  replyId?: string | null;
  /**
   * Marca a mensagem como encaminhada ("Encaminhada" no WhatsApp). **Não existe
   * endpoint de encaminhar** na uazapi: encaminhar é reenviar o conteúdo com
   * esta bandeira ligada.
   */
  forward?: boolean;
};

function sendFields(opts: SendOptions | undefined) {
  return {
    ...(opts?.replyId ? { replyid: opts.replyId } : {}),
    ...(opts?.forward ? { forward: true } : {}),
    ...(opts?.trackId
      ? { track_id: opts.trackId, track_source: TRACK_SOURCE }
      : {}),
  };
}

export async function sendUazapiText(
  apiUrl: string,
  token: string,
  phone: string,
  text: string,
  opts?: SendOptions
): Promise<UazapiSendResult> {
  const linkPreview = buildMessageLinkPreview(text);
  return postUazapi(
    apiUrl,
    token,
    "/send/text",
    {
      number: toUazapiNumber(phone),
      text,
      ...(linkPreview ? { linkPreview: true } : {}),
      ...sendFields(opts),
    },
    20000,
    text
  );
}

function numberCheckCandidates(value: string): string[] {
  const digits = toUazapiNumber(value);
  if (digits.length < 10 || digits.length > 15) {
    throw new Error("Telefone inválido.");
  }

  const candidates = [digits];
  if (!value.trim().startsWith("+") && (digits.length === 10 || digits.length === 11)) {
    candidates.push(`55${digits}`);
  }
  return [...new Set(candidates)];
}

/** `POST /chat/check`, conforme o OpenAPI oficial uazapiGO 2.1.1. */
export async function checkUazapiNumber(
  apiUrl: string,
  token: string,
  value: string
): Promise<UazapiNumberCheck> {
  const numbers = numberCheckCandidates(value);
  const base = safeBaseUrl(apiUrl);
  const res = await fetch(`${base}/chat/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ numbers }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`uazapi /chat/check ${res.status}: ${text.slice(0, 200)}`);
  }

  const payload = await res.json().catch(() => null);
  if (!Array.isArray(payload)) {
    throw new Error("Resposta inválida da verificação de telefone.");
  }

  const match = payload.find((item) => {
    if (!item || typeof item !== "object") return false;
    return (item as Record<string, unknown>).isInWhatsapp === true;
  }) as Record<string, unknown> | undefined;

  if (!match) {
    return { exists: false, phone: numbers[0], jid: null, verifiedName: null };
  }

  const jid = typeof match.jid === "string" && match.jid.trim()
    ? match.jid.trim()
    : null;
  const query = typeof match.query === "string" ? match.query : numbers[0];
  const phone = toUazapiNumber(jid ?? query);
  const verifiedName =
    typeof match.verifiedName === "string" && match.verifiedName.trim()
      ? match.verifiedName.trim()
      : null;

  return { exists: true, phone, jid, verifiedName };
}

export async function sendUazapiMedia(
  apiUrl: string,
  token: string,
  phone: string,
  opts: SendOptions & {
    type: UazapiMediaType;
    file: string; // URL pública ou base64
    text?: string;
    docName?: string;
  }
): Promise<UazapiSendResult> {
  return postUazapi(
    apiUrl,
    token,
    "/send/media",
    {
      number: toUazapiNumber(phone),
      type: opts.type,
      file: opts.file,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.docName ? { docName: opts.docName } : {}),
      ...sendFields(opts),
    },
    // Mídia pode demorar (a uazapi baixa a URL pública). Timeout maior.
    60000
  );
}

/**
 * Mensagem de voz (ptt). `file` aceita base64 ou URL pública — a uazapi converte
 * o áudio para OGG/OPUS no servidor.
 */
export async function sendUazapiAudio(
  apiUrl: string,
  token: string,
  phone: string,
  fileBase64OrUrl: string,
  trackId?: string,
  replyId?: string | null
): Promise<UazapiSendResult> {
  return sendUazapiMedia(apiUrl, token, phone, {
    type: "ptt",
    file: fileBase64OrUrl,
    trackId,
    replyId,
  });
}

/**
 * Apaga a mensagem **para todos** (`POST /message/delete`).
 *
 * Só faz sentido em mensagem que a própria instância enviou: o WhatsApp não
 * apaga para todos uma mensagem escrita pelo contato. Quem decide isso é
 * `canDeleteMessage`; aqui só resta a chamada.
 *
 * A uazapi emite um `messages_update` com `Type: "Deleted"` em seguida — é o
 * mesmo evento que chega quando é o contato quem apaga.
 */
export async function deleteUazapiMessage(
  apiUrl: string,
  token: string,
  messageId: string
): Promise<void> {
  // `postUazapi` lança em resposta não-2xx, que é exatamente o que a rota quer:
  // só gravamos `is_deleted` depois de o provedor confirmar.
  await postUazapi(apiUrl, token, "/message/delete", { id: messageId });
}

/**
 * Edita uma mensagem já enviada (`POST /message/edit`).
 *
 * ⚠️ **A resposta traz um `messageid` NOVO** — a doc oficial diz "Gera um novo
 * ID para a mensagem editada". Quem chama precisa gravar esse id no
 * `external_id`, senão os ticks param de casar (o `messages_update` chega com o
 * id novo) e o eco da edição entra como mensagem duplicada, já que a chave de
 * dedup é `(conversation_id, external_id)`.
 *
 * O WhatsApp só permite editar dentro de uma janela curta (15 min); passado
 * isso, o provedor recusa e o erro sobe daqui.
 */
export async function editUazapiMessage(
  apiUrl: string,
  token: string,
  messageId: string,
  text: string
): Promise<UazapiSendResult> {
  return postUazapi(apiUrl, token, "/message/edit", { id: messageId, text });
}

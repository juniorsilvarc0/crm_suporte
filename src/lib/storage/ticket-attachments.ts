import { createHash, randomUUID } from "node:crypto";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  CHAT_MEDIA_MAX_BYTES,
  signStorageObject,
  storageContentType,
} from "@/lib/storage/chat-media";

/**
 * Anexo de ticket: bucket PRIVADO `ticket-attachments` (20260925120900_tickets.sql,
 * bloco 12), com o MESMO teto e a MESMA lista de tipos do `chat-media` — a
 * migration copia os dois do bucket do chat e confere a igualdade. Por isso o
 * tipo gravado sai de `storageContentType`, e HTML, SVG, XML e afins viram
 * `application/octet-stream`: o navegador baixa em vez de executar.
 *
 * Nenhuma URL de storage vai para o banco nem para o navegador. A linha de
 * `ticket_attachments` guarda bucket + `object_key` + sha256, que ficam no
 * servidor; o arquivo sai por `/api/tickets/<id>/attachments/<attachmentId>`,
 * que confere a sessão e redireciona para uma URL assinada curta.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const TICKET_ATTACHMENTS_BUCKET = "ticket-attachments";

/** `file_size_limit` do bucket e `ticket_attachments_size_check` (1 a 52428800). */
export const TICKET_ATTACHMENT_MAX_BYTES = CHAT_MEDIA_MAX_BYTES;

/** `ticket_attachments_file_name_check`: até 255 caracteres (code points). */
const FILE_NAME_MAX_CHARS = 255;
/** Extensão que o corte do nome preserva ("….pdf"); maior que isso não é extensão. */
const EXTENSION_MAX_CHARS = 16;
const FALLBACK_FILE_NAME = "arquivo";

// Controle (inclui NUL, que o text do Postgres recusa), formatação (inclui os
// controles bidi: "fatura\u202Efdp.exe" apareceria como "faturaexe.pdf"),
// surrogate solto e separador de linha/parágrafo.
const UNSAFE_FILE_NAME_CHARS = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;

// `ticket_attachments_object_key_check`: tickets/<ticket>/<uuid>, minúsculo.
const OBJECT_KEY_RE = /^tickets\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

export type StoredTicketAttachment = {
  bucket: typeof TICKET_ATTACHMENTS_BUCKET;
  objectKey: string;
  /** Tipo com que o objeto foi gravado (ver storageContentType). */
  mime: string;
  sizeBytes: number;
  /** sha256 em hex minúsculo, calculado aqui, nunca vindo do cliente. */
  sha256: string;
};

/**
 * `tickets/<ticketId>/<uuid>`. Nunca o nome do arquivo: ele vive só na linha.
 * O CHECK exige a chave DESTE ticket em minúsculas (`ticket_id::text`), e o
 * UUID_RE das rotas aceita maiúsculas: normaliza aqui.
 */
export function ticketAttachmentKey(ticketId: string): string {
  return `tickets/${ticketId.toLowerCase()}/${randomUUID()}`;
}

/**
 * Nome para exibir e para o download, dentro do CHECK: só o último segmento
 * (o navegador antigo manda "C:\fakepath\…"), sem caractere invisível, em NFC
 * (o macOS manda "ó" decomposto) e com até 255 caracteres, cortando o fim do
 * nome e mantendo a extensão. Vazio vira "arquivo".
 */
export function sanitizeAttachmentFileName(raw: string): string {
  const base = raw.split(/[/\\]/).at(-1) ?? "";
  const name = base.normalize("NFC").replace(UNSAFE_FILE_NAME_CHARS, "").trim();
  if (!name) return FALLBACK_FILE_NAME;

  const chars = Array.from(name);
  if (chars.length <= FILE_NAME_MAX_CHARS) return name;

  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? Array.from(name.slice(dot)) : [];
  if (extension.length === 0 || extension.length > EXTENSION_MAX_CHARS) {
    return chars.slice(0, FILE_NAME_MAX_CHARS).join("").trim();
  }
  const head = chars.slice(0, FILE_NAME_MAX_CHARS - extension.length).join("").trimEnd();
  return `${head}${extension.join("")}`;
}

/**
 * O navegador mostra o arquivo em vez de baixá-lo: imagem, vídeo, áudio e PDF.
 * O resto (inclusive o octet-stream do HTML/SVG) sai como download com o nome
 * original — a chave não tem extensão, e sem isso o arquivo baixaria como
 * "<uuid>".
 */
export function isInlineAttachment(mime: string): boolean {
  return /^(image|video|audio)\//.test(mime) || mime === "application/pdf";
}

/**
 * Guarda o arquivo no bucket privado e devolve onde e como ele ficou, ou null
 * se o storage recusar (logado). Não grava a linha: a rota faz o INSERT depois
 * e, se ele falhar, chama `removeTicketAttachment` com a mesma chave.
 */
export async function putTicketAttachment(opts: {
  supabase: Admin;
  ticketId: string;
  body: Buffer;
  /** Tipo declarado pelo cliente (forjável): só escolhe o tipo gravado. */
  mime: string | null | undefined;
}): Promise<StoredTicketAttachment | null> {
  const { supabase, ticketId, body } = opts;

  // O CHECK de tamanho recusaria o INSERT depois do upload; recusar aqui não
  // deixa objeto para apagar.
  if (body.length < 1 || body.length > TICKET_ATTACHMENT_MAX_BYTES) {
    console.warn(`[putTicketAttachment] ${body.length} bytes fora do limite do bucket`);
    return null;
  }

  const mime = storageContentType(opts.mime);
  const objectKey = ticketAttachmentKey(ticketId);
  const sha256 = createHash("sha256").update(body).digest("hex");

  const { error } = await supabase.storage
    .from(TICKET_ATTACHMENTS_BUCKET)
    .upload(objectKey, body, { contentType: mime, upsert: false });
  if (error) {
    console.error("[putTicketAttachment] storage recusou:", error.message);
    return null;
  }

  return { bucket: TICKET_ATTACHMENTS_BUCKET, objectKey, mime, sizeBytes: body.length, sha256 };
}

/**
 * Apaga o objeto de um upload cuja linha não foi gravada. Só aceita chave de
 * anexo de ticket: um valor estranho não vira remoção em outro lugar do bucket.
 * Devolve false (logado) se a chave não confere ou o storage recusar.
 */
export async function removeTicketAttachment(supabase: Admin, objectKey: string): Promise<boolean> {
  if (!OBJECT_KEY_RE.test(objectKey)) {
    console.error("[removeTicketAttachment] chave fora do padrão tickets/<id>/<uuid>");
    return false;
  }
  const { error } = await supabase.storage.from(TICKET_ATTACHMENTS_BUCKET).remove([objectKey]);
  if (error) {
    console.error("[removeTicketAttachment] storage recusou:", error.message);
    return false;
  }
  return true;
}

/**
 * URL assinada do anexo, já na origem pública, ou null se o storage recusar.
 *
 * Fora dos tipos que o navegador mostra, pede o download com o nome original.
 * O parâmetro é acrescentado aqui, e não pela opção `download` do supabase-js
 * (2.105): ela passa o nome já codificado por encodeURI de novo, e
 * "relatório.pdf" baixaria como "relat%C3%B3rio.pdf".
 */
export async function signTicketAttachment(
  supabase: Admin,
  attachment: { object_key: string; file_name: string; mime: string },
  expiresInSeconds: number
): Promise<string | null> {
  const signed = await signStorageObject(
    supabase,
    TICKET_ATTACHMENTS_BUCKET,
    attachment.object_key,
    expiresInSeconds
  );
  if (!signed || isInlineAttachment(attachment.mime)) return signed;

  const url = new URL(signed);
  url.searchParams.set("download", attachment.file_name);
  return url.toString();
}

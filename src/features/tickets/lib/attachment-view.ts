import type { DocumentMessagePresentation } from "@/features/chat/lib/document-message";
import type { TicketAttachment } from "@/features/tickets/types";
import { formatBytes } from "@/lib/formatters/bytes";

// Anexo do ticket na tela: o endereço do arquivo, a apresentação do cartão de
// documento do chat e as mensagens do envio. Puro e neutro: o client importa.

/**
 * Teto do arquivo, conferido ANTES de enviar: o mesmo do bucket e da rota
 * (TICKET_ATTACHMENT_MAX_BYTES, em lib/storage, que é de servidor). O teste
 * falha se os dois divergirem.
 */
export const TICKET_ATTACHMENT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

const TOO_LARGE_MESSAGE = "Arquivo muito grande (máx. 50 MB).";

/**
 * O arquivo sai pela rota do anexo (sessão + 302 para uma URL assinada curta),
 * nunca por uma URL do storage.
 */
export function ticketAttachmentHref(ticketId: string, attachmentId: string): string {
  return `/api/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

// Só o que todo navegador desenha. HEIC/HEIF passam no bucket, mas viram
// ícone quebrado num <img>: vão como documento, para baixar.
const PREVIEWABLE_IMAGE_MIME: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** Imagem que a tela mostra em miniatura (e amplia no lightbox). */
export function isPreviewableImage(mime: string): boolean {
  return PREVIEWABLE_IMAGE_MIME.has(mime.split(";", 1)[0].trim().toLowerCase());
}

/**
 * A apresentação do `DocumentMessageCard` montada direto do anexo: o nome é o
 * original (saneado pela rota), a extensão sai dele, e o tamanho é o gravado.
 * Não passa por getDocumentMessagePresentation, que decodifica o nome como URL
 * ("a%20b.pdf" viraria "a b.pdf").
 */
export function attachmentPresentation(
  attachment: Pick<TicketAttachment, "file_name" | "size_bytes">
): DocumentMessagePresentation {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(attachment.file_name)?.[1] ?? null;
  return {
    fileName: attachment.file_name,
    extension: extension ? extension.toUpperCase() : null,
    sizeLabel: formatBytes(attachment.size_bytes) || null,
    caption: null,
  };
}

/** O que impede o envio antes de sair do navegador, ou `null` se o arquivo serve. */
export function attachmentFileProblem(file: Pick<File, "size">): string | null {
  if (file.size === 0) return "O arquivo está vazio.";
  if (file.size > TICKET_ATTACHMENT_UPLOAD_MAX_BYTES) return TOO_LARGE_MESSAGE;
  return null;
}

type UploadErrorBody = {
  message?: unknown;
  errors?: { file?: unknown };
};

// Quando o corpo não diz nada (o 413 do proxy nem é JSON), o status basta.
const UPLOAD_FALLBACK: Record<number, string> = {
  400: "Não foi possível ler o arquivo. Escolha de novo.",
  404: "Ticket não encontrado.",
  413: TOO_LARGE_MESSAGE,
  502: "Não foi possível guardar o arquivo. Tente de novo.",
};

/**
 * Mensagem legível do envio que falhou: a do campo `file`, a da rota, ou a do
 * status quando o corpo não é da rota.
 */
export function uploadErrorMessage(status: number, body: unknown): string {
  const parsed = (typeof body === "object" && body !== null ? body : {}) as UploadErrorBody;
  const fieldMessages = parsed.errors?.file;
  const fieldMessage = Array.isArray(fieldMessages) ? fieldMessages[0] : undefined;
  if (typeof fieldMessage === "string" && fieldMessage.trim()) return fieldMessage;
  if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message;
  return UPLOAD_FALLBACK[status] ?? "Não foi possível anexar o arquivo.";
}

/**
 * A lista do servidor (do mais novo para o mais antigo, como getTicketDetail a
 * lê) com os anexos que ESTA tela acabou de enviar na frente, até o
 * `router.refresh()` trazê-los; aí o id repetido não entra duas vezes.
 */
export function mergeAttachments(
  server: readonly TicketAttachment[],
  added: readonly TicketAttachment[]
): TicketAttachment[] {
  const known = new Set(server.map((attachment) => attachment.id));
  const fresh = added.filter((attachment) => !known.has(attachment.id));
  return [...fresh.reverse(), ...server];
}

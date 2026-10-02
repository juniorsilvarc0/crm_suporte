import { describe, expect, it } from "vitest";

import {
  EDIT_WINDOW_MS,
  buildForwardPayload,
  canDeleteMessage,
  canEditMessage,
  canForwardMessage,
  canRetryMessage,
  isEditableMessage,
  isForwardedMessage,
  wasEdited,
} from "@/features/chat/lib/message-actions";
import type { ChatMessage } from "@/features/chat/types";

const NOW = Date.parse("2026-08-06T12:00:00.000Z");

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    conversation_id: "c1",
    external_id: "3EB0538DA65A59F6D8A251",
    direction: "outbound",
    sender_type: "agent",
    type: "text",
    content: "oi",
    media_url: null,
    media_mime_type: null,
    quoted_message_id: null,
    delivery_status: "sent",
    sent_by_user_id: null,
    sent_by_token_id: null,
    is_deleted: false,
    metadata: {},
    created_at: new Date(NOW - 60_000).toISOString(),
    ...overrides,
  };
}

describe("mensagem de um token (IA ou integração)", () => {
  const fromToken = (overrides: Partial<ChatMessage> = {}) =>
    message({ sender_type: "ai", sent_by_token_id: "tok-1", ...overrides });

  // A linha seguiria assinada pelo token com um texto que ele não escreveu.
  it("não se edita pela tela, nem dentro da janela", () => {
    expect(isEditableMessage(fromToken())).toBe(false);
    expect(canEditMessage(fromToken(), NOW)).toBe(false);
    expect(canEditMessage(fromToken({ sender_type: "system" }), NOW)).toBe(false);
    // Vale pelo remetente também: uma linha `ai` sem o token gravado não vira editável.
    expect(canEditMessage(fromToken({ sent_by_token_id: null }), NOW)).toBe(false);
    // A mesma mensagem, de um analista, edita.
    expect(canEditMessage(message(), NOW)).toBe(true);
  });

  it("apaga-se e encaminha-se como qualquer outra", () => {
    expect(canDeleteMessage(fromToken())).toBe(true);
    expect(canForwardMessage(fromToken())).toBe(true);
  });

  // A regra é "não foi uma pessoa", e não "só o analista": o celular da empresa
  // segue como era. E vale para a legenda de mídia, não só para o texto.
  it("o celular da empresa segue editável e reenviável; a legenda de token, não", () => {
    expect(canEditMessage(message({ sender_type: "device" }), NOW)).toBe(true);
    expect(canRetryMessage(message({ sender_type: "device", delivery_status: "failed", external_id: null }))).toBe(true);
    for (const type of ["image", "video", "document"] as const) {
      expect(canEditMessage(fromToken({ type }), NOW)).toBe(false);
    }
  });
});

describe("canRetryMessage", () => {
  const failed = (overrides: Partial<ChatMessage> = {}) =>
    message({ delivery_status: "failed", external_id: null, ...overrides });

  it("o envio do analista que falhou pode ser tentado de novo", () => {
    expect(canRetryMessage(failed())).toBe(true);
  });

  // O servidor recusa (send-outbound.ts): só o token reenvia a mensagem dele.
  it("o envio de um token que falhou não oferece o reenvio", () => {
    expect(canRetryMessage(failed({ sender_type: "ai", sent_by_token_id: "tok-1" }))).toBe(false);
    expect(canRetryMessage(failed({ sender_type: "system", sent_by_token_id: "tok-2" }))).toBe(false);
    expect(canRetryMessage(failed({ sender_type: "ai", sent_by_token_id: null }))).toBe(false);
  });

  it.each(["pending", "sent", "delivered", "read"] as const)("mensagem %s não tem o que reenviar", (delivery_status) => {
    expect(canRetryMessage(failed({ delivery_status }))).toBe(false);
  });

  it("mensagem apagada ou recebida não se reenvia", () => {
    expect(canRetryMessage(failed({ is_deleted: true }))).toBe(false);
    expect(canRetryMessage(failed({ direction: "inbound", sender_type: "contact" }))).toBe(false);
  });
});

describe("canEditMessage", () => {
  it("mensagem nossa, recente, com id do provedor", () => {
    expect(canEditMessage(message(), NOW)).toBe(true);
  });

  it("aceita legenda de mídia (imagem, vídeo, documento)", () => {
    for (const type of ["image", "video", "document"] as const) {
      expect(canEditMessage(message({ type }), NOW)).toBe(true);
    }
  });

  it("recusa tipo sem texto editável", () => {
    expect(canEditMessage(message({ type: "audio" }), NOW)).toBe(false);
    expect(canEditMessage(message({ type: "sticker" }), NOW)).toBe(false);
    expect(canEditMessage(message({ type: "contact" }), NOW)).toBe(false);
  });

  it("recusa mensagem do contato — a uazapi só edita o que a instância enviou", () => {
    expect(canEditMessage(message({ direction: "inbound" }), NOW)).toBe(false);
  });

  it("recusa sem external_id: não há o que editar do lado do WhatsApp", () => {
    expect(canEditMessage(message({ external_id: null }), NOW)).toBe(false);
  });

  it("recusa nota interna e mensagem apagada", () => {
    expect(canEditMessage(message({ type: "note" }), NOW)).toBe(false);
    expect(canEditMessage(message({ is_deleted: true }), NOW)).toBe(false);
  });

  it("a janela de 15 min é exclusiva na borda", () => {
    const inside = message({
      created_at: new Date(NOW - EDIT_WINDOW_MS + 1000).toISOString(),
    });
    const outside = message({
      created_at: new Date(NOW - EDIT_WINDOW_MS - 1000).toISOString(),
    });
    const exact = message({
      created_at: new Date(NOW - EDIT_WINDOW_MS).toISOString(),
    });
    expect(canEditMessage(inside, NOW)).toBe(true);
    expect(canEditMessage(outside, NOW)).toBe(false);
    expect(canEditMessage(exact, NOW)).toBe(false);
  });

  it("data inválida não vira janela aberta", () => {
    expect(canEditMessage(message({ created_at: "sem data" }), NOW)).toBe(false);
  });
});

describe("canDeleteMessage", () => {
  it("apaga mensagem nossa, sem prazo", () => {
    const antiga = message({ created_at: "2020-01-01T00:00:00.000Z" });
    expect(canDeleteMessage(antiga)).toBe(true);
  });

  it("recusa mensagem do contato — 'apagar para todos' não vale para ela", () => {
    expect(canDeleteMessage(message({ direction: "inbound" }))).toBe(false);
  });

  it("recusa sem external_id, nota interna e já apagada", () => {
    expect(canDeleteMessage(message({ external_id: null }))).toBe(false);
    expect(canDeleteMessage(message({ type: "note" }))).toBe(false);
    expect(canDeleteMessage(message({ is_deleted: true }))).toBe(false);
  });

  it("apaga mídia tanto quanto texto", () => {
    expect(canDeleteMessage(message({ type: "audio", media_url: "u" }))).toBe(true);
  });
});

describe("canForwardMessage", () => {
  it("encaminha texto e mensagem do contato", () => {
    expect(canForwardMessage(message())).toBe(true);
    expect(canForwardMessage(message({ direction: "inbound" }))).toBe(true);
  });

  it("recusa texto vazio", () => {
    expect(canForwardMessage(message({ content: "   " }))).toBe(false);
    expect(canForwardMessage(message({ content: null }))).toBe(false);
  });

  it("recusa mídia ainda sem URL — a que aparece como 'carregando…'", () => {
    expect(canForwardMessage(message({ type: "image", media_url: null }))).toBe(false);
  });

  it("recusa nota interna, apagada e vCard", () => {
    expect(canForwardMessage(message({ type: "note" }))).toBe(false);
    expect(canForwardMessage(message({ is_deleted: true }))).toBe(false);
    expect(canForwardMessage(message({ type: "contact", content: "BEGIN:VCARD" }))).toBe(
      false
    );
  });

  it("encaminha sem external_id: reenviar não depende do id do provedor", () => {
    expect(canForwardMessage(message({ external_id: null }))).toBe(true);
  });
});

describe("buildForwardPayload", () => {
  it("texto vai limpo", () => {
    expect(buildForwardPayload(message({ content: "  bom dia  " }))).toEqual({
      kind: "text",
      text: "bom dia",
    });
  });

  it("imagem com legenda leva o mimetype junto", () => {
    const payload = buildForwardPayload(
      message({
        type: "image",
        media_url: "https://x/a.jpg",
        media_mime_type: "image/jpeg",
        content: "olha",
      })
    );
    expect(payload).toEqual({
      kind: "media",
      type: "image",
      file: "https://x/a.jpg",
      mimeType: "image/jpeg",
      caption: "olha",
    });
  });

  it("imagem sem legenda não manda caption vazio", () => {
    const payload = buildForwardPayload(
      message({ type: "image", media_url: "https://x/a.jpg", content: null })
    );
    expect(payload).toEqual({ kind: "media", type: "image", file: "https://x/a.jpg" });
  });

  it("áudio é reenviado como ptt", () => {
    const payload = buildForwardPayload(
      message({ type: "audio", media_url: "https://x/a.ogg", content: null })
    );
    expect(payload).toMatchObject({ type: "ptt", file: "https://x/a.ogg" });
  });

  it("documento leva o nome do arquivo e NÃO o repete como legenda", () => {
    const payload = buildForwardPayload(
      message({
        type: "document",
        media_url: "https://x/r.pdf",
        content: "relatorio.pdf",
        metadata: { fileName: "relatorio.pdf" },
      })
    );
    expect(payload).toEqual({
      kind: "media",
      type: "document",
      file: "https://x/r.pdf",
      docName: "relatorio.pdf",
    });
  });

  it("documento com legenda de verdade mantém as duas coisas", () => {
    const payload = buildForwardPayload(
      message({
        type: "document",
        media_url: "https://x/r.pdf",
        content: "segue o relatório",
        metadata: { fileName: "relatorio.pdf" },
      })
    );
    expect(payload).toEqual({
      kind: "media",
      type: "document",
      file: "https://x/r.pdf",
      caption: "segue o relatório",
      docName: "relatorio.pdf",
    });
  });

  it("null para o que não sabemos reenviar", () => {
    expect(buildForwardPayload(message({ type: "contact" }))).toBeNull();
    expect(buildForwardPayload(message({ type: "template" }))).toBeNull();
    expect(buildForwardPayload(message({ type: "note" }))).toBeNull();
  });
});

describe("wasEdited", () => {
  it("só com editedAt gravado", () => {
    expect(wasEdited(message())).toBe(false);
    expect(wasEdited(message({ metadata: { editedAt: "" } }))).toBe(false);
    expect(wasEdited(message({ metadata: { editedAt: "2026-08-06T12:00:00Z" } }))).toBe(
      true
    );
  });
});

describe("isForwardedMessage", () => {
  it("mensagem comum não é encaminhada", () => {
    expect(isForwardedMessage(message())).toBe(false);
    expect(isForwardedMessage(message({ metadata: { fileName: "a.pdf" } }))).toBe(false);
  });

  it("reconhece a marca gravada pela rota de encaminhar", () => {
    expect(isForwardedMessage(message({ metadata: { forwarded: true } }))).toBe(true);
  });

  it("aceita a marca como texto — jsonb devolve o que foi gravado", () => {
    expect(isForwardedMessage(message({ metadata: { forwarded: "true" } }))).toBe(true);
  });

  it("valor falso ou estranho não vira encaminhada", () => {
    expect(isForwardedMessage(message({ metadata: { forwarded: false } }))).toBe(false);
    expect(isForwardedMessage(message({ metadata: { forwarded: "false" } }))).toBe(false);
    expect(isForwardedMessage(message({ metadata: { forwarded: 1 } }))).toBe(false);
  });
});

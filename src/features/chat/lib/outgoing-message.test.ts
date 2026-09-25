import { describe, expect, it } from "vitest";

import {
  CLIENT_ID_PATTERN,
  createOptimisticMessage,
  isOptimistic,
  keepUnconfirmed,
  newClientId,
  readClientId,
  setSendStatus,
  upsertMessage,
} from "@/features/chat/lib/outgoing-message";
import type { ChatMessage } from "@/features/chat/types";

function message(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    conversation_id: "conv-1",
    external_id: null,
    direction: "outbound",
    type: "text",
    content: "oi",
    media_url: null,
    media_mime_type: null,
    quoted_message_id: null,
    delivery_status: "sent",
    sent_by_user_id: null,
    is_deleted: false,
    metadata: {},
    created_at: "2026-08-14T12:00:00.000Z",
    ...overrides,
  };
}

/** A linha que a rota devolve/emite para uma bolha otimista de `clientId`. */
function persisted(id: string, clientId: string, extra: Partial<ChatMessage> = {}) {
  return message({
    id,
    external_id: "provider-1",
    delivery_status: "sent",
    metadata: { clientId },
    ...extra,
  });
}

describe("newClientId", () => {
  it("cabe no charset que a rota valida", () => {
    expect(CLIENT_ID_PATTERN.test(newClientId())).toBe(true);
  });
});

describe("createOptimisticMessage", () => {
  it("nasce pendente, sem id de provedor e carimbada com o clientId", () => {
    const optimistic = createOptimisticMessage({
      conversationId: "conv-1",
      clientId: "abc",
      content: "*Ana:*\nbom dia",
      createdAt: "2026-08-14T12:00:00.000Z",
    });

    expect(isOptimistic(optimistic)).toBe(true);
    expect(optimistic.delivery_status).toBe("pending");
    expect(optimistic.external_id).toBeNull();
    expect(readClientId(optimistic)).toBe("abc");
    // O texto da bolha é o que sai para o contato — assinatura incluída.
    expect(optimistic.content).toBe("*Ana:*\nbom dia");
  });

  it("uma linha vinda do banco nunca é confundida com bolha local", () => {
    expect(isOptimistic(persisted("real-1", "abc"))).toBe(false);
  });
});

describe("upsertMessage", () => {
  it("reconcilia a bolha local pelo clientId em vez de duplicar", () => {
    const optimistic = createOptimisticMessage({
      conversationId: "conv-1",
      clientId: "abc",
      content: "oi",
    });
    const list = upsertMessage([], optimistic);

    const next = upsertMessage(list, persisted("real-1", "abc"));

    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("real-1");
    expect(next[0].delivery_status).toBe("sent");
  });

  it("mantém a POSIÇÃO ao reconciliar, mesmo se a segunda confirmar primeiro", () => {
    const first = createOptimisticMessage({
      conversationId: "conv-1",
      clientId: "um",
      content: "primeira",
    });
    const second = createOptimisticMessage({
      conversationId: "conv-1",
      clientId: "dois",
      content: "segunda",
    });
    let list = upsertMessage(upsertMessage([], first), second);

    // A SEGUNDA volta antes da primeira — a ordem na tela não pode inverter.
    list = upsertMessage(list, persisted("real-2", "dois", { content: "segunda" }));
    list = upsertMessage(list, persisted("real-1", "um", { content: "primeira" }));

    expect(list.map((item) => item.content)).toEqual(["primeira", "segunda"]);
  });

  it("o INSERT e o UPDATE da mesma linha não viram duas mensagens", () => {
    const list = upsertMessage([], persisted("real-1", "abc", { delivery_status: "pending" }));

    const next = upsertMessage(list, persisted("real-1", "abc", { delivery_status: "read" }));

    expect(next).toHaveLength(1);
    expect(next[0].delivery_status).toBe("read");
  });

  it("o eco do provedor casa pelo external_id", () => {
    const list = upsertMessage([], message({ id: "real-1", external_id: "provider-1" }));

    const next = upsertMessage(
      list,
      message({ id: "outro-id", external_id: "provider-1", delivery_status: "delivered" })
    );

    expect(next).toHaveLength(1);
    expect(next[0].delivery_status).toBe("delivered");
  });

  it("external_id nulo dos dois lados não faz mensagens diferentes casarem", () => {
    const list = upsertMessage([], message({ id: "a", content: "primeira" }));

    const next = upsertMessage(list, message({ id: "b", content: "segunda" }));

    expect(next.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("setSendStatus", () => {
  it("marca só o envio daquele clientId", () => {
    const list = [
      message({ id: "local:um", delivery_status: "pending", metadata: { clientId: "um" } }),
      message({ id: "local:dois", delivery_status: "pending", metadata: { clientId: "dois" } }),
    ];

    const next = setSendStatus(list, "um", "failed");

    expect(next[0].delivery_status).toBe("failed");
    expect(next[1].delivery_status).toBe("pending");
  });

  it("o retry devolve a mensagem para pendente", () => {
    const list = [
      message({ id: "real-1", delivery_status: "failed", metadata: { clientId: "um" } }),
    ];

    expect(setSendStatus(list, "um", "pending")[0].delivery_status).toBe("pending");
  });

  it("clientId desconhecido não mexe em nada", () => {
    const list = [message({ id: "real-1", metadata: { clientId: "um" } })];

    expect(setSendStatus(list, "outro", "failed")[0].delivery_status).toBe("sent");
  });
});

describe("keepUnconfirmed", () => {
  it("preserva o envio que ainda não voltou quando a janela recarrega", () => {
    const optimistic = createOptimisticMessage({
      conversationId: "conv-1",
      clientId: "abc",
      content: "oi",
    });

    const next = keepUnconfirmed([message({ id: "real-0" })], [optimistic]);

    expect(next.map((item) => item.id)).toEqual(["real-0", optimistic.id]);
  });

  it("descarta a bolha local quando a linha correspondente já veio", () => {
    const optimistic = createOptimisticMessage({
      conversationId: "conv-1",
      clientId: "abc",
      content: "oi",
    });

    const next = keepUnconfirmed([persisted("real-1", "abc")], [optimistic]);

    expect(next.map((item) => item.id)).toEqual(["real-1"]);
  });
});

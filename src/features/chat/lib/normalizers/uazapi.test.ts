import { describe, expect, it } from "vitest";

import {
  normalizeUazapiWebhook,
  extractUazapiDeletion,
  extractUazapiStatuses,
  extractUazapiMedia,
  getUazapiMessage,
  uazapiEventType,
} from "./uazapi";

describe("normalizeUazapiWebhook", () => {
  it("normaliza mensagem de texto inbound (chaveia por chatid)", () => {
    const n = normalizeUazapiWebhook({
      EventType: "messages",
      message: {
        messageid: "WA123",
        chatid: "5511999998888@s.whatsapp.net",
        sender_pn: "5511999998888@s.whatsapp.net",
        senderName: "João",
        fromMe: false,
        messageType: "conversation",
        text: "Olá, quero agendar",
        messageTimestamp: 1_700_000_000,
      },
    });
    expect(n).toMatchObject({
      external_id: "WA123",
      direction: "inbound",
      type: "text",
      content: "Olá, quero agendar",
      contact_phone: "5511999998888",
      contact_name: "João",
    });
    expect(n?.created_at).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it("FIX fromMe: chaveia pelo chatid (contato), não pelo dono; nome vem null", () => {
    // O dono (558690000023) envia para o contato 558690000022 pelo próprio celular.
    const n = normalizeUazapiWebhook({
      EventType: "messages",
      message: {
        messageid: "WA9",
        chatid: "558690000022@s.whatsapp.net", // contraparte
        sender_pn: "558690000023@s.whatsapp.net", // dono
        senderName: "Junior", // nome do dono — NÃO usar
        fromMe: true,
        messageType: "conversation",
        text: "Blz kkk",
      },
    });
    expect(n?.direction).toBe("outbound");
    expect(n?.contact_phone).toBe("558690000022"); // o contato, não o dono
    expect(n?.contact_name).toBeNull();
  });

  it("usa o avatar do chat", () => {
    const n = normalizeUazapiWebhook({
      EventType: "messages",
      chat: { imagePreview: "https://pps.whatsapp.net/x.jpg" },
      message: {
        messageid: "WA1",
        chatid: "5511988887777@s.whatsapp.net",
        fromMe: false,
        messageType: "conversation",
        text: "oi",
      },
    });
    expect(n?.contact_avatar_url).toBe("https://pps.whatsapp.net/x.jpg");
  });

  it("preserva o preview de link entregue no conteúdo bruto", () => {
    const n = normalizeUazapiWebhook({
      EventType: "messages",
      message: {
        messageid: "LINK1",
        chatid: "5511988887777@s.whatsapp.net",
        fromMe: false,
        messageType: "extendedTextMessage",
        content: {
          text: "Confira https://github.com/",
          extendedTextMessage: {
            title: "GitHub",
            description: "Plataforma de desenvolvimento",
          },
        },
      },
    });

    expect(n?.metadata).toEqual({
      linkPreview: expect.objectContaining({
        url: "https://github.com/",
        title: "GitHub",
        description: "Plataforma de desenvolvimento",
      }),
    });
  });

  it("mapeia ptt/áudio para 'audio'", () => {
    const n = normalizeUazapiWebhook({
      EventType: "messages",
      message: {
        messageid: "a1",
        chatid: "5511988887777@s.whatsapp.net",
        fromMe: false,
        messageType: "audioMessage",
      },
    });
    expect(n?.type).toBe("audio");
  });

  // As dimensões vão para o metadata só para o `<img>` reservar a altura antes
  // de a foto chegar. Sem elas a linha remede a cada carregamento.
  it("guarda largura/altura da imagem quando a uazapi manda", () => {
    const n = normalizeUazapiWebhook({
      EventType: "messages",
      message: {
        messageid: "img1",
        chatid: "5511988887777@s.whatsapp.net",
        fromMe: false,
        messageType: "imageMessage",
        content: { URL: "https://x/y.jpg", mimetype: "image/jpeg", width: 738, height: 1600 },
      },
    });
    expect(n?.metadata).toEqual({ mediaWidth: 738, mediaHeight: 1600 });
  });

  it("não guarda dimensão de áudio nem de documento", () => {
    const n = normalizeUazapiWebhook({
      EventType: "messages",
      message: {
        messageid: "doc1",
        chatid: "5511988887777@s.whatsapp.net",
        fromMe: false,
        messageType: "documentMessage",
        content: { URL: "https://x/y.pdf", width: 738, height: 1600 },
      },
    });
    expect(n?.metadata).toBeUndefined();
  });

  it("sem dimensão no payload, a mensagem entra sem metadata", () => {
    const n = normalizeUazapiWebhook({
      EventType: "messages",
      message: {
        messageid: "img2",
        chatid: "5511988887777@s.whatsapp.net",
        fromMe: false,
        messageType: "imageMessage",
        content: { URL: "https://x/y.jpg", mimetype: "image/jpeg" },
      },
    });
    expect(n?.metadata).toBeUndefined();
  });

  it("ignora mensagens de grupo", () => {
    expect(
      normalizeUazapiWebhook({
        EventType: "messages",
        message: { messageid: "g1", chatid: "123456@g.us", isGroup: true, text: "oi" },
      })
    ).toBeNull();
  });

  it("retorna null para messages_update", () => {
    expect(
      normalizeUazapiWebhook({
        EventType: "messages_update",
        event: { Type: "Delivered", MessageIDs: ["x"] },
      })
    ).toBeNull();
  });
});

describe("extractUazapiStatuses (event.Type + MessageIDs)", () => {
  it("Delivered vira delivered para cada MessageID", () => {
    const s = extractUazapiStatuses({
      EventType: "messages_update",
      event: { Type: "Delivered", MessageIDs: ["WA1", "WA2"] },
    });
    expect(s).toEqual([
      { messageid: "WA1", status: "delivered" },
      { messageid: "WA2", status: "delivered" },
    ]);
  });

  it("Read e Played viram read", () => {
    expect(
      extractUazapiStatuses({
        EventType: "messages_update",
        event: { Type: "Read", MessageIDs: ["A"] },
      })[0]
    ).toMatchObject({ status: "read" });
    expect(
      extractUazapiStatuses({
        EventType: "messages_update",
        event: { Type: "Played", MessageIDs: ["B"] },
      })[0]
    ).toMatchObject({ status: "read" });
  });

  it("FileDownloaded NÃO é status", () => {
    expect(
      extractUazapiStatuses({
        EventType: "messages_update",
        event: { Type: "FileDownloaded", MessageIDs: ["A"], FileURL: "x" },
      })
    ).toEqual([]);
  });

  it("evento 'messages' não é tratado como status", () => {
    expect(
      extractUazapiStatuses({ EventType: "messages", message: { messageid: "A" } })
    ).toEqual([]);
  });
});

describe("extractUazapiMedia (FileDownloaded)", () => {
  it("extrai FileURL + MimeType + MessageIDs + telefone", () => {
    const m = extractUazapiMedia({
      EventType: "messages_update",
      event: {
        Type: "FileDownloaded",
        FileURL: "https://spincode.uazapi.com/files/x.mp3",
        MimeType: "audio/mpeg",
        MessageIDs: ["3A314CFBC335B312EDAC"],
        chatid: "558690000022@s.whatsapp.net",
      },
    });
    expect(m).toMatchObject({
      fileUrl: "https://spincode.uazapi.com/files/x.mp3",
      mimetype: "audio/mpeg",
      messageIds: ["3A314CFBC335B312EDAC"],
      phone: "558690000022",
      isGroup: false,
    });
  });

  it("null quando não é FileDownloaded", () => {
    expect(
      extractUazapiMedia({
        EventType: "messages_update",
        event: { Type: "Read", MessageIDs: ["A"] },
      })
    ).toBeNull();
  });

  it("marca grupo", () => {
    const m = extractUazapiMedia({
      EventType: "messages_update",
      event: { Type: "FileDownloaded", FileURL: "x", MessageIDs: ["A"], Chat: "12@g.us" },
    });
    expect(m?.isGroup).toBe(true);
  });
});

describe("extractUazapiDeletion (Deleted)", () => {
  it("devolve os ids apagados", () => {
    expect(
      extractUazapiDeletion({
        EventType: "messages_update",
        event: { Type: "Deleted", MessageIDs: ["A", "B"] },
      })
    ).toEqual(["A", "B"]);
  });

  it("aceita a variação de caixa do provedor", () => {
    expect(
      extractUazapiDeletion({
        EventType: "messages_update",
        event: { Type: "deleted", MessageIDs: ["A"] },
      })
    ).toEqual(["A"]);
  });

  it("outros tipos de update NÃO viram apagamento", () => {
    for (const Type of ["Read", "Delivered", "FileDownloaded", "Sent", "Error"]) {
      expect(
        extractUazapiDeletion({
          EventType: "messages_update",
          event: { Type, MessageIDs: ["A"] },
        })
      ).toBeNull();
    }
  });

  it("ignora evento sem id — apagaria tudo ou nada", () => {
    expect(
      extractUazapiDeletion({ EventType: "messages_update", event: { Type: "Deleted" } })
    ).toBeNull();
    expect(
      extractUazapiDeletion({
        EventType: "messages_update",
        event: { Type: "Deleted", MessageIDs: [] },
      })
    ).toBeNull();
  });

  it("ignora evento que não é messages_update", () => {
    expect(
      extractUazapiDeletion({
        EventType: "messages",
        event: { Type: "Deleted", MessageIDs: ["A"] },
      })
    ).toBeNull();
  });
});

describe("helpers", () => {
  it("uazapiEventType", () => {
    expect(uazapiEventType({ EventType: "messages" })).toBe("messages");
    expect(uazapiEventType({})).toBe("");
  });

  it("getUazapiMessage acha em message/data", () => {
    expect(getUazapiMessage({ message: { id: "a" } })?.id).toBe("a");
    expect(getUazapiMessage({ data: { id: "b" } })?.id).toBe("b");
    expect(getUazapiMessage({})).toBeNull();
  });
});

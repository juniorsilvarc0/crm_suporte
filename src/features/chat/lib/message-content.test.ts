import { describe, expect, it } from "vitest";

import {
  buildMessageLinkPreview,
  splitMessageEntities,
} from "@/features/chat/lib/message-content";

describe("splitMessageEntities", () => {
  it("separa URL e telefone sem perder o texto ao redor", () => {
    expect(
      splitMessageEntities(
        "Veja https://github.com/openai/codex e fale no +55 (11) 99000-0001."
      )
    ).toEqual([
      { type: "text", value: "Veja " },
      {
        type: "url",
        value: "https://github.com/openai/codex",
        href: "https://github.com/openai/codex",
      },
      { type: "text", value: " e fale no " },
      {
        type: "phone",
        value: "+55 (11) 99000-0001",
        phone: "+55 (11) 99000-0001",
      },
      { type: "text", value: "." },
    ]);
  });

  it("não transforma data, horário nem protocolo curto em telefone", () => {
    expect(splitMessageEntities("06/08/2026 às 22:15, protocolo 12345678")).toEqual([
      { type: "text", value: "06/08/2026 às 22:15, protocolo 12345678" },
    ]);
  });
});

describe("buildMessageLinkPreview", () => {
  it("combina a URL do texto com metadados do extendedTextMessage", () => {
    expect(
      buildMessageLinkPreview("Confira https://github.com/", {
        extendedTextMessage: {
          matchedText: "https://github.com/",
          title: "GitHub · A mudança é constante",
          description: "Plataforma de desenvolvimento",
          jpegThumbnail: "aGVsbG8=",
        },
      })
    ).toEqual({
      url: "https://github.com/",
      siteName: "github.com",
      title: "GitHub · A mudança é constante",
      description: "Plataforma de desenvolvimento",
      imageUrl: "data:image/jpeg;base64,aGVsbG8=",
    });
  });

  it("gera preview mínimo quando o provedor não devolve metadados", () => {
    expect(buildMessageLinkPreview("https://github.com/")).toEqual({
      url: "https://github.com/",
      siteName: "github.com",
    });
  });

  it("ignora esquemas que não são web", () => {
    expect(buildMessageLinkPreview("javascript:alert(1)")).toBeNull();
  });

  it("ignora imagem data executável recebida no metadata", () => {
    expect(
      buildMessageLinkPreview("https://example.com", {
        imageUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      })
    ).toEqual({
      url: "https://example.com/",
      siteName: "example.com",
    });
  });
});

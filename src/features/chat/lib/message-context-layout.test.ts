import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MessageBubble } from "@/features/chat/components/message-bubble";
import { getMessageContextLayout } from "@/features/chat/lib/message-context-layout";
import type { ChatMessage } from "@/features/chat/types";

const anchor = {
  top: 180,
  left: 0,
  width: 390,
  height: 52,
};

describe("getMessageContextLayout", () => {
  it("mantém a mensagem no lugar e alinha o menu recebido à esquerda", () => {
    expect(
      getMessageContextLayout({
        anchor,
        direction: "inbound",
        panelHeight: 290,
        viewportHeight: 844,
        viewportWidth: 390,
      })
    ).toMatchObject({
      clusterTop: 180,
      panelLeft: 18,
      panelWidth: 264,
    });
  });

  it("alinha o menu enviado à direita", () => {
    expect(
      getMessageContextLayout({
        anchor,
        direction: "outbound",
        panelHeight: 290,
        viewportHeight: 844,
        viewportWidth: 390,
      }).panelLeft
    ).toBe(108);
  });

  it("eleva o conjunto para o menu continuar abaixo da mensagem", () => {
    expect(
      getMessageContextLayout({
        anchor: { ...anchor, top: 720 },
        direction: "inbound",
        panelHeight: 290,
        viewportHeight: 844,
        viewportWidth: 390,
      }).clusterTop
    ).toBe(474);
  });

  it("reduz a largura em telas estreitas sem encostar nas bordas", () => {
    expect(
      getMessageContextLayout({
        anchor: { ...anchor, width: 280 },
        direction: "outbound",
        panelHeight: 290,
        viewportHeight: 653,
        viewportWidth: 280,
      })
    ).toMatchObject({
      panelLeft: 18,
      panelWidth: 244,
    });
  });

  it("mantém o painel dentro da coluna do chat em uma tela larga com toque", () => {
    expect(
      getMessageContextLayout({
        anchor: { ...anchor, left: 500, width: 600 },
        direction: "outbound",
        panelHeight: 290,
        viewportHeight: 900,
        viewportWidth: 1200,
      }).panelLeft
    ).toBe(318);
  });

  it("limita a mensagem longa e mantém o menu dentro de uma tela baixa", () => {
    expect(
      getMessageContextLayout({
        anchor: { ...anchor, top: 520, height: 900 },
        direction: "inbound",
        panelHeight: 349,
        viewportHeight: 667,
        viewportWidth: 390,
      })
    ).toMatchObject({
      clusterTop: 18,
      messageHeight: 283,
      panelMaxHeight: 338,
    });
  });

  it("mantém o limite da mensagem longa mesmo com poucas ações", () => {
    expect(
      getMessageContextLayout({
        anchor: { ...anchor, height: 900 },
        direction: "inbound",
        panelHeight: 124,
        viewportHeight: 667,
        viewportWidth: 390,
      }).messageHeight
    ).toBe(283);
  });
});

describe("MessageBubble", () => {
  it("quebra texto colado sem espaços dentro da largura da bolha", () => {
    const longToken = `https://exemplo.com/${"segmento".repeat(40)}`;
    const message: ChatMessage = {
      id: "message-long-text",
      conversation_id: "conversation-1",
      external_id: null,
      direction: "inbound",
      type: "text",
      content: longToken,
      media_url: null,
      media_mime_type: null,
      quoted_message_id: null,
      delivery_status: "read",
      sent_by_user_id: null,
      is_deleted: false,
      metadata: {},
      created_at: "2026-08-06T21:00:00.000Z",
    };

    const { container } = render(createElement(MessageBubble, { message }));
    const row = container.querySelector(`[data-message-id="${message.id}"]`);
    const bubble = row?.firstElementChild;
    const paragraph = screen.getByText(longToken).closest("p");
    const formattedText = paragraph?.querySelector("span");

    expect(bubble).toHaveClass("min-w-0");
    expect(paragraph).toHaveClass("min-w-0", "[overflow-wrap:anywhere]");
    expect(formattedText).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("mostra o card de preview antes do link da mensagem", () => {
    const message: ChatMessage = {
      id: "message-link-preview",
      conversation_id: "conversation-1",
      external_id: "wa-link-1",
      direction: "outbound",
      type: "text",
      content: "Confira https://github.com/",
      media_url: null,
      media_mime_type: null,
      quoted_message_id: null,
      delivery_status: "read",
      sent_by_user_id: null,
      is_deleted: false,
      metadata: {
        linkPreview: {
          url: "https://github.com/",
          siteName: "github.com",
          title: "GitHub · A mudança é constante",
          description: "Plataforma de desenvolvimento",
        },
      },
      created_at: "2026-08-06T22:54:00.000Z",
    };

    render(createElement(MessageBubble, { message }));

    expect(
      screen.getByRole("link", { name: "Abrir preview de github.com" })
    ).toBeInTheDocument();
    expect(screen.getByText("GitHub · A mudança é constante")).toBeInTheDocument();
    expect(screen.getByText("Plataforma de desenvolvimento")).toBeInTheDocument();
  });
});

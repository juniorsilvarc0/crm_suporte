import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocumentMessageCard } from "@/features/chat/components/document-message-card";
import {
  getDocumentMessagePresentation,
  type DocumentMessagePresentation,
} from "@/features/chat/lib/document-message";
import type { ChatMessage } from "@/features/chat/types";

function documentMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "doc-1",
    conversation_id: "conv-1",
    external_id: "wa-1",
    direction: "inbound",
    type: "document",
    content: null,
    media_url: "https://media.example.com/chat/arquivo.pdf",
    media_mime_type: "application/pdf",
    quoted_message_id: null,
    delivery_status: "delivered",
    sent_by_user_id: null,
    is_deleted: false,
    metadata: {},
    created_at: "2026-08-11T12:00:00.000Z",
    ...overrides,
  };
}

describe("getDocumentMessagePresentation", () => {
  it("separa nome, extensão, tamanho e legenda gravados no envio", () => {
    const presentation = getDocumentMessagePresentation(
      documentMessage({
        content: "Resultado dos exames",
        media_mime_type: "application/pdf",
        metadata: { fileName: "exame final.pdf", fileSize: 1_572_864 },
      })
    );

    expect(presentation).toEqual({
      fileName: "exame final.pdf",
      extension: "PDF",
      sizeLabel: "1.5 MB",
      caption: "Resultado dos exames",
    });
  });

  it("usa o conteúdo legado como nome sem duplicá-lo como legenda", () => {
    const presentation = getDocumentMessagePresentation(
      documentMessage({ content: "pedido médico.docx", media_mime_type: null })
    );

    expect(presentation.fileName).toBe("pedido médico.docx");
    expect(presentation.extension).toBe("DOCX");
    expect(presentation.caption).toBeNull();
  });

  it("cria nome neutro pela extensão do MIME quando o nome não existe", () => {
    const presentation = getDocumentMessagePresentation(
      documentMessage({
        content: null,
        media_mime_type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    );

    expect(presentation.fileName).toBe("Documento.xlsx");
    expect(presentation.extension).toBe("XLSX");
  });

  it("completa o nome gravado quando a extensão existe somente no MIME", () => {
    const presentation = getDocumentMessagePresentation(
      documentMessage({
        metadata: { fileName: "relatório final" },
        media_mime_type: "application/pdf",
      })
    );

    expect(presentation.fileName).toBe("relatório final.pdf");
    expect(presentation.extension).toBe("PDF");
  });

  it("usa a extensão da URL como último recurso", () => {
    const presentation = getDocumentMessagePresentation(
      documentMessage({
        media_url: "https://media.example.com/chat/id-aleatorio.json?download=1",
        media_mime_type: null,
      })
    );

    expect(presentation.fileName).toBe("Documento.json");
    expect(presentation.extension).toBe("JSON");
  });
});

const presentation: DocumentMessagePresentation = {
  fileName: "laudo.pdf",
  extension: "PDF",
  sizeLabel: "820 KB",
  caption: null,
};

describe("DocumentMessageCard", () => {
  it("mostra arquivo, extensão, tamanho e ação de abrir", () => {
    render(
      <DocumentMessageCard
        presentation={presentation}
        url="https://media.example.com/laudo.pdf"
      />
    );

    const link = screen.getByRole("link", { name: "Abrir arquivo laudo.pdf" });
    expect(link).toHaveAttribute("href", "https://media.example.com/laudo.pdf");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("820 KB")).toBeInTheDocument();
  });

  it("não cria link vazio quando a mídia está indisponível", () => {
    render(<DocumentMessageCard presentation={presentation} url={null} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Arquivo indisponível")).toBeInTheDocument();
  });
});

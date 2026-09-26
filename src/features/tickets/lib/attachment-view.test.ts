import { describe, expect, it } from "vitest";

import {
  attachmentFileProblem,
  attachmentPresentation,
  isPreviewableImage,
  mergeAttachments,
  TICKET_ATTACHMENT_UPLOAD_MAX_BYTES,
  ticketAttachmentHref,
  uploadErrorMessage,
} from "@/features/tickets/lib/attachment-view";
import type { TicketAttachment } from "@/features/tickets/types";
import { TICKET_ATTACHMENT_MAX_BYTES } from "@/lib/storage/ticket-attachments";

function attachment(overrides: Partial<TicketAttachment> = {}): TicketAttachment {
  return {
    id: "a1",
    file_name: "relatório.pdf",
    mime: "application/pdf",
    size_bytes: 839_680,
    uploaded_by_user_id: "u1",
    uploaded_by_token_id: null,
    created_at: "2026-09-26T12:00:00+00:00",
    ...overrides,
  };
}

describe("attachment-view", () => {
  it("o teto da tela é o mesmo do bucket e da rota", () => {
    expect(TICKET_ATTACHMENT_UPLOAD_MAX_BYTES).toBe(TICKET_ATTACHMENT_MAX_BYTES);
  });

  it("o arquivo sai pela rota do anexo, nunca por URL do storage", () => {
    expect(ticketAttachmentHref("t1", "a1")).toBe("/api/tickets/t1/attachments/a1");
  });

  it("só miniatura para imagem que o navegador desenha", () => {
    expect(isPreviewableImage("image/png")).toBe(true);
    expect(isPreviewableImage("IMAGE/JPEG; q=1")).toBe(true);
    expect(isPreviewableImage("image/heic")).toBe(false);
    // O HTML/SVG anexado é guardado como binário: vira documento para baixar.
    expect(isPreviewableImage("application/octet-stream")).toBe(false);
  });

  it("monta o cartão do documento com o nome original, a extensão e o tamanho", () => {
    expect(attachmentPresentation(attachment())).toEqual({
      fileName: "relatório.pdf",
      extension: "PDF",
      sizeLabel: "820 KB",
      caption: null,
    });
    // Nome com % não é decodificado como URL.
    expect(attachmentPresentation(attachment({ file_name: "a%20b" })).fileName).toBe("a%20b");
    expect(attachmentPresentation(attachment({ file_name: "arquivo" })).extension).toBeNull();
    expect(attachmentPresentation(attachment({ file_name: "pagina.html" })).extension).toBe("HTML");
  });

  it("recusa antes de enviar o vazio e o grande demais", () => {
    expect(attachmentFileProblem({ size: 0 })).toBe("O arquivo está vazio.");
    expect(attachmentFileProblem({ size: TICKET_ATTACHMENT_UPLOAD_MAX_BYTES + 1 })).toBe(
      "Arquivo muito grande (máx. 50 MB)."
    );
    expect(attachmentFileProblem({ size: TICKET_ATTACHMENT_UPLOAD_MAX_BYTES })).toBeNull();
  });

  it("mensagem do envio: campo, rota, e o status quando o corpo não diz nada", () => {
    expect(
      uploadErrorMessage(400, { ok: false, message: "x", errors: { file: ["Escolha um arquivo."] } })
    ).toBe("Escolha um arquivo.");
    expect(uploadErrorMessage(502, { ok: false, message: "Storage fora." })).toBe("Storage fora.");
    // O 413 do proxy não é JSON.
    expect(uploadErrorMessage(413, null)).toBe("Arquivo muito grande (máx. 50 MB).");
    expect(uploadErrorMessage(502, {})).toBe("Não foi possível guardar o arquivo. Tente de novo.");
    expect(uploadErrorMessage(500, "html")).toBe("Não foi possível anexar o arquivo.");
  });

  it("o que acabou de subir entra na frente, sem repetir quando o servidor o traz", () => {
    const server = [attachment({ id: "old" })];
    const first = attachment({ id: "n1" });
    const second = attachment({ id: "n2" });
    expect(mergeAttachments(server, [first, second]).map((item) => item.id)).toEqual([
      "n2",
      "n1",
      "old",
    ]);
    expect(
      mergeAttachments([first, ...server], [first]).map((item) => item.id)
    ).toEqual(["n1", "old"]);
  });
});

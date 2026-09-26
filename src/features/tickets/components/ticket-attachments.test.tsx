import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, toastSuccess } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

import { TicketAttachments } from "@/features/tickets/components/ticket-attachments";
import type { TicketAttachment } from "@/features/tickets/types";

const TICKET = "0b0e8f4c-3d1a-4a55-9d5e-1c2b3a4d5e6f";

function attachment(overrides: Partial<TicketAttachment> = {}): TicketAttachment {
  return {
    id: "a1",
    file_name: "nota-fiscal.pdf",
    mime: "application/pdf",
    size_bytes: 839_680,
    uploaded_by_user_id: "u1",
    uploaded_by_token_id: null,
    created_at: "2026-09-26T12:00:00+00:00",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(respond: () => Response) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
    respond()
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setup(attachments: TicketAttachment[] | null) {
  const view = render(<TicketAttachments ticketId={TICKET} attachments={attachments} />);
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("sem input de arquivo");
  return { ...view, input, user: userEvent.setup() };
}

function file(name: string, type: string, size?: number) {
  const created = new File(["conteúdo"], name, { type });
  if (size !== undefined) Object.defineProperty(created, "size", { value: size });
  return created;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("TicketAttachments", () => {
  it("documento é o cartão do chat, com o link pela rota do anexo", () => {
    setup([attachment()]);

    const link = screen.getByRole("link", { name: "Abrir arquivo nota-fiscal.pdf" });
    expect(link).toHaveAttribute("href", `/api/tickets/${TICKET}/attachments/a1`);
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("820 KB")).toBeInTheDocument();
  });

  it("imagem abre no lightbox, com a rota do anexo como miniatura", () => {
    setup([attachment({ id: "img", file_name: "erro.png", mime: "image/png", size_bytes: 2048 })]);

    const button = screen.getByRole("button", { name: "Ampliar imagem" });
    expect(within(button).getByRole("img", { name: "erro.png" })).toHaveAttribute(
      "src",
      `/api/tickets/${TICKET}/attachments/img`
    );
    expect(screen.getByText("erro.png")).toBeInTheDocument();
  });

  it("HTML guardado como binário vai como documento para baixar", () => {
    setup([attachment({ file_name: "pagina.html", mime: "application/octet-stream" })]);
    expect(screen.getByRole("link", { name: "Abrir arquivo pagina.html" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ampliar imagem" })).toBeNull();
  });

  it("vazio e falha são estados diferentes, e o envio fica nos dois", async () => {
    const { unmount } = setup([]);
    expect(screen.getByText("Nenhum anexo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anexar arquivo" })).toBeInTheDocument();
    unmount();

    const { user } = setup(null);
    expect(screen.getByText("Não foi possível carregar os anexos.")).toBeInTheDocument();
    expect(screen.queryByText("Nenhum anexo.")).toBeNull();
    expect(screen.getByRole("button", { name: "Anexar arquivo" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("envia multipart no campo file, mostra o anexo na hora e recarrega", async () => {
    const created = attachment({ id: "novo", file_name: "log.txt", mime: "text/plain", size_bytes: 512 });
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, attachment: created }, 201));
    const { input, user } = setup([attachment()]);

    const upload = file("log.txt", "text/plain");
    await user.upload(input, upload);

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Abrir arquivo log.txt" })).toBeInTheDocument()
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/tickets/${TICKET}/attachments`);
    expect(init?.method).toBe("POST");
    expect((init?.body as FormData).get("file")).toBe(upload);
    // O mais novo na frente, como a lista do servidor.
    const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links).toEqual([
      `/api/tickets/${TICKET}/attachments/novo`,
      `/api/tickets/${TICKET}/attachments/a1`,
    ]);
    expect(toastSuccess).toHaveBeenCalledWith("Arquivo anexado.");
    expect(refreshMock).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Anexar arquivo" })).toBeEnabled();
  });

  it("arquivo acima do teto nem sai do navegador", async () => {
    const fetchMock = stubFetch(() => jsonResponse({}));
    const { input, user } = setup([]);

    await user.upload(input, file("video.mp4", "video/mp4", 51 * 1024 * 1024));

    expect(screen.getByRole("alert")).toHaveTextContent("Arquivo muito grande (máx. 50 MB).");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("erro da rota vira frase legível, inclusive o 413 do proxy sem JSON", async () => {
    stubFetch(() => new Response("<html>413</html>", { status: 413 }));
    const { input, user } = setup([]);
    await user.upload(input, file("a.pdf", "application/pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Arquivo muito grande (máx. 50 MB).");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("502 do storage pede para tentar de novo", async () => {
    stubFetch(() =>
      jsonResponse({ ok: false, message: "Não foi possível guardar o arquivo. Tente de novo." }, 502)
    );
    const { input, user } = setup([]);
    await user.upload(input, file("a.pdf", "application/pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível guardar o arquivo. Tente de novo."
    );
  });
});

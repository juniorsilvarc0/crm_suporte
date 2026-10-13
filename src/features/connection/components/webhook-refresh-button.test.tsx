import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { toastMock } = vi.hoisted(() => ({ toastMock: { success: vi.fn(), error: vi.fn() } }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { WebhookRefreshButton } from "@/features/connection/components/webhook-refresh-button";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => Response.json({ ok: true, events: ["messages", "messages_update", "connection"] }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("WebhookRefreshButton", () => {
  it("recadastra pelo POST da rota e confirma que a conexão não foi tocada", async () => {
    const user = userEvent.setup();
    render(<WebhookRefreshButton />);

    await user.click(screen.getByRole("button", { name: "Atualizar cadastro do webhook" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/connection/webhook", { method: "POST" });
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("Cadastro do webhook atualizado. A conexão não foi tocada.")
    );
  });

  it("recusa do servidor: o motivo que ele devolveu; falha de rede: a mensagem padrão", async () => {
    const user = userEvent.setup();
    render(<WebhookRefreshButton />);

    fetchMock.mockResolvedValueOnce(
      Response.json({ ok: false, message: "A uazapi não aceitou o cadastro do webhook. Tente de novo." }, { status: 502 })
    );
    await user.click(screen.getByRole("button", { name: "Atualizar cadastro do webhook" }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("A uazapi não aceitou o cadastro do webhook. Tente de novo.")
    );

    fetchMock.mockRejectedValueOnce(new TypeError("rede"));
    await user.click(screen.getByRole("button", { name: "Atualizar cadastro do webhook" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Não foi possível atualizar o cadastro do webhook."));
  });

  it("fica desabilitado enquanto o pedido corre", async () => {
    let release: (value: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (release = resolve)));
    const user = userEvent.setup();
    render(<WebhookRefreshButton />);

    await user.click(screen.getByRole("button", { name: "Atualizar cadastro do webhook" }));
    expect(screen.getByRole("button", { name: "Atualizar cadastro do webhook" })).toBeDisabled();
    release(Response.json({ ok: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Atualizar cadastro do webhook" })).toBeEnabled());
  });
});

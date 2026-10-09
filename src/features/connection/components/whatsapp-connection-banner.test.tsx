import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import { WhatsappConnectionBanner } from "@/features/connection/components/whatsapp-connection-banner";
import type { ConnectionStatus } from "@/features/connection/types";

function stubStatus(...statuses: ConnectionStatus[]) {
  const fetchMock = vi.fn(async () => {
    const next = statuses.length > 1 ? statuses.shift() : statuses[0];
    return Response.json({ ok: true, status: next });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const DOWN: ConnectionStatus = {
  configured: true,
  current: { state: "close", reason: "logged out", occurredAt: "2026-10-08T19:07:00.000Z" },
};
const UP: ConnectionStatus = {
  configured: true,
  current: { state: "open", reason: null, occurredAt: "2026-10-09T10:54:00.000Z" },
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--app-alert-height");
});

describe("WhatsappConnectionBanner", () => {
  it("desconectado: avisa desde quando, que as mensagens não chegam e o motivo; o admin ganha o link", async () => {
    const fetchMock = stubStatus(DOWN);
    render(<WhatsappConnectionBanner isAdmin />);

    const alert = await screen.findByRole("alert");
    expect(fetchMock).toHaveBeenCalledWith("/api/connection/status", { cache: "no-store" });
    expect(alert).toHaveTextContent("WhatsApp desconectado desde 08/10/2026 16:07.");
    expect(alert).toHaveTextContent("As mensagens dos clientes não estão chegando ao CRM.");
    expect(alert).toHaveTextContent("Motivo informado: logged out.");
    expect(screen.getByRole("link", { name: "Reconectar em Integrações" })).toHaveAttribute("href", "/app/conexao");
  });

  it("o analista não ganha link (a tela é de admin): ganha o recado", async () => {
    stubStatus(DOWN);
    render(<WhatsappConnectionBanner isAdmin={false} />);

    expect(await screen.findByText("Avise um administrador.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it.each<[string, ConnectionStatus]>([
    ["conectado", UP],
    ["provedor sem resposta (não dá para afirmar a queda)", {
      configured: true,
      current: { state: "unknown", reason: "o provedor não respondeu", occurredAt: "2026-10-09T10:00:00.000Z" },
    }],
    ["sem instância", { configured: false }],
    ["monitor ainda sem leitura", { configured: true, current: null }],
  ])("%s: nenhum aviso", async (_, status) => {
    const fetchMock = stubStatus(status);
    render(<WhatsappConnectionBanner isAdmin />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("esperando o QR também é desconectado", async () => {
    stubStatus({ configured: true, current: { state: "connecting", reason: null, occurredAt: "2026-10-09T10:53:00.000Z" } });
    render(<WhatsappConnectionBanner isAdmin />);

    expect(await screen.findByRole("alert")).toHaveTextContent("WhatsApp desconectado desde 09/10/2026 07:53.");
  });

  it("consulta de novo a cada minuto e some quando a conexão volta, limpando a altura publicada", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubStatus(DOWN, UP);
    render(<WhatsappConnectionBanner isAdmin />);

    await screen.findByRole("alert");
    expect(document.documentElement.style.getPropertyValue("--app-alert-height")).not.toBe("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(document.documentElement.style.getPropertyValue("--app-alert-height")).toBe("");
  });
});

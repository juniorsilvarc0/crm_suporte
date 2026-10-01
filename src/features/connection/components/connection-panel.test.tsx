import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ConnectionPanel } from "@/features/connection/components/connection-panel";

// O pedido do QR age no provedor (inicia o pareamento). Estes testes cobrem só
// isso: quando a tela o faz, e com que método.

const QR = "data:image/png;base64,QR";
const QR_URL = "/api/connection/qr";

let state: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;

const qrCalls = () => fetchMock.mock.calls.filter(([url]) => url === QR_URL);
const originalMatchMedia = window.matchMedia;

// O Dialog (os diálogos de desconectar e de excluir) decide entre caixa e gaveta pela largura.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((media: string) => ({
      matches: false,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

beforeEach(() => {
  state = { ok: true, configured: true, state: "close", connected: false, instance: "5511999990000" };
  fetchMock = vi.fn(async (url: string) =>
    url === QR_URL
      ? Response.json({ ok: true, configured: true, qrcode: QR, pairingCode: "ABCD-1234", connected: false })
      : Response.json(state)
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConnectionPanel: o pedido do QR", () => {
  it("ao reconectar, pede o QR por POST e o mostra", async () => {
    const user = userEvent.setup();
    render(<ConnectionPanel />);

    await user.click(await screen.findByRole("button", { name: "Reconectar" }));

    expect(await screen.findByAltText("QR Code para conectar o WhatsApp")).toHaveAttribute("src", QR);
    expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
    // POST: a rota não existe por GET, e a trava de origem do proxy só cobre escrita.
    expect(qrCalls()).toEqual([[QR_URL, { method: "POST" }]]);
  });

  it("salvar as credenciais não manda dois pedidos de QR ao mesmo tempo, embora dois gatilhos o peçam", async () => {
    const user = userEvent.setup();
    state = { ok: true, configured: false, state: "unknown", connected: false, instance: null };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/connection/persist") {
        state = { ok: true, configured: true, state: "close", connected: false, instance: null };
        return Response.json({ ok: true, webhookRegistered: true });
      }
      if (url !== QR_URL) return Response.json(state);
      // O QR demora: o pedido do efeito e o do fim do salvamento se encontram.
      await gate;
      return Response.json({ ok: true, configured: true, qrcode: QR, pairingCode: null, connected: false });
    });
    render(<ConnectionPanel />);

    await user.type(await screen.findByLabelText("URL do servidor"), "https://demo.invalid");
    await user.type(screen.getByLabelText("Token da instância"), "token-de-mentira");
    await user.click(screen.getByRole("button", { name: "Salvar e gerar QR Code" }));
    expect(await screen.findByText("Gerando QR Code…")).toBeInTheDocument();
    release();

    expect(await screen.findByAltText("QR Code para conectar o WhatsApp")).toBeInTheDocument();
    // Cada pedido reinicia o pareamento no provedor: dois em seguida derrubam o primeiro QR.
    expect(qrCalls()).toEqual([[QR_URL, { method: "POST" }]]);
  });

  it("pedido de QR sem resposta legível: o QR e o código de pareamento antigos saem da tela", async () => {
    const user = userEvent.setup();
    render(<ConnectionPanel />);
    await user.click(await screen.findByRole("button", { name: "Reconectar" }));
    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();

    // O que uma aba aberta antes de um deploy recebe ao pedir do jeito antigo: 405, sem corpo.
    fetchMock.mockImplementation(async (url: string) =>
      url === QR_URL ? new Response(null, { status: 405 }) : Response.json(state)
    );
    await user.click(screen.getByRole("button", { name: "Atualizar" }));

    expect(await screen.findByText("Gerando QR Code…")).toBeInTheDocument();
    expect(screen.queryByAltText("QR Code para conectar o WhatsApp")).not.toBeInTheDocument();
    expect(screen.queryByText("ABCD-1234")).not.toBeInTheDocument();
  });

  describe("ao longo do tempo (o QR vence a cada 25 s, e o estado é relido a cada 3 s)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // Em passos de 1 s: dentro de um `act` só, o React não aplica o estado novo
    // entre um temporizador e outro, e a tela "conectada" nunca chegaria às refs.
    const passTime = async (ms: number) => {
      for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(Math.min(1000, ms - elapsed));
        });
      }
    };

    it("instância desconectada: a tela não pede QR sozinha, nem quando o prazo do QR vence", async () => {
      render(<ConnectionPanel />);

      await passTime(60_000);

      expect(screen.getByText("Instância desconectada")).toBeInTheDocument();
      expect(qrCalls()).toEqual([]);
    });

    it("instância conectada: a tela não pede QR sozinha", async () => {
      state = { ok: true, configured: true, state: "open", connected: true, instance: "5511999990000" };
      render(<ConnectionPanel />);

      await passTime(60_000);

      expect(screen.getByText("WhatsApp conectado")).toBeInTheDocument();
      expect(qrCalls()).toEqual([]);
    });

    it("pareando: renova o QR quando ele vence, e para de pedir quando a tela vê a instância conectada", async () => {
      render(<ConnectionPanel />);
      await passTime(100);

      // Clique direto: o userEvent espera por um relógio que aqui está parado.
      fireEvent.click(screen.getByRole("button", { name: "Reconectar" }));
      await passTime(100);
      expect(qrCalls()).toHaveLength(1);

      await passTime(25_000);
      expect(qrCalls()).toHaveLength(2);

      // O celular leu o código. Pedir outro QR agora reiniciaria o pareamento.
      state = { ...state, state: "open", connected: true };
      await passTime(60_000);

      expect(screen.getByText("WhatsApp conectado")).toBeInTheDocument();
      expect(qrCalls()).toHaveLength(2);
    });
  });
});

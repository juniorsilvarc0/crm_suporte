import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, toastMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { RelaySigningSettings } from "@/features/settings/components/relay-signing-settings";

// O bloco da chave no CELULAR, onde o diálogo é a gaveta do vaul. Fica num
// arquivo só dele: a largura é lida uma vez por arquivo. O que importa aqui é
// o que a gaveta faz de diferente da caixa: toque fora, arrastar e o X.

const SECRET = "9f2c4e6a8b0d1f3a5c7e9b1d3f5a7c9e0b2d4f6a8c0e1b3d5f7a9c1e3b5d7f90";
const STAMP = "2026-10-01T12:00:00.123456+00:00";
const absent = { state: "absent" } as const;
const configured = { state: "configured", updatedAt: STAMP } as const;
const GENERATE = "O CRM passa a assinar os pedidos ao agente com ela.";
const ROTATE = "Ao confirmar, a chave atual deixa de valer.";

let fetchMock: ReturnType<typeof vi.fn>;
const originalMatchMedia = window.matchMedia;

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((media: string) => ({
      matches: true,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  // O jsdom não tem captura de ponteiro, e o vaul a pede no toque.
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
});

afterAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => Response.json({ ok: true, secret: SECRET, message: "Chave gerada." }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const button = (name: string) => screen.getByRole("button", { name });
const confirm = (name: string) => screen.getAllByRole("button", { name }).at(-1) as HTMLElement;
const dialogs = () => screen.queryAllByRole("dialog");
const closed = () => waitFor(() => expect(dialogs()).toHaveLength(0));
const overlay = () => document.querySelector('[data-slot="drawer-overlay"]') as HTMLElement;
const drawer = () => document.querySelector('[data-slot="drawer-content"]') as HTMLElement;
function gated() {
  let release: (response: Response) => void = () => undefined;
  fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (release = resolve)));
  return (response: Response) => release(response);
}

describe("RelaySigningSettings na gaveta (celular)", () => {
  it("é mesmo a gaveta do vaul", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={absent} />);

    await user.click(button("Gerar chave"));
    await screen.findByText(GENERATE);

    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
  });

  it("a confirmação fecha com um toque fora, sem gerar nada", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={absent} />);

    await user.click(button("Gerar chave"));
    await screen.findByText(GENERATE);
    // Sem pedido em curso a gaveta é a comum: arrasta e fecha.
    expect(drawer()).not.toHaveAttribute("data-locked");
    await user.click(overlay());

    await closed();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("com a chave à vista, um toque fora NÃO fecha a gaveta: a chave só aparece uma vez", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={absent} />);

    await user.click(button("Gerar chave"));
    await screen.findByText(GENERATE);
    await user.click(confirm("Gerar chave"));
    await screen.findByText(SECRET);
    // Travada: nem arrastar leva a chave embora.
    expect(drawer()).toHaveAttribute("data-locked");
    await user.click(overlay());

    expect(screen.getByText(SECRET)).toBeInTheDocument();
    expect(dialogs()).toHaveLength(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("com a chave à vista, o X e o Concluir fecham, e só então o estado é relido", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={absent} />);

    await user.click(button("Gerar chave"));
    await screen.findByText(GENERATE);
    await user.click(confirm("Gerar chave"));
    await screen.findByText(SECRET);
    await user.click(button("Fechar"));

    await closed();
    expect(document.body.textContent).not.toContain(SECRET);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("com a troca em curso, nem o toque fora nem o X fecham a gaveta, e a chave nova aparece nela", async () => {
    const user = userEvent.setup();
    const release = gated();
    render(<RelaySigningSettings signing={configured} />);

    await user.click(button("Gerar nova chave"));
    await screen.findByText(ROTATE);
    await user.click(confirm("Gerar nova chave"));

    expect(button("Cancelar")).toBeDisabled();
    // Travada enquanto o pedido corre: um arrasto recusado deixaria a folha
    // deslocada, e o toque seguinte a fecharia com a chave nova dentro.
    expect(drawer()).toHaveAttribute("data-locked");
    await user.click(overlay());
    await user.click(button("Fechar"));
    await user.keyboard("{Escape}");
    expect(screen.getByText(ROTATE)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(Response.json({ ok: true, secret: SECRET }));

    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(dialogs()).toHaveLength(1);
    expect(drawer()).toHaveAttribute("data-locked");
  });

  it("depois da troca, o foco vai para o botão de copiar", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={configured} />);

    await user.click(button("Gerar nova chave"));
    await screen.findByText(ROTATE);
    await user.click(confirm("Gerar nova chave"));
    await screen.findByText(SECRET);

    await waitFor(() => expect(button("Copiar chave")).toHaveFocus());
  });
});

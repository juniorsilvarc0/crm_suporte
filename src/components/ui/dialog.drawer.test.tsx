import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// O Dialog no CELULAR: a gaveta do vaul. Fica num arquivo só dele porque a
// largura é lida uma vez por arquivo (`useMediaQuery` guarda a consulta).

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

function Modal({
  dismissible,
  onOpenChange,
}: {
  dismissible?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open dismissible={dismissible} onOpenChange={(open) => onOpenChange(open)}>
      <DialogContent>
        <DialogTitle>Chave gerada</DialogTitle>
        <p>Conteúdo</p>
      </DialogContent>
    </Dialog>
  );
}

const overlay = () => document.querySelector('[data-slot="drawer-overlay"]') as HTMLElement;
const drawer = () => document.querySelector('[data-slot="drawer-content"]') as HTMLElement;
const closeButton = () => screen.getByRole("button", { name: "Fechar" });

describe("Dialog como gaveta (celular)", () => {
  it("é a gaveta do vaul, e não a caixa do desktop", () => {
    render(<Modal onOpenChange={vi.fn()} />);

    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
  });

  it("padrão: o toque fora, o Esc e o X pedem o fechamento a quem abriu", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Modal onOpenChange={onOpenChange} />);

    await user.click(overlay());
    await user.keyboard("{Escape}");
    await user.click(closeButton());

    expect(onOpenChange.mock.calls).toEqual([[false], [false], [false]]);
    expect(drawer()).not.toHaveAttribute("data-locked");
  });

  it("`dismissible={false}`: nem o toque fora nem o Esc pedem o fechamento (a gaveta não é arrastada nem fechada por dentro)", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Modal dismissible={false} onOpenChange={onOpenChange} />);

    await user.click(overlay());
    await user.keyboard("{Escape}");

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText("Conteúdo")).toBeInTheDocument();
    // O arrasto não é observável no jsdom: o atributo diz que a gaveta está travada.
    expect(drawer()).toHaveAttribute("data-locked");
  });

  it("`dismissible={false}`: o X continua pedindo o fechamento a QUEM ABRIU (pelo vaul o pedido seria engolido)", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Modal dismissible={false} onOpenChange={onOpenChange} />);

    await user.click(closeButton());

    expect(onOpenChange.mock.calls).toEqual([[false]]);
  });

  it("recusar o X na gaveta travada a deixa aberta e inteira", async () => {
    const user = userEvent.setup();
    // Quem abriu recusa (um pedido em curso): não muda o `open`.
    render(<Modal dismissible={false} onOpenChange={() => undefined} />);

    await user.click(closeButton());

    expect(screen.getByRole("dialog", { name: "Chave gerada" })).toBeInTheDocument();
    expect(screen.getByText("Conteúdo")).toBeInTheDocument();
  });
});

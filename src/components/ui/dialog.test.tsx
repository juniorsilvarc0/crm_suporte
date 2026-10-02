import { useRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

const originalMatchMedia = window.matchMedia;

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
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
  });
});

function ContainedSheet() {
  const conversationRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={conversationRef} data-testid="conversation-area">
      <Dialog variant="dialog" open>
        <DialogContent
          presentation="sheet"
          portalContainer={conversationRef}
          showCloseButton={false}
        >
          <DialogTitle>Enviar anexo</DialogTitle>
          <p>Conteúdo</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

describe("DialogContent sheet", () => {
  it("fica contido na área informada e entra pela direita", () => {
    render(<ContainedSheet />);

    const conversation = screen.getByTestId("conversation-area");
    const sheet = screen.getByRole("dialog", { name: "Enviar anexo" });
    const portal = conversation.querySelector("[data-slot='dialog-portal']");
    const overlay = conversation.querySelector("[data-slot='dialog-overlay']");

    expect(conversation).toContainElement(sheet);
    expect(portal).toHaveClass(
      "absolute",
      "inset-0",
      "overflow-hidden",
      "pointer-events-none"
    );
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass(
      "absolute",
      "pointer-events-auto",
      "data-closed:pointer-events-none"
    );
    expect(overlay).not.toHaveClass("fixed");
    expect(sheet).toHaveClass(
      "absolute",
      "inset-0",
      "pointer-events-auto",
      "data-closed:pointer-events-none",
      "data-open:slide-in-from-right"
    );
    expect(sheet).not.toHaveClass("fixed");
  });
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

// No desktop (este arquivo), quem recusa um fechamento é o `onOpenChange` de
// quem abriu. `dismissible={false}` só tira o clique fora: o Esc e o X continuam
// chegando a quem abriu, que decide. A gaveta está em dialog.drawer.test.tsx.
describe("Dialog `dismissible` (desktop)", () => {
  const overlay = () => document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;

  it("padrão: clique fora, Esc e o X pedem o fechamento a quem abriu", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Modal onOpenChange={onOpenChange} />);

    await user.click(overlay());
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Fechar" }));

    expect(onOpenChange.mock.calls).toEqual([[false], [false], [false]]);
  });

  it("`dismissible={false}`: o clique fora não pede nada; o Esc e o X pedem", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Modal dismissible={false} onOpenChange={onOpenChange} />);

    await user.click(overlay());
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onOpenChange.mock.calls).toEqual([[false], [false]]);
  });
});

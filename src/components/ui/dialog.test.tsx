import { useRef } from "react";
import { render, screen } from "@testing-library/react";
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

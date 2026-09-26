import { useRef, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { FilePreviewDialog } from "@/features/chat/components/file-preview-dialog";
import type { AttachmentDraft } from "@/features/chat/lib/attachment-batch";

const originalMatchMedia = window.matchMedia;
const originalGetAnimations = HTMLElement.prototype.getAnimations;
let animationFinished: Promise<void>;
let finishAnimation: (() => void) | undefined;

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

  // Mantém a animação de entrada em curso para observar o primeiro foco.
  // O navegador expõe `getAnimations`; o jsdom não implementa essa API.
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value: () => [{ finished: animationFinished }],
  });
});

beforeEach(() => {
  animationFinished = new Promise<void>((resolve) => {
    finishAnimation = resolve;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
  });
  if (originalGetAnimations) {
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
      configurable: true,
      value: originalGetAnimations,
    });
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
  }
});

function PreviewHarness() {
  const conversationRef = useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>(() => [
    {
      id: "relatorio",
      file: new File(["conteúdo"], "relatorio.pdf", {
        type: "application/pdf",
      }),
      caption: "",
    },
  ]);

  return (
    <div ref={conversationRef} data-testid="conversation-area">
      <FilePreviewDialog
        attachments={attachments}
        portalContainer={conversationRef}
        contactName="Maria"
        progress={null}
        error={null}
        onAdd={vi.fn()}
        onRemove={(id) =>
          setAttachments((current) => current.filter((item) => item.id !== id))
        }
        onCaptionChange={(id, caption) =>
          setAttachments((current) =>
            current.map((item) => (item.id === id ? { ...item, caption } : item))
          )
        }
        onCancel={vi.fn()}
        onSend={vi.fn()}
      />
    </div>
  );
}

function MultiplePreviewHarness({
  onSend,
}: {
  onSend: (attachments: AttachmentDraft[]) => void;
}) {
  const conversationRef = useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>(() => [
    {
      id: "pedido",
      file: new File(["pedido"], "pedido.pdf", { type: "application/pdf" }),
      caption: "",
    },
    {
      id: "relatorio",
      file: new File(["relatorio"], "relatorio.pdf", { type: "application/pdf" }),
      caption: "",
    },
  ]);

  return (
    <div ref={conversationRef}>
      <FilePreviewDialog
        attachments={attachments}
        portalContainer={conversationRef}
        contactName="Maria"
        progress={null}
        error={null}
        onAdd={vi.fn()}
        onRemove={(id) =>
          setAttachments((current) => current.filter((item) => item.id !== id))
        }
        onCaptionChange={(id, caption) =>
          setAttachments((current) =>
            current.map((item) => (item.id === id ? { ...item, caption } : item))
          )
        }
        onCancel={vi.fn()}
        onSend={() => onSend(attachments)}
      />
    </div>
  );
}

describe("FilePreviewDialog", () => {
  it("deve focar o painel sem rolar a página durante a entrada", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    render(<PreviewHarness />);

    const sheet = screen.getByRole("dialog", {
      name: "Enviar relatorio.pdf para Maria",
    });

    await waitFor(() => expect(focus).toHaveBeenCalled());

    expect(focus.mock.instances[0]).toBe(sheet);
    expect(focus.mock.calls[0]?.[0]).toEqual({ preventScroll: true });

    finishAnimation?.();
    const caption = screen.getByRole("textbox", { name: "Legenda do anexo" });
    await waitFor(() => expect(caption).toHaveFocus());

    const captionFocusIndex = focus.mock.instances.findIndex(
      (instance) => instance === caption
    );
    expect(captionFocusIndex).toBeGreaterThan(0);
    expect(focus.mock.calls[captionFocusIndex]?.[0]).toEqual({
      preventScroll: true,
    });
  });

  it("mantém uma legenda independente para cada anexo", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MultiplePreviewHarness onSend={onSend} />);

    finishAnimation?.();
    const caption = screen.getByRole("textbox", { name: "Legenda do anexo" });
    await user.type(caption, "Ordem de serviço");
    await user.click(screen.getByRole("button", { name: "Selecionar relatorio.pdf" }));
    await user.type(caption, "Relatório recente");
    await user.click(screen.getByRole("button", { name: "Enviar 2 anexos" }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ id: "pedido", caption: "Ordem de serviço" }),
      expect.objectContaining({ id: "relatorio", caption: "Relatório recente" }),
    ]);
  });
});

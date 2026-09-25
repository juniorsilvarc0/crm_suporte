import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SaleDialog } from "@/features/financeiro/components/sale-dialog";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const originalMatchMedia = window.matchMedia;
const originalFetch = global.fetch;
const originalSetPointerCapture = Element.prototype.setPointerCapture;
const originalReleasePointerCapture = Element.prototype.releasePointerCapture;

beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((media: string) => ({
      matches: media === "(max-width: 639px)",
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
  Element.prototype.setPointerCapture = originalSetPointerCapture;
  Element.prototype.releasePointerCapture = originalReleasePointerCapture;
  global.fetch = originalFetch;
});

describe("SaleDialog no celular", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("seleciona procedimento e pagamento dentro da gaveta", async () => {
    const user = userEvent.setup();
    render(
      <SaleDialog
        open
        onOpenChange={vi.fn()}
        lead={{ id: "lead-1", name: "João", phone: "5586999999999" }}
        procedures={[
          {
            id: "procedure-1",
            name: "Consulta",
            defaultAmount: 650,
          },
        ]}
      />
    );

    const drawer = document.querySelector<HTMLElement>("[data-slot='drawer-content']");
    expect(drawer).not.toBeNull();

    await user.click(screen.getByRole("combobox", { name: /Procedimento/ }));
    const procedureOption = await screen.findByRole("option", { name: /Consulta/ });
    expect(drawer).toContainElement(procedureOption);
    expect(procedureOption.closest("[data-slot='combobox-popup']")).toHaveClass(
      "overscroll-contain",
      "max-h-[min(18rem,var(--available-height))]"
    );
    await user.click(procedureOption);

    expect(screen.getByRole("combobox", { name: /Procedimento/ })).toHaveValue("Consulta");
    expect(screen.getByRole("spinbutton", { name: /Valor/ })).toHaveValue(650);

    await user.click(screen.getByRole("combobox", { name: "Forma de pagamento" }));
    const paymentOption = await screen.findByRole("option", { name: "Dinheiro" });
    expect(drawer).toContainElement(paymentOption);
    expect(paymentOption).toHaveClass("min-h-11");
    expect(paymentOption.closest("[data-slot='select-content']")).toHaveClass(
      "overscroll-contain"
    );
    await user.click(paymentOption);

    expect(
      within(screen.getByRole("combobox", { name: "Forma de pagamento" })).getByText(
        "Dinheiro"
      )
    ).toBeInTheDocument();
  });

  it("cria e seleciona um procedimento novo", async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          procedure: { name: "Cistoscopia", default_amount: 800 },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    render(
      <SaleDialog
        open
        onOpenChange={vi.fn()}
        lead={{ id: "lead-1", name: "João", phone: "5586999999999" }}
        procedures={[]}
      />
    );

    const procedureInput = screen.getByRole("combobox", { name: /Procedimento/ });
    await user.type(procedureInput, "Cistoscopia");
    await user.click(await screen.findByRole("option", { name: /Criar.*Cistoscopia/ }));

    expect(global.fetch).toHaveBeenCalledWith("/api/procedures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cistoscopia" }),
    });
    expect(procedureInput).toHaveValue("Cistoscopia");
    expect(screen.getByRole("spinbutton", { name: /Valor/ })).toHaveValue(800);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

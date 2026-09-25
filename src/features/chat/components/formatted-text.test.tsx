import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { FormattedText } from "@/features/chat/components/formatted-text";

describe("FormattedText", () => {
  it("renderiza URL web como link seguro", () => {
    render(<FormattedText content="Confira https://github.com/." />);

    const link = screen.getByRole("link", { name: "https://github.com/" });
    expect(link).toHaveAttribute("href", "https://github.com/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renderiza telefone escrito como controle de ações", () => {
    render(<FormattedText content="Fale com +55 (11) 99000-0001" />);

    expect(
      screen.getByRole("button", {
        name: "Opções para o telefone +55 (11) 99000-0001",
      })
    ).toBeInTheDocument();
  });

  it("mantém URL dentro de bloco monoespaçado como texto", () => {
    render(<FormattedText content="`https://github.com/`" />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("https://github.com/")).toBeInTheDocument();
  });
});

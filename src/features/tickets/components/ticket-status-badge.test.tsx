import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { TicketStatusBadge } from "@/features/tickets/components/ticket-status-badge";

describe("TicketStatusBadge", () => {
  it("mostra o rótulo e a cor do catálogo", () => {
    render(<TicketStatusBadge status={{ key: "novo", label: "Recebido", color: "rose" }} />);

    const badge = screen.getByText("Recebido").parentElement;
    expect(badge).toHaveAttribute("title", "Recebido");
    expect(badge).toHaveClass("text-rose-700");
    expect(badge).not.toHaveClass("text-sky-700");
  });

  it("sem o catálogo, usa o rótulo e a cor de recurso da chave", () => {
    render(<TicketStatusBadge status={{ key: "aguardando_cliente" }} />);

    const badge = screen.getByText("Aguardando cliente").parentElement;
    expect(badge).toHaveClass("text-amber-700");
  });

  it("rótulo vazio cai no de recurso: o texto nunca some", () => {
    render(<TicketStatusBadge status={{ key: "resolvido", label: "   ", color: "emerald" }} />);

    expect(screen.getByText("Resolvido")).toBeInTheDocument();
  });

  it.each(["neon", "constructor", "toString", ""])(
    "cor fora da paleta (%j) cai na cor de recurso da chave",
    (color) => {
      render(<TicketStatusBadge status={{ key: "novo", label: "Novo", color }} />);

      const badge = screen.getByText("Novo").parentElement;
      expect(badge).toHaveClass("text-sky-700");
    }
  );

  it("é um span com a classe de quem chama", () => {
    render(<TicketStatusBadge status={{ key: "fechado" }} className="ml-2" />);

    const badge = screen.getByText("Fechado").parentElement;
    expect(badge?.tagName).toBe("SPAN");
    expect(badge).toHaveAttribute("data-slot", "badge");
    expect(badge).toHaveClass("ml-2", "max-w-full");
  });
});

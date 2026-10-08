import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { TicketViewSwitch } from "@/features/tickets/components/ticket-view-switch";
import { DEFAULT_TICKET_LIST_FILTERS, type TicketListFilters } from "@/features/tickets/lib/ticket-list-url";

const filters: TicketListFilters = {
  ...DEFAULT_TICKET_LIST_FILTERS,
  prioridade: "alta",
  responsavel: "eu",
  // status/ordem/q só valem na lista: o quadro não os leva.
  status: "resolvidos",
  ordem: "recentes",
  q: "travando",
};

describe("TicketViewSwitch", () => {
  it("na lista, o link do Quadro leva só prioridade/responsável (sem status, busca, ordem)", () => {
    render(<TicketViewSwitch view="lista" filters={filters} />);

    const lista = screen.getByRole("link", { name: /Lista/ });
    const quadro = screen.getByRole("link", { name: /Quadro/ });

    expect(lista).toHaveAttribute("aria-current", "page");
    expect(quadro).not.toHaveAttribute("aria-current");

    const href = quadro.getAttribute("href") ?? "";
    expect(href).toContain("/app/tickets/quadro");
    expect(href).toContain("prioridade=alta");
    expect(href).toContain("responsavel=eu");
    expect(href).not.toContain("status=");
    expect(href).not.toContain("q=");
    expect(href).not.toContain("ordem=");
  });

  it("no quadro, o link da Lista preserva os filtros comuns", () => {
    render(<TicketViewSwitch view="quadro" filters={filters} />);

    const lista = screen.getByRole("link", { name: /Lista/ });
    const quadro = screen.getByRole("link", { name: /Quadro/ });

    expect(quadro).toHaveAttribute("aria-current", "page");
    const href = lista.getAttribute("href") ?? "";
    expect(href).toContain("/app/tickets");
    expect(href).toContain("prioridade=alta");
    expect(href).toContain("responsavel=eu");
  });
});

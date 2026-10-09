import type { AnchorHTMLAttributes } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgendaViewTabs } from "@/features/appointments/components/agenda-view-tabs";
import type { AgendaPeriod, AgendaView } from "@/features/appointments/lib/agenda-view";

// `useLinkStatus` só devolve pendência de verdade dentro do roteador do Next.
// Aqui interessa o comportamento que é nosso: qual aba fica acesa.
vi.mock("next/link", () => ({
  default: ({ children, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      {...props}
      onClick={(event) => {
        // O jsdom não navega: sem isto ele avisa "Not implemented: navigation".
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));

const period = (view: AgendaView): AgendaPeriod => ({ view, monthKey: "2026-08", dateKey: "2026-08-11" });

function tab(name: string) {
  return screen.getByRole("link", { name });
}

describe("AgendaViewTabs", () => {
  it("acende a aba tocada antes de a página nova chegar", () => {
    render(<AgendaViewTabs period={period("lista")} />);
    expect(tab("Lista")).toHaveAttribute("data-active", "true");

    fireEvent.click(tab("Mês"));

    expect(tab("Mês")).toHaveAttribute("data-active", "true");
    expect(tab("Lista")).not.toHaveAttribute("data-active");
  });

  it("não mente para o leitor de tela enquanto a navegação não termina", () => {
    render(<AgendaViewTabs period={period("lista")} />);
    fireEvent.click(tab("Mês"));

    expect(tab("Mês")).not.toHaveAttribute("aria-current");
    expect(tab("Lista")).toHaveAttribute("aria-current", "page");
  });

  it("solta o palpite local quando a visão chega do servidor", () => {
    const { rerender } = render(<AgendaViewTabs period={period("lista")} />);
    fireEvent.click(tab("Dia"));
    expect(tab("Dia")).toHaveAttribute("data-active", "true");

    // O servidor respondeu com outra visão (voltar pelo histórico, por exemplo).
    rerender(<AgendaViewTabs period={period("semana")} />);

    expect(tab("Semana")).toHaveAttribute("data-active", "true");
    expect(tab("Dia")).not.toHaveAttribute("data-active");
  });

  it("mantém o mês ao ir para a lista e o dia ao ir para o dia", () => {
    render(<AgendaViewTabs period={period("dia")} />);

    expect(tab("Lista")).toHaveAttribute("href", "/app/agendamentos?view=lista&month=2026-08");
    expect(tab("Dia")).toHaveAttribute("href", "/app/agendamentos?view=dia&date=2026-08-11");
  });
});

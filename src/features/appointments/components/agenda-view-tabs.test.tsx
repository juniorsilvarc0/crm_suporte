import type { AnchorHTMLAttributes } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgendaViewTabs } from "@/features/appointments/components/agenda-view-tabs";

// `useLinkStatus` só devolve pendência de verdade dentro do roteador do Next.
// Aqui interessa o comportamento que é nosso: qual aba fica acesa.
vi.mock("next/link", () => ({
  default: ({ children, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      {...props}
      onClick={(event) => {
        // O jsdom não navega — sem isto ele registra "Not implemented:
        // navigation to another Document" a cada clique e suja a suíte.
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));

function renderTabs(view: "month" | "list" | "semana" | "dia") {
  return render(
    <AgendaViewTabs view={view} dateKey="2026-08-11" monthKey="2026-08" filters={{}} />
  );
}

function tab(name: string) {
  return screen.getByRole("link", { name });
}

describe("AgendaViewTabs", () => {
  it("acende a aba tocada antes de a página nova chegar", () => {
    renderTabs("list");
    expect(tab("Lista")).toHaveAttribute("data-active", "true");

    fireEvent.click(tab("Mês"));

    expect(tab("Mês")).toHaveAttribute("data-active", "true");
    expect(tab("Lista")).not.toHaveAttribute("data-active");
  });

  it("não mente para o leitor de tela enquanto a navegação não termina", () => {
    renderTabs("list");
    fireEvent.click(tab("Mês"));

    // Aceso na tela, mas a página corrente ainda é a lista.
    expect(tab("Mês")).not.toHaveAttribute("aria-current");
    expect(tab("Lista")).toHaveAttribute("aria-current", "page");
  });

  it("solta o palpite local quando a view chega do servidor", () => {
    const { rerender } = renderTabs("list");
    fireEvent.click(tab("Dia"));
    expect(tab("Dia")).toHaveAttribute("data-active", "true");

    // O servidor respondeu — e com outra view (voltar pelo histórico, por
    // exemplo). Quem manda é a prop, não o clique anterior.
    rerender(
      <AgendaViewTabs view="semana" dateKey="2026-08-11" monthKey="2026-08" filters={{}} />
    );

    expect(tab("Semana")).toHaveAttribute("data-active", "true");
    expect(tab("Dia")).not.toHaveAttribute("data-active");
  });

  it("mantém o mês ao voltar de dia para lista e a data ao ir para dia", () => {
    renderTabs("dia");

    expect(tab("Lista")).toHaveAttribute("href", "/app/agendamentos?view=list&month=2026-08");
    expect(tab("Dia")).toHaveAttribute("href", "/app/agendamentos?view=dia&date=2026-08-11");
  });
});

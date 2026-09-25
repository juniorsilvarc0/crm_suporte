import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConversationFilters } from "@/features/chat/components/conversation-filters";
import { EMPTY_FILTERS, type ChatFilters } from "@/features/chat/lib/chat-filters";
import type { Tag } from "@/features/tags/types";

/**
 * ⚠️ Este arquivo existe por causa de um defeito real: `DropdownMenuLabel` é o
 * `Menu.GroupLabel` do Base UI e **lança** fora de um `Menu.Group`. Abrir o
 * painel derrubava a tela inteira — e `typecheck`, `lint` e `build` passavam,
 * porque o erro só acontece na interação.
 *
 * Por isso o teste principal aqui **abre o painel**. Renderizar o componente
 * fechado não teria pego nada.
 */

const TAGS: Tag[] = [
  { id: "t1", name: "VIP", color: "amber", created_at: "2026-01-01T00:00:00Z" },
  // Cor fora da paleta: `tags.color` é `text` no banco, e o chip não pode
  // quebrar por causa disso.
  { id: "t2", name: "Urgente", color: "cor-inexistente", created_at: "2026-01-01T00:00:00Z" },
];

function setup(filters: Partial<ChatFilters> = {}) {
  const onFiltersChange = vi.fn();
  render(
    <ConversationFilters
      filters={{ ...EMPTY_FILTERS, ...filters }}
      onFiltersChange={onFiltersChange}
      tags={TAGS}
    />
  );
  return { onFiltersChange, user: userEvent.setup() };
}

describe("ConversationFilters", () => {
  it("abre o painel sem quebrar e lista as etiquetas", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: /filtros/i }));

    expect(await screen.findByText("Etiquetas")).toBeTruthy();
    expect(screen.getByText("VIP")).toBeTruthy();
    // Etiqueta com cor fora da paleta continua desenhando (fallback da paleta).
    expect(screen.getByText("Urgente")).toBeTruthy();
  });

  it("marcar uma etiqueta no painel envia a etiqueta para o filtro", async () => {
    const { user, onFiltersChange } = setup();

    await user.click(screen.getByRole("button", { name: /filtros/i }));
    await user.click(await screen.findByText("VIP"));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["t1"] })
    );
  });

  it("os chips de responsável e não lidas ficam fora do painel", () => {
    setup();

    // Sempre visíveis, sem precisar abrir nada: são o caminho frequente.
    expect(screen.getByRole("button", { name: "Tudo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "IA" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Humano" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Não lidas" })).toBeTruthy();
    // "Resolvidos" saiu a pedido do cliente.
    expect(screen.queryByRole("button", { name: "Resolvidos" })).toBeNull();
  });

  it("filtro escolhido vira chip removível, e o chip remove", async () => {
    const { user, onFiltersChange } = setup({ tags: ["t1", "t2"] });

    const chip = screen.getByRole("button", { name: "Remover filtro VIP" });
    expect(screen.getByRole("button", { name: "Remover filtro Urgente" })).toBeTruthy();

    await user.click(chip);

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["t2"] })
    );
  });

  it("limpar devolve os filtros ao estado inicial", async () => {
    const { user, onFiltersChange } = setup({ status: "bot", unread: true, tags: ["t1"] });

    await user.click(screen.getByRole("button", { name: "Limpar" }));

    expect(onFiltersChange).toHaveBeenCalledWith(EMPTY_FILTERS);
  });

  it("sem etiqueta escolhida, a segunda linha não existe", () => {
    setup({ status: "bot" });

    expect(screen.queryByRole("button", { name: /^Remover filtro/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Limpar" })).toBeNull();
  });
});

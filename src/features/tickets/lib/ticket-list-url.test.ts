import { describe, expect, it, vi } from "vitest";

// parseTicketListParams mora na query, que importa o client admin: o módulo é
// trocado para o teste não depender das variáveis do Supabase.
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => false,
  createSupabaseAdminClient: vi.fn(),
}));

import {
  countTicketFilters,
  DEFAULT_TICKET_LIST_FILTERS,
  ticketListHref,
  ticketListSearch,
  type TicketListFilters,
} from "@/features/tickets/lib/ticket-list-url";
import { parseTicketListParams } from "@/features/tickets/queries/get-tickets-page";

const PRODUCT = "c9f0f895-fb98-4b91-b6c4-2d3e4f5a6b7c";
const USER = "8f14e45f-ceea-4e67-a3b1-9c0d1e2f3a4b";

const filters = (overrides: Partial<TicketListFilters> = {}): TicketListFilters => ({
  ...DEFAULT_TICKET_LIST_FILTERS,
  ...overrides,
});

describe("ticketListHref", () => {
  it("deve deixar a URL limpa quando tudo está no padrão", () => {
    expect(ticketListHref(filters())).toBe("/app/tickets");
    expect(ticketListSearch(filters())).toEqual({});
  });

  it("deve levar só o que foge do padrão, sem a página", () => {
    const href = ticketListHref(
      filters({ q: "SUP-1024", status: "todos", sla: "estourado", ordem: "recentes" })
    );

    expect(href).toBe("/app/tickets?q=SUP-1024&status=todos&sla=estourado&ordem=recentes");
    expect(href).not.toContain("page=");
  });

  it("deve codificar a busca (espaço, # e acento)", () => {
    expect(ticketListHref(filters({ q: "#1024" }))).toBe("/app/tickets?q=%231024");
    expect(ticketListHref(filters({ q: "Padaria São João" }))).toBe(
      "/app/tickets?q=Padaria+S%C3%A3o+Jo%C3%A3o"
    );
  });

  it("deve voltar igual pela allowlist do servidor (recarregar mantém os filtros)", () => {
    const chosen = filters({
      q: "nota fiscal",
      status: "aguardando_cliente",
      prioridade: "critica",
      fila: PRODUCT,
      responsavel: USER,
      sla: "risco",
      ordem: "atualizados",
    });

    const search = new URLSearchParams(ticketListHref(chosen).split("?")[1]);

    expect(parseTicketListParams(Object.fromEntries(search))).toEqual({ ...chosen, page: 1 });
  });

  it("deve aceitar 'sem' fila e responsável 'eu' ou 'nenhum'", () => {
    expect(ticketListHref(filters({ fila: "sem", responsavel: "nenhum" }))).toBe(
      "/app/tickets?fila=sem&responsavel=nenhum"
    );
    expect(ticketListHref(filters({ responsavel: "eu" }))).toBe("/app/tickets?responsavel=eu");
  });

  it("deve levar o grupo 'pendentes' (o do Início) e voltar igual pela allowlist", () => {
    const chosen = filters({ status: "pendentes", responsavel: "eu" });
    const href = ticketListHref(chosen);

    expect(href).toBe("/app/tickets?status=pendentes&responsavel=eu");
    expect(parseTicketListParams(Object.fromEntries(new URLSearchParams(href.split("?")[1])))).toEqual({
      ...chosen,
      page: 1,
    });
  });
});

describe("countTicketFilters", () => {
  it("deve contar zero no padrão, mesmo com busca e ordem", () => {
    expect(countTicketFilters(filters({ q: "erro", ordem: "recentes" }))).toBe(0);
  });

  it("deve contar cada filtro do painel que foge do padrão", () => {
    expect(
      countTicketFilters(
        filters({ status: "todos", prioridade: "alta", fila: "sem", responsavel: "eu", sla: "pausado" })
      )
    ).toBe(5);
    expect(countTicketFilters(filters({ status: "resolvidos" }))).toBe(1);
  });
});

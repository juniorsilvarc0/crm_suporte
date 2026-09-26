import { describe, expect, it } from "vitest";

import {
  invalidTransitionMessage,
  quickActions,
  ticketStatusLabel,
} from "@/features/tickets/lib/ticket-actions";
import type {
  SlaMode,
  TicketStatusKey,
  TicketStatusOption,
  TicketTransition,
} from "@/features/tickets/types";

// A matriz da semente (migration 20260925120900, bloco 1.2).
const pairs: [TicketStatusKey, TicketStatusKey][] = [
  ["novo", "em_triagem"],
  ["novo", "em_atendimento"],
  ["novo", "aguardando_cliente"],
  ["novo", "aguardando_interno"],
  ["novo", "cancelado"],
  ["em_triagem", "em_atendimento"],
  ["em_triagem", "aguardando_cliente"],
  ["em_triagem", "aguardando_interno"],
  ["em_triagem", "cancelado"],
  ["em_atendimento", "aguardando_cliente"],
  ["em_atendimento", "aguardando_interno"],
  ["em_atendimento", "resolvido"],
  ["em_atendimento", "cancelado"],
  ["aguardando_cliente", "em_atendimento"],
  ["aguardando_cliente", "aguardando_interno"],
  ["aguardando_cliente", "resolvido"],
  ["aguardando_cliente", "cancelado"],
  ["aguardando_interno", "em_atendimento"],
  ["aguardando_interno", "aguardando_cliente"],
  ["aguardando_interno", "resolvido"],
  ["aguardando_interno", "cancelado"],
  ["resolvido", "em_atendimento"],
  ["resolvido", "fechado"],
];
const SEED: TicketTransition[] = pairs.map(([from_status, to_status]) => ({
  from_status,
  to_status,
}));

// O sla_mode de cada status na semente (bloco 1.1).
const MODE: Record<TicketStatusKey, SlaMode> = {
  novo: "running",
  em_triagem: "running",
  em_atendimento: "running",
  aguardando_cliente: "paused",
  aguardando_interno: "running",
  resolvido: "stopped",
  fechado: "stopped",
  cancelado: "stopped",
};

const VIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function ticket(status: TicketStatusKey, assigneeId: string | null = null) {
  return {
    status,
    sla_mode: MODE[status],
    assignee: assigneeId ? { id: assigneeId } : null,
  };
}

const ids = (status: TicketStatusKey, assigneeId: string | null = null) =>
  quickActions(ticket(status, assigneeId), SEED, VIEWER).map((action) => action.id);

describe("quickActions", () => {
  it("novo sem responsável: Atender e Aguardar cliente", () => {
    expect(ids("novo")).toEqual(["take_over", "await_customer"]);
  });

  it("novo do próprio analista ainda oferece Atender (o take-over leva a em_atendimento)", () => {
    expect(ids("novo", VIEWER)).toEqual(["take_over", "await_customer"]);
    expect(ids("em_triagem", VIEWER)).toEqual(["take_over", "await_customer"]);
  });

  it("não oferece Atender em ticket de outro analista", () => {
    expect(ids("novo", OTHER)).toEqual(["await_customer"]);
    expect(ids("em_atendimento", OTHER)).toEqual(["await_customer", "resolve"]);
  });

  it("em atendimento sem responsável: Atender só atribui, e continua na lista", () => {
    expect(ids("em_atendimento")).toEqual(["take_over", "await_customer", "resolve"]);
  });

  it("em atendimento do próprio analista: sem Atender, que não mudaria nada", () => {
    expect(ids("em_atendimento", VIEWER)).toEqual(["await_customer", "resolve"]);
  });

  it("aguardando cliente sem responsável: Atender e Resolver", () => {
    expect(ids("aguardando_cliente")).toEqual(["take_over", "resolve"]);
    expect(ids("aguardando_cliente", VIEWER)).toEqual(["resolve"]);
  });

  it("aguardando interno: Aguardar cliente e Resolver", () => {
    expect(ids("aguardando_interno", VIEWER)).toEqual(["await_customer", "resolve"]);
  });

  it("resolvido: Reabrir e Fechar, sem Atender (resolvido se reabre)", () => {
    expect(ids("resolvido")).toEqual(["reopen", "close"]);
    expect(ids("resolvido", VIEWER)).toEqual(["reopen", "close"]);
  });

  it("terminais não têm ação rápida", () => {
    expect(ids("fechado")).toEqual([]);
    expect(ids("cancelado")).toEqual([]);
  });

  it("devolve o destino e o rótulo de cada ação", () => {
    expect(quickActions(ticket("resolvido"), SEED, VIEWER)).toEqual([
      { id: "reopen", kind: "transition", to: "em_atendimento", label: "Reabrir" },
      { id: "close", kind: "transition", to: "fechado", label: "Fechar" },
    ]);
    expect(quickActions(ticket("novo"), SEED, VIEWER)[0]).toEqual({
      id: "take_over",
      kind: "take_over",
      label: "Atender",
    });
  });

  it("sem o catálogo não oferece transição nem o Atender que move o status", () => {
    expect(quickActions(ticket("novo"), null, VIEWER)).toEqual([]);
    expect(quickActions(ticket("resolvido"), null, VIEWER)).toEqual([]);
    // Fora de novo/em_triagem o take-over não passa pela matriz.
    expect(quickActions(ticket("aguardando_cliente"), null, VIEWER).map((a) => a.id)).toEqual([
      "take_over",
    ]);
  });

  it("segue a matriz do banco, não uma própria", () => {
    const withoutResolve = SEED.filter(
      (pair) => !(pair.from_status === "em_atendimento" && pair.to_status === "resolvido")
    );
    expect(
      quickActions(ticket("em_atendimento", VIEWER), withoutResolve, VIEWER).map((a) => a.id)
    ).toEqual(["await_customer"]);
  });
});

const CATALOG: Pick<TicketStatusOption, "key" | "label">[] = [
  { key: "novo", label: "Novo" },
  { key: "em_triagem", label: "Triagem" },
  { key: "em_atendimento", label: "Atendendo" },
  { key: "cancelado", label: "Cancelado" },
];

describe("ticketStatusLabel", () => {
  it("usa o rótulo do catálogo", () => {
    expect(ticketStatusLabel("em_atendimento", CATALOG)).toBe("Atendendo");
  });

  it("cai no rótulo de recurso sem catálogo ou sem a chave nele", () => {
    expect(ticketStatusLabel("em_atendimento", null)).toBe("Em atendimento");
    expect(ticketStatusLabel("resolvido", CATALOG)).toBe("Resolvido");
  });
});

describe("invalidTransitionMessage", () => {
  const body = { message: "Esse movimento não é permitido a partir do status atual." };

  it("lista os destinos permitidos com os rótulos do catálogo", () => {
    expect(
      invalidTransitionMessage(
        { ...body, current: "novo", allowed: ["em_triagem", "em_atendimento", "cancelado"] },
        "novo",
        CATALOG
      )
    ).toBe("De Novo só vai para Triagem, Atendendo, Cancelado.");
  });

  it("usa o status atual do corpo, não o que a tela tinha", () => {
    expect(
      invalidTransitionMessage(
        { ...body, current: "resolvido", allowed: ["em_atendimento", "fechado"] },
        "em_atendimento",
        null
      )
    ).toBe("De Resolvido só vai para Em atendimento, Fechado.");
  });

  it("sem `current` no corpo, parte do status da tela", () => {
    expect(
      invalidTransitionMessage({ ...body, allowed: ["resolvido"] }, "aguardando_interno", null)
    ).toBe("De Aguardando interno só vai para Resolvido.");
  });

  it("de um terminal, diz que não há saída", () => {
    expect(
      invalidTransitionMessage({ ...body, current: "fechado", allowed: [] }, "fechado", null)
    ).toBe("De Fechado não vai para nenhum outro status.");
  });

  it("sem `allowed`, fica a mensagem da rota", () => {
    expect(invalidTransitionMessage(body, "novo", CATALOG)).toBe(body.message);
  });
});

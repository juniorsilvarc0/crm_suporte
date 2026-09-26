import { describe, expect, it } from "vitest";

import { allowedTargets, canTransition } from "@/features/tickets/lib/state-machine";
import { TICKET_STATUS_KEYS } from "@/features/tickets/lib/ticket-status";
import type { TicketStatusKey, TicketTransition } from "@/features/tickets/types";

// A matriz da semente (migration 20260925120900, bloco 1.2), embaralhada: a
// ordem de chegada não pode mudar a ordem dos destinos.
const pairs: [TicketStatusKey, TicketStatusKey][] = [
  ["resolvido", "fechado"],
  ["novo", "cancelado"],
  ["aguardando_interno", "resolvido"],
  ["novo", "em_triagem"],
  ["em_triagem", "cancelado"],
  ["aguardando_cliente", "resolvido"],
  ["em_atendimento", "resolvido"],
  ["novo", "aguardando_interno"],
  ["em_triagem", "em_atendimento"],
  ["aguardando_interno", "cancelado"],
  ["resolvido", "em_atendimento"],
  ["em_atendimento", "cancelado"],
  ["novo", "em_atendimento"],
  ["aguardando_cliente", "em_atendimento"],
  ["em_triagem", "aguardando_interno"],
  ["aguardando_interno", "aguardando_cliente"],
  ["em_atendimento", "aguardando_interno"],
  ["novo", "aguardando_cliente"],
  ["aguardando_cliente", "aguardando_interno"],
  ["em_triagem", "aguardando_cliente"],
  ["aguardando_interno", "em_atendimento"],
  ["em_atendimento", "aguardando_cliente"],
  ["aguardando_cliente", "cancelado"],
];
const SEED: TicketTransition[] = pairs.map(([from_status, to_status]) => ({
  from_status,
  to_status,
}));

describe("allowedTargets", () => {
  // O mesmo `allowed` que o banco devolve (jsonb_agg ... order by position),
  // conferido no banco local.
  it.each<[TicketStatusKey, TicketStatusKey[]]>([
    ["novo", ["em_triagem", "em_atendimento", "aguardando_cliente", "aguardando_interno", "cancelado"]],
    ["em_triagem", ["em_atendimento", "aguardando_cliente", "aguardando_interno", "cancelado"]],
    ["em_atendimento", ["aguardando_cliente", "aguardando_interno", "resolvido", "cancelado"]],
    ["aguardando_cliente", ["em_atendimento", "aguardando_interno", "resolvido", "cancelado"]],
    ["aguardando_interno", ["em_atendimento", "aguardando_cliente", "resolvido", "cancelado"]],
    ["resolvido", ["em_atendimento", "fechado"]],
    ["fechado", []],
    ["cancelado", []],
  ])("de %s vai para %j, na ordem de position", (from, expected) => {
    expect(allowedTargets(SEED, from)).toEqual(expected);
  });

  it("sem matriz própria: segue só as transições recebidas", () => {
    const custom: TicketTransition[] = [
      { from_status: "fechado", to_status: "novo" },
      { from_status: "novo", to_status: "resolvido" },
    ];
    expect(allowedTargets(custom, "fechado")).toEqual(["novo"]);
    expect(allowedTargets(custom, "novo")).toEqual(["resolvido"]);
    expect(allowedTargets(custom, "em_atendimento")).toEqual([]);
  });

  it("sem catálogo (null) ou matriz vazia, não oferece destino", () => {
    for (const from of TICKET_STATUS_KEYS) {
      expect(allowedTargets(null, from)).toEqual([]);
      expect(allowedTargets([], from)).toEqual([]);
    }
  });

  it("devolve lista nova a cada chamada (quem chama pode mexer)", () => {
    const first = allowedTargets(SEED, "resolvido");
    first.pop();
    expect(allowedTargets(SEED, "resolvido")).toEqual(["em_atendimento", "fechado"]);
  });
});

describe("canTransition", () => {
  it("aceita o par que está na matriz", () => {
    expect(canTransition(SEED, "novo", "em_atendimento")).toBe(true);
    expect(canTransition(SEED, "resolvido", "fechado")).toBe(true);
    expect(canTransition(SEED, "aguardando_cliente", "resolvido")).toBe(true);
  });

  it("recusa o par fora da matriz, inclusive o de volta e o próprio status", () => {
    // Resolver exige passar por em_atendimento ou por um aguardando_* (Q1).
    expect(canTransition(SEED, "novo", "resolvido")).toBe(false);
    expect(canTransition(SEED, "em_triagem", "resolvido")).toBe(false);
    expect(canTransition(SEED, "fechado", "resolvido")).toBe(false);
    expect(canTransition(SEED, "resolvido", "cancelado")).toBe(false);
    expect(canTransition(SEED, "novo", "novo")).toBe(false);
  });

  it("sem catálogo (null), recusa tudo", () => {
    expect(canTransition(null, "novo", "em_atendimento")).toBe(false);
  });

  it("concorda com allowedTargets em todos os pares", () => {
    for (const from of TICKET_STATUS_KEYS) {
      const allowed = allowedTargets(SEED, from);
      for (const to of TICKET_STATUS_KEYS) {
        expect(canTransition(SEED, from, to)).toBe(allowed.includes(to));
      }
    }
  });
});

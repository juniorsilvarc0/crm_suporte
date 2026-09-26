import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getConversationTickets,
  MAX_CONVERSATION_TICKETS,
} from "@/features/tickets/queries/get-conversation-tickets";
import { TICKET_LIST_SELECT } from "@/features/tickets/queries/get-tickets-page";
import type { Database } from "@/lib/supabase/types";

// O client é injetado (a rota o cria depois do guard): basta um `from` falso.
const fromMock = vi.fn();
const db = { from: fromMock } as unknown as SupabaseClient<Database>;

type Call = [method: string, ...args: unknown[]];

// Builder encadeável que grava cada chamada e resolve com `result` quando é
// aguardado. O mesmo de get-tickets-page.test.ts, com `.maybeSingle()`.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of [
    "select",
    "ilike",
    "eq",
    "neq",
    "is",
    "not",
    "order",
    "range",
    "limit",
    "maybeSingle",
  ]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  return { builder, calls };
}

// Na ordem em que a função chama from(): a conversa, a lista e, se o foco
// ficou fora dela, o ticket em foco.
function queueQueries(...results: unknown[]) {
  const queries = results.map(fakeQuery);
  for (const query of queries) fromMock.mockReturnValueOnce(query.builder);
  return queries.map((query) => query.calls);
}

const CONVERSATION = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TICKET = "0f8fad5b-d9cb-469f-a165-70867728950e";
const FOCUSED = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";

// Como o PostgREST entrega a linha da view: instantes crus com microssegundos.
const row = (overrides: Record<string, unknown> = {}) => ({
  id: TICKET,
  number: 1024,
  title: "Erro ao emitir nota fiscal",
  status: "em_atendimento",
  priority: "alta",
  version: 3,
  source: "agent",
  conversation_id: CONVERSATION,
  is_terminal: false,
  reopened_count: 0,
  sla_mode: "running",
  sla_first_response_minutes: 60,
  sla_resolution_minutes: 480,
  sla_warn_pct: 80,
  first_response_due_at: "2026-09-25T13:00:00.123456+00:00",
  resolution_due_at: "2026-09-25T20:00:00.123456+00:00",
  first_responded_at: "2026-09-25T12:10:00.654321+00:00",
  sla_paused_at: null,
  resolved_at: null,
  closed_at: null,
  next_due_at: "2026-09-25T20:00:00.123456+00:00",
  last_inbound_at: "2026-09-25T12:05:00.000001+00:00",
  created_at: "2026-09-25T12:00:00.123456+00:00",
  updated_at: "2026-09-25T12:30:00.5+00:00",
  customer: null,
  contact: { id: "p1", name: "Maria Souza", phone: "5527999990000" },
  product: null,
  assignee: null,
  ...overrides,
});

const focusedRow = () => row({ id: FOCUSED, number: 1030, title: "Boleto não gera" });

const ok = (data: unknown) => ({ data, error: null });
const conversation = (activeTicketId: string | null) => ok({ active_ticket_id: activeTicketId });

beforeEach(() => {
  fromMock.mockReset();
});

describe("getConversationTickets", () => {
  it("lê o foco da conversa e os tickets não terminais dela, por prazo, até 20", async () => {
    const [conversationCalls, listCalls] = queueQueries(conversation(null), ok([row()]));

    const result = await getConversationTickets(db, CONVERSATION);

    expect(fromMock.mock.calls).toEqual([["chat_conversations"], ["ticket_queue"]]);
    expect(conversationCalls).toEqual([
      ["select", "active_ticket_id"],
      ["eq", "id", CONVERSATION],
      ["maybeSingle"],
    ]);
    expect(listCalls[0]).toEqual(["select", TICKET_LIST_SELECT, {}]);
    expect(listCalls.filter(([method]) => method === "eq")).toEqual([
      ["eq", "conversation_id", CONVERSATION],
      ["eq", "is_terminal", false],
    ]);
    expect(MAX_CONVERSATION_TICKETS).toBe(20);
    expect(listCalls.at(-1)).toEqual(["limit", 20]);
    expect(result).toEqual({ active_ticket_id: null, tickets: [row()] });
  });

  it("erro na lista rejeita em vez de devolver lista vazia", async () => {
    const error = { code: "42501", message: "permission denied" };
    queueQueries(conversation(null), { data: null, error });

    await expect(getConversationTickets(db, CONVERSATION)).rejects.toBe(error);
  });

  it("erro na leitura da conversa também rejeita", async () => {
    const error = { code: "57014", message: "timeout" };
    queueQueries({ data: null, error }, ok([row()]));

    await expect(getConversationTickets(db, CONVERSATION)).rejects.toBe(error);
  });

  it("foco fora da lista vem numa 3ª leitura, da mesma conversa e não terminal, e entra no fim", async () => {
    const [, , focusCalls] = queueQueries(
      conversation(FOCUSED),
      ok([row()]),
      ok(focusedRow())
    );

    const result = await getConversationTickets(db, CONVERSATION);

    expect(fromMock).toHaveBeenCalledTimes(3);
    expect(fromMock).toHaveBeenLastCalledWith("ticket_queue");
    expect(focusCalls).toEqual([
      ["select", TICKET_LIST_SELECT, {}],
      ["eq", "id", FOCUSED],
      ["eq", "conversation_id", CONVERSATION],
      ["eq", "is_terminal", false],
      ["maybeSingle"],
    ]);
    expect(result).toEqual({ active_ticket_id: FOCUSED, tickets: [row(), focusedRow()] });
  });

  it("foco que terminou entre as leituras não entra, e o foco segue no retorno", async () => {
    queueQueries(conversation(FOCUSED), ok([row()]), ok(null));

    const result = await getConversationTickets(db, CONVERSATION);

    expect(result).toEqual({ active_ticket_id: FOCUSED, tickets: [row()] });
  });

  it("foco já na lista não faz 3ª leitura", async () => {
    queueQueries(conversation(FOCUSED), ok([row(), focusedRow()]));

    const result = await getConversationTickets(db, CONVERSATION);

    expect(fromMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ active_ticket_id: FOCUSED, tickets: [row(), focusedRow()] });
  });
});

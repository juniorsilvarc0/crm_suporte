import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ConversationStatus } from "@/features/chat/types";
import {
  INBOUND_REFRESH_DELAY_MS,
  useConversationTickets,
} from "@/features/tickets/hooks/use-conversation-tickets";
import type { ConversationTickets, TicketListItem } from "@/features/tickets/types";

const CONV_A = "11111111-1111-4111-8111-111111111111";
const CONV_B = "22222222-2222-4222-8222-222222222222";

function ticket(id: string, number: number, conversationId = CONV_A): TicketListItem {
  return {
    id,
    number,
    title: `Ticket ${number}`,
    status: "em_atendimento",
    priority: "media",
    version: 1,
    source: "agent",
    conversation_id: conversationId,
    is_terminal: false,
    reopened_count: 0,
    sla_mode: "running",
    sla_first_response_minutes: 60,
    sla_resolution_minutes: 480,
    sla_warn_pct: 80,
    first_response_due_at: "2026-09-26T10:00:00+00:00",
    resolution_due_at: "2026-09-26T17:00:00+00:00",
    first_responded_at: null,
    sla_paused_at: null,
    resolved_at: null,
    closed_at: null,
    next_due_at: "2026-09-26T17:00:00+00:00",
    last_inbound_at: null,
    replied_after_resolve: false,
    created_at: "2026-09-26T09:00:00+00:00",
    updated_at: "2026-09-26T09:00:00+00:00",
    customer: null,
    contact: { id: "contact-1", name: "Maria Souza", phone: "5511999990000" },
    product: null,
    assignee: null,
  };
}

const T1 = ticket("t1", 1024);
const T2 = ticket("t2", 1025);
const TB = ticket("tb", 2048, CONV_B);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function okBody(data: ConversationTickets) {
  return jsonResponse({ ok: true, ...data });
}

const urlOf = (conversationId: string) => `/api/tickets?conversation_id=${conversationId}`;

/** Cada chamada leva a próxima resposta da fila; a URL fica registrada. */
function stubFetch(...responses: (Response | Promise<Response> | Error)[]) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => {
    const next = responses.shift();
    if (!next) return Promise.reject(new Error("fetch inesperado"));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type Props = {
  conversationId: string | null;
  activeTicketId: string | null;
  status: ConversationStatus | null;
};

function renderTickets(initial: Props) {
  return renderHook(
    ({ conversationId, activeTicketId, status }: Props) =>
      useConversationTickets(conversationId, activeTicketId, status),
    { initialProps: initial }
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useConversationTickets — leitura", () => {
  it("lê os tickets da conversa e acha o ticket em foco", async () => {
    const fetchMock = stubFetch(okBody({ active_ticket_id: "t2", tickets: [T1, T2] }));
    const { result } = renderTickets({ conversationId: CONV_A, activeTicketId: "t2", status: "human" });

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith(urlOf(CONV_A), expect.objectContaining({ method: "GET" }));
    expect(result.current.data).toEqual({ active_ticket_id: "t2", tickets: [T1, T2] });
    expect(result.current.activeTicket).toEqual(T2);
    expect(result.current.error).toBe(false);
    expect(result.current.fetchedAt).not.toBeNull();
  });

  it("sem conversa não busca nada", () => {
    const fetchMock = stubFetch();
    const { result } = renderTickets({ conversationId: null, activeTicketId: null, status: null });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  // O foco vem do Realtime (mais novo que a leitura): ticket fora da lista lida
  // ainda não tem dado, e o chip não inventa um.
  it("foco que a leitura ainda não trouxe dá activeTicket nulo", async () => {
    stubFetch(okBody({ active_ticket_id: null, tickets: [T1] }));
    const { result } = renderTickets({ conversationId: CONV_A, activeTicketId: "t9", status: "human" });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activeTicket).toBeNull();
  });

  it.each([
    ["o foco", { activeTicketId: "t1" }],
    ["o status da conversa", { status: "bot" as const }],
  ])("relê quando muda %s", async (_label, change) => {
    const fetchMock = stubFetch(
      okBody({ active_ticket_id: null, tickets: [T1] }),
      okBody({ active_ticket_id: "t1", tickets: [T1] })
    );
    const initial: Props = { conversationId: CONV_A, activeTicketId: null, status: "human" };
    const { result, rerender } = renderTickets(initial);
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ ...initial, ...change });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.data?.active_ticket_id).toBe("t1"));
  });

  it("descarta a resposta da conversa que saiu da tela", async () => {
    const slowA = deferred();
    const fetchMock = stubFetch(slowA.promise, okBody({ active_ticket_id: "tb", tickets: [TB] }));
    const { result, rerender } = renderTickets({
      conversationId: CONV_A,
      activeTicketId: null,
      status: "human",
    });

    rerender({ conversationId: CONV_B, activeTicketId: "tb", status: "human" });
    await waitFor(() => expect(result.current.data?.tickets).toEqual([TB]));

    // A resposta de A chega depois, e a tela continua em B.
    await act(async () => {
      slowA.resolve(okBody({ active_ticket_id: "t1", tickets: [T1] }));
    });
    expect(result.current.data?.tickets).toEqual([TB]);
    expect(result.current.activeTicket).toEqual(TB);
    // A leitura de A foi cancelada, não só ignorada.
    const [, initA] = fetchMock.mock.calls[0]!;
    expect(initA?.signal?.aborted).toBe(true);
  });

  it("trocar de conversa não mostra os tickets da anterior enquanto a nova carrega", async () => {
    const slowB = deferred();
    stubFetch(okBody({ active_ticket_id: null, tickets: [T1] }), slowB.promise);
    const { result, rerender } = renderTickets({
      conversationId: CONV_A,
      activeTicketId: null,
      status: "human",
    });
    await waitFor(() => expect(result.current.data?.tickets).toEqual([T1]));

    rerender({ conversationId: CONV_B, activeTicketId: null, status: "human" });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => {
      slowB.resolve(okBody({ active_ticket_id: null, tickets: [TB] }));
    });
    expect(result.current.data?.tickets).toEqual([TB]);
  });
});

describe("useConversationTickets — erro", () => {
  // 500 nunca vira "nenhum ticket": a tela mostra "Tentar de novo".
  it("falha dá erro sem dado, e refresh volta ao carregando e relê", async () => {
    const fetchMock = stubFetch(
      jsonResponse({ ok: false, message: "Não foi possível carregar os tickets da conversa." }, 500),
      okBody({ active_ticket_id: null, tickets: [T1] })
    );
    const { result } = renderTickets({ conversationId: CONV_A, activeTicketId: null, status: "human" });

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);

    act(() => result.current.refresh());
    expect(result.current.error).toBe(false);
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.data?.tickets).toEqual([T1]));
    expect(result.current.error).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("releitura que falha mantém a leitura anterior e marca o erro", async () => {
    stubFetch(okBody({ active_ticket_id: null, tickets: [T1] }), new TypeError("Failed to fetch"));
    const { result } = renderTickets({ conversationId: CONV_A, activeTicketId: null, status: "human" });
    await waitFor(() => expect(result.current.data?.tickets).toEqual([T1]));

    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.data?.tickets).toEqual([T1]);
    expect(result.current.loading).toBe(false);
  });
});

describe("useConversationTickets — releituras", () => {
  it("voltar para a aba relê; sair dela não", async () => {
    const fetchMock = stubFetch(
      okBody({ active_ticket_id: null, tickets: [T1] }),
      okBody({ active_ticket_id: null, tickets: [T1, T2] })
    );
    const visibility = vi.spyOn(document, "visibilityState", "get");
    const { result } = renderTickets({ conversationId: CONV_A, activeTicketId: null, status: "human" });
    await waitFor(() => expect(result.current.loading).toBe(false));

    visibility.mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(result.current.data?.tickets).toEqual([T1, T2]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refresh relê em segundo plano, sem voltar ao carregando", async () => {
    stubFetch(
      okBody({ active_ticket_id: null, tickets: [T1] }),
      okBody({ active_ticket_id: "t2", tickets: [T1, T2] })
    );
    const { result } = renderTickets({ conversationId: CONV_A, activeTicketId: null, status: "human" });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.refresh());
    expect(result.current.loading).toBe(false);
    expect(result.current.data?.tickets).toEqual([T1]);

    await waitFor(() => expect(result.current.data?.tickets).toEqual([T1, T2]));
  });

  it("uma rajada de inbound vira UMA releitura, 1 s depois da última", async () => {
    const fetchMock = stubFetch(
      okBody({ active_ticket_id: null, tickets: [T1] }),
      okBody({ active_ticket_id: null, tickets: [T1, T2] })
    );
    const { result } = renderTickets({ conversationId: CONV_A, activeTicketId: null, status: "human" });
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.useFakeTimers();
    act(() => result.current.notifyInbound());
    act(() => {
      vi.advanceTimersByTime(600);
    });
    act(() => result.current.notifyInbound());
    // O literal, não a constante: a regra é 1 s, e a constante mudada passaria.
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    await waitFor(() => expect(result.current.data?.tickets).toEqual([T1, T2]));
  });

  it("inbound pendente não relê a conversa depois que ela saiu da tela", async () => {
    const fetchMock = stubFetch(
      okBody({ active_ticket_id: null, tickets: [T1] }),
      okBody({ active_ticket_id: null, tickets: [TB] })
    );
    const { result, rerender } = renderTickets({
      conversationId: CONV_A,
      activeTicketId: null,
      status: "human",
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.useFakeTimers();
    act(() => result.current.notifyInbound());
    rerender({ conversationId: CONV_B, activeTicketId: null, status: "human" });
    await act(async () => {
      vi.advanceTimersByTime(INBOUND_REFRESH_DELAY_MS * 2);
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([urlOf(CONV_A), urlOf(CONV_B)]);
  });
});

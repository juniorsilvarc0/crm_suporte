// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { claimMock, settleMock, ticketMock, postMock } = vi.hoisted(() => ({
  claimMock: vi.fn(),
  settleMock: vi.fn(),
  ticketMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock("@/features/integrations/server/outbox", () => ({
  claimOutbox: claimMock,
  settleOutbox: settleMock,
}));
vi.mock("@/features/tickets/queries/get-api-ticket", () => ({ getApiTicket: ticketMock }));
vi.mock("@/features/webhooks/server/send", () => ({ postWebhook: postMock }));

import {
  deliverWebhookEvent,
  dispatchWebhookBatch,
  WEBHOOK_BACKOFF_CAP_MS,
  webhookRetryAt,
} from "@/features/webhooks/server/dispatch";

// O despachante contra uma fila e um envio de mentira: o teste confere O QUE
// ele decide (sent/retry/skipped/dead_letter) e o corpo que sairia.

const NOW = new Date("2026-10-09T12:00:00.000Z");
const SUB_ID = "5b0e8f1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
const TICKET_ID = "7c1f9a2b-3d4e-4f5a-9b6c-1d2e3f4a5b6c";
const SECRET = "a".repeat(64);
const TICKET = { id: TICKET_ID, number: 42, status: "open", version: 3 };

type Subscription = { id: string; url: string; is_active: boolean } | null;
let subscription: { data: Subscription; error: { message: string } | null };
let secret: { data: string | null; error: { message: string } | null };

const supabase = {
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => subscription }),
    }),
  }),
  rpc: async () => secret,
} as never;

const event = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "evt-1",
    kind: "webhook",
    event_key: `evt-uuid:${SUB_ID}`,
    attempts: 1,
    lease_token: "lease-1",
    payload: {
      subscription_id: SUB_ID,
      event: "ticket.status_changed",
      event_id: "e5d4c3b2-a190-4f8e-9d7c-6b5a4f3e2d1c",
      occurred_at: "2026-10-09T11:59:58.000Z",
      data: { ticket_id: TICKET_ID, from_status: "open", to_status: "in_progress" },
    },
    ...overrides,
  }) as never;

const settled = () => settleMock.mock.calls.at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  subscription = { data: { id: SUB_ID, url: "https://destino.exemplo.com/hook", is_active: true }, error: null };
  secret = { data: SECRET, error: null };
  ticketMock.mockResolvedValue(TICKET);
  postMock.mockResolvedValue({ error: null, httpStatus: 204, latencyMs: 12 });
  settleMock.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("webhookRetryAt", () => {
  it("30 s na 1ª falha, ×4 a cada nova, até o teto de 24 h", () => {
    const at = (n: number) => new Date(webhookRetryAt(n, NOW.getTime())).getTime() - NOW.getTime();
    expect(at(0)).toBe(30_000);
    expect(at(1)).toBe(30_000);
    expect(at(2)).toBe(120_000);
    expect(at(3)).toBe(480_000);
    expect(at(7)).toBe(WEBHOOK_BACKOFF_CAP_MS);
    expect(at(8)).toBe(WEBHOOK_BACKOFF_CAP_MS);
  });
});

describe("deliverWebhookEvent", () => {
  it("entrega o evento com o ticket ATUAL e finaliza como sent", async () => {
    await expect(deliverWebhookEvent(supabase, event())).resolves.toBe("sent");

    expect(ticketMock).toHaveBeenCalledWith(supabase, { id: TICKET_ID });
    const [target, usedSecret, sent] = postMock.mock.calls[0] as [URL, string, { name: string; id: string; body: string }];
    expect(target.toString()).toBe("https://destino.exemplo.com/hook");
    expect(usedSecret).toBe(SECRET);
    expect(sent.name).toBe("ticket.status_changed");
    expect(sent.id).toBe("e5d4c3b2-a190-4f8e-9d7c-6b5a4f3e2d1c");
    expect(JSON.parse(sent.body)).toEqual({
      id: "e5d4c3b2-a190-4f8e-9d7c-6b5a4f3e2d1c",
      event: "ticket.status_changed",
      occurred_at: "2026-10-09T11:59:58.000Z",
      data: { ticket_id: TICKET_ID, from_status: "open", to_status: "in_progress" },
      ticket: TICKET,
    });
    expect(settled()).toEqual({ id: "evt-1", leaseToken: "lease-1", status: "sent", httpStatus: 204 });
  });

  it("o segredo nunca vai no corpo", async () => {
    await deliverWebhookEvent(supabase, event());
    const [, , sent] = postMock.mock.calls[0] as [URL, string, { body: string }];
    expect(sent.body).not.toContain(SECRET);
  });

  it("destino que falhou: nova tentativa com backoff, HTTP e motivo", async () => {
    postMock.mockResolvedValue({ error: "O destino respondeu HTTP 503.", httpStatus: 503, latencyMs: 40 });
    await expect(deliverWebhookEvent(supabase, event({ attempts: 2 }))).resolves.toBe("retry");
    expect(settled()).toMatchObject({
      status: "retry",
      nextAttemptAt: "2026-10-09T12:02:00.000Z",
      httpStatus: 503,
      error: "O destino respondeu HTTP 503.",
    });
  });

  it("falha de rede sem HTTP: nova tentativa com httpStatus nulo", async () => {
    postMock.mockResolvedValue({ error: "Falha de rede (ECONNREFUSED).", latencyMs: 3 });
    await deliverWebhookEvent(supabase, event());
    expect(settled()).toMatchObject({ status: "retry", httpStatus: null, error: "Falha de rede (ECONNREFUSED)." });
  });

  it("destino pausado ou removido depois de enfileirar: skipped, sem envio", async () => {
    subscription = { data: { id: SUB_ID, url: "https://destino.exemplo.com/hook", is_active: false }, error: null };
    await expect(deliverWebhookEvent(supabase, event())).resolves.toBe("skipped");
    expect(settled()).toMatchObject({ error: "destino pausado" });

    subscription = { data: null, error: null };
    await expect(deliverWebhookEvent(supabase, event())).resolves.toBe("skipped");
    expect(settled()).toMatchObject({ error: "destino removido" });
    expect(postMock).not.toHaveBeenCalled();
  });

  it("URL que a guarda recusa (rede interna): dead_letter, sem envio", async () => {
    subscription = { data: { id: SUB_ID, url: "http://10.0.0.5/hook", is_active: true }, error: null };
    await expect(deliverWebhookEvent(supabase, event())).resolves.toBe("dead_letter");
    expect(String(settled().error)).toMatch(/^URL recusada: /);
    expect(postMock).not.toHaveBeenCalled();
  });

  it("destino sem segredo: dead_letter (nada sai sem assinatura)", async () => {
    secret = { data: null, error: null };
    await expect(deliverWebhookEvent(supabase, event())).resolves.toBe("dead_letter");
    expect(settled()).toMatchObject({ error: "destino sem segredo de assinatura" });
    expect(postMock).not.toHaveBeenCalled();
  });

  it("erro ao ler destino, segredo ou ticket: nova tentativa, sem corpo pela metade", async () => {
    subscription = { data: null, error: { message: "boom" } };
    await expect(deliverWebhookEvent(supabase, event())).resolves.toBe("retry");

    subscription = { data: { id: SUB_ID, url: "https://destino.exemplo.com/hook", is_active: true }, error: null };
    secret = { data: null, error: { message: "boom" } };
    await expect(deliverWebhookEvent(supabase, event())).resolves.toBe("retry");

    secret = { data: SECRET, error: null };
    ticketMock.mockRejectedValueOnce(new Error("boom"));
    await expect(deliverWebhookEvent(supabase, event())).resolves.toBe("retry");
    expect(settled()).toMatchObject({ error: "não foi possível ler o ticket" });
    expect(postMock).not.toHaveBeenCalled();
  });

  it("ticket que sumiu vai como null", async () => {
    ticketMock.mockResolvedValue(null);
    await deliverWebhookEvent(supabase, event());
    const [, , sent] = postMock.mock.calls[0] as [URL, string, { body: string }];
    expect(JSON.parse(sent.body).ticket).toBeNull();
  });

  it("payload fora do formato: dead_letter", async () => {
    await expect(deliverWebhookEvent(supabase, event({ payload: { event: "x" } }))).resolves.toBe("dead_letter");
    expect(postMock).not.toHaveBeenCalled();
  });

  it("sem lease não finaliza nada", async () => {
    await expect(deliverWebhookEvent(supabase, event({ lease_token: null }))).resolves.toBeNull();
    expect(settleMock).not.toHaveBeenCalled();
  });
});

describe("dispatchWebhookBatch", () => {
  it("reivindica só a fila de webhooks, com os limites, e entrega cada evento", async () => {
    claimMock.mockResolvedValue([event(), event({ id: "evt-2" })]);
    await dispatchWebhookBatch(supabase);

    expect(claimMock).toHaveBeenCalledWith(supabase, {
      owner: "webhook-dispatch",
      kind: "webhook",
      limit: 5,
      maxAttempts: 8,
      maxAgeSeconds: 3 * 24 * 60 * 60,
    });
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(settleMock.mock.calls.map(([, input]) => (input as { id: string }).id)).toEqual(["evt-1", "evt-2"]);
  });
});

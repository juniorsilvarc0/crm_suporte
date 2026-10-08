// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimOutbox,
  enqueueOutbox,
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_CAP_MS,
  outboxRetryAt,
  settleOutbox,
} from "@/features/integrations/server/outbox";

const rpc = vi.fn();
const supabase = { rpc } as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("outboxRetryAt", () => {
  it("cresce exponencialmente a partir da base", () => {
    const now = Date.UTC(2026, 0, 1);
    expect(outboxRetryAt(1, now)).toBe(new Date(now + OUTBOX_BACKOFF_BASE_MS).toISOString());
    expect(outboxRetryAt(2, now)).toBe(new Date(now + OUTBOX_BACKOFF_BASE_MS * 2).toISOString());
    expect(outboxRetryAt(3, now)).toBe(new Date(now + OUTBOX_BACKOFF_BASE_MS * 4).toISOString());
  });

  it("respeita o teto e trata attempts<1 como 1", () => {
    const now = Date.UTC(2026, 0, 1);
    expect(outboxRetryAt(99, now)).toBe(new Date(now + OUTBOX_BACKOFF_CAP_MS).toISOString());
    expect(outboxRetryAt(0, now)).toBe(outboxRetryAt(1, now));
  });
});

describe("enqueueOutbox", () => {
  it("passa kind/event_key/payload e devolve o id", async () => {
    rpc.mockResolvedValue({ data: "evt-1", error: null });
    const id = await enqueueOutbox(supabase, { kind: "relay", eventKey: "m1", payload: { a: 1 } });
    expect(rpc).toHaveBeenCalledWith("outbox_enqueue", {
      p_kind: "relay",
      p_event_key: "m1",
      p_payload: { a: 1 },
    });
    expect(id).toBe("evt-1");
  });

  it("devolve null e loga em erro", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "X", message: "boom" } });
    expect(await enqueueOutbox(supabase, { kind: "relay", eventKey: "m1", payload: {} })).toBeNull();
    expect(console.error).toHaveBeenCalledOnce();
  });
});

describe("claimOutbox", () => {
  it("passa os cinco argumentos e devolve as linhas", async () => {
    const rows = [{ id: "a" }, { id: "b" }];
    rpc.mockResolvedValue({ data: rows, error: null });
    const claimed = await claimOutbox(supabase, {
      owner: "w1",
      kind: "relay",
      limit: 10,
      maxAttempts: 8,
      maxAgeSeconds: 120,
    });
    expect(rpc).toHaveBeenCalledWith("outbox_claim", {
      p_owner: "w1",
      p_kind: "relay",
      p_limit: 10,
      p_max_attempts: 8,
      p_max_age_seconds: 120,
    });
    expect(claimed).toBe(rows);
  });

  it("devolve [] em erro ou data nulo", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "X", message: "boom" } });
    expect(await claimOutbox(supabase, { owner: "w", kind: "relay", limit: 1, maxAttempts: 1, maxAgeSeconds: 1 })).toEqual([]);
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await claimOutbox(supabase, { owner: "w", kind: "relay", limit: 1, maxAttempts: 1, maxAgeSeconds: 1 })).toEqual([]);
  });
});

describe("settleOutbox", () => {
  it("manda null onde não há valor (fencing/http/prazo) e devolve true", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const ok = await settleOutbox(supabase, { id: "e1", leaseToken: "t1", status: "sent", httpStatus: 200 });
    expect(rpc).toHaveBeenCalledWith("outbox_settle", {
      p_id: "e1",
      p_lease_token: "t1",
      p_status: "sent",
      p_next_attempt_at: null,
      p_http_status: 200,
      p_error: null,
    });
    expect(ok).toBe(true);
  });

  it("no retry, leva o próximo prazo e a mensagem de erro", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const ok = await settleOutbox(supabase, {
      id: "e1",
      leaseToken: "t1",
      status: "retry",
      nextAttemptAt: "2026-01-01T00:00:05.000Z",
      error: "timeout",
    });
    expect(rpc).toHaveBeenCalledWith("outbox_settle", {
      p_id: "e1",
      p_lease_token: "t1",
      p_status: "retry",
      p_next_attempt_at: "2026-01-01T00:00:05.000Z",
      p_http_status: null,
      p_error: "timeout",
    });
    // data:false = a lease não era mais nossa (outra réplica assumiu).
    expect(ok).toBe(false);
  });

  it("devolve false e loga em erro de banco", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "X", message: "boom" } });
    expect(await settleOutbox(supabase, { id: "e1", leaseToken: "t1", status: "sent" })).toBe(false);
    expect(console.error).toHaveBeenCalledOnce();
  });
});

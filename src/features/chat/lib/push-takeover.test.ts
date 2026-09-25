import { afterEach, describe, expect, it, vi } from "vitest";

import { pushTakeoverToAgent } from "@/features/chat/lib/push-takeover";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pushTakeoverToAgent", () => {
  it("sem TAKEOVER_AGENT_URL → skipped, sem chamar fetch", async () => {
    vi.stubEnv("TAKEOVER_AGENT_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await pushTakeoverToAgent("5511990000002", true);

    expect(r).toEqual({ delivered: false, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem telefone → skipped", async () => {
    vi.stubEnv("TAKEOVER_AGENT_URL", "https://agente.exemplo.com/takeover");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await pushTakeoverToAgent(null, true);

    expect(r).toEqual({ delivered: false, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("2xx → delivered, com { phone, assumed } e Bearer do segredo de assinatura", async () => {
    vi.stubEnv("TAKEOVER_AGENT_URL", "https://agente.exemplo.com/takeover");
    vi.stubEnv("BOT_SIGNATURE_AGENT_SECRET", "seg-123");
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const r = await pushTakeoverToAgent("5511 99000-0002", true);

    expect(r).toEqual({ delivered: true, skipped: false, error: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://agente.exemplo.com/takeover");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ phone: "5511 99000-0002", assumed: true });
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer seg-123");
  });

  it("assumed:false é propagado (liberar)", async () => {
    vi.stubEnv("TAKEOVER_AGENT_URL", "https://agente.exemplo.com/takeover");
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await pushTakeoverToAgent("5511990000002", false);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).assumed).toBe(false);
  });

  it("não-2xx → tenta de novo (retry) e devolve delivered=false", async () => {
    vi.stubEnv("TAKEOVER_AGENT_URL", "https://agente.exemplo.com/takeover");
    const fetchMock = vi.fn(async () => ({ ok: false, status: 502 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const r = await pushTakeoverToAgent("5511990000002", true);

    expect(r.delivered).toBe(false);
    expect(r.skipped).toBe(false);
    expect(r.error).toBe("HTTP 502");
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 tentativa + 1 retry
  });

  it("fetch lança → retry, delivered=false, nunca propaga", async () => {
    vi.stubEnv("TAKEOVER_AGENT_URL", "https://agente.exemplo.com/takeover");
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await pushTakeoverToAgent("5511990000002", true);

    expect(r.delivered).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { pushBotSignatureToAgent } from "@/features/settings/lib/push-bot-signature";

const config = { enabled: true, apelido: "Dra. Ana" };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pushBotSignatureToAgent", () => {
  it("sem BOT_SIGNATURE_AGENT_URL → skipped, sem chamar fetch", async () => {
    vi.stubEnv("BOT_SIGNATURE_AGENT_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await pushBotSignatureToAgent(config);

    expect(result).toEqual({ delivered: false, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("com URL e resposta 2xx → delivered, com o payload correto", async () => {
    vi.stubEnv("BOT_SIGNATURE_AGENT_URL", "https://agente.exemplo.com/hook");
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await pushBotSignatureToAgent(config);

    expect(result).toEqual({ delivered: true, skipped: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://agente.exemplo.com/hook");
    expect(init?.method).toBe("POST");
    const sent = JSON.parse(String(init?.body));
    expect(sent).toMatchObject({ enabled: true, apelido: "Dra. Ana" });
    expect(sent.updated_at).toBeTypeOf("string");
  });

  it("envia Authorization: Bearer quando há segredo", async () => {
    vi.stubEnv("BOT_SIGNATURE_AGENT_URL", "https://agente.exemplo.com/hook");
    vi.stubEnv("BOT_SIGNATURE_AGENT_SECRET", "seg-123");
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await pushBotSignatureToAgent(config);

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer seg-123");
  });

  it("resposta não-2xx → delivered=false com o status no erro", async () => {
    vi.stubEnv("BOT_SIGNATURE_AGENT_URL", "https://agente.exemplo.com/hook");
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await pushBotSignatureToAgent(config);

    expect(result).toEqual({ delivered: false, skipped: false, error: "HTTP 500" });
  });

  it("fetch lança (agente fora do ar) → delivered=false, nunca propaga o erro", async () => {
    vi.stubEnv("BOT_SIGNATURE_AGENT_URL", "https://agente.exemplo.com/hook");
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await pushBotSignatureToAgent(config);

    expect(result.delivered).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("aborta após o timeout (agente pendurado não segura o save)", async () => {
    vi.useFakeTimers();
    vi.stubEnv("BOT_SIGNATURE_AGENT_URL", "https://agente.exemplo.com/hook");
    // fetch só resolve/rejeita quando o AbortController disparar o abort.
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new Error("The operation was aborted"))
          );
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = pushBotSignatureToAgent(config);
    // Avança até o timeout de 5s: o setTimeout dispara controller.abort().
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;

    expect(result.delivered).toBe(false);
    expect(result.skipped).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

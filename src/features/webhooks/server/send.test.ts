// @vitest-environment node
import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { postWebhook, WEBHOOK_USER_AGENT } from "@/features/webhooks/server/send";

// O envio de um evento sem rede: o `fetch` é de mentira e a assinatura é
// conferida por uma conta feita AQUI (node:crypto), não pela função do app.

const NOW = new Date("2026-10-09T12:00:00.700Z");
const NOW_SECONDS = String(Math.floor(NOW.getTime() / 1000));
const SECRET = "9f2c4e6a8b0d1f3a5c7e9b1d3f5a7c9e0b2d4f6a8c0e1b3d5f7a9c1e3b5d7f90";
const TARGET = new URL("https://destino.exemplo.com/hook?origem=crm");
const EVENT = { name: "ticket.created", id: "e5d4c3b2-a190-4f8e-9d7c-6b5a4f3e2d1c", body: '{"id":"e5d4"}' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("postWebhook", () => {
  it("POST com os cabeçalhos do evento e a assinatura v1 conferível pelo destino", async () => {
    const outcome = await postWebhook(TARGET, SECRET, EVENT);

    expect(outcome).toMatchObject({ error: null, httpStatus: 204 });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(TARGET.toString());
    expect(init.method).toBe("POST");
    expect(init.body).toBe(EVENT.body);
    // Redirecionamento não é seguido: levaria corpo e assinatura a outro endereço.
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const headers = init.headers as Record<string, string>;
    const expected = createHmac("sha256", SECRET).update(`${NOW_SECONDS}.${EVENT.body}`).digest("hex");
    expect(headers).toEqual({
      "Content-Type": "application/json",
      "User-Agent": WEBHOOK_USER_AGENT,
      "X-CRM-Event": "ticket.created",
      "X-CRM-Event-Id": EVENT.id,
      "X-CRM-Timestamp": NOW_SECONDS,
      "X-CRM-Signature": `v1=${expected}`,
    });
    expect(JSON.stringify(headers)).not.toContain(SECRET);
  });

  it("resposta fora de 2xx (inclusive redirecionamento) é falha com o HTTP", async () => {
    fetchMock.mockResolvedValueOnce(new Response("erro", { status: 500 }));
    await expect(postWebhook(TARGET, SECRET, EVENT)).resolves.toMatchObject({
      error: "O destino respondeu HTTP 500.",
      httpStatus: 500,
    });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://outro.exemplo.com" } }));
    await expect(postWebhook(TARGET, SECRET, EVENT)).resolves.toMatchObject({
      error: "O destino respondeu HTTP 302.",
      httpStatus: 302,
    });
  });

  it("nunca rejeita: prazo estourado e falha de rede viram motivo", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    await expect(postWebhook(TARGET, SECRET, EVENT)).resolves.toMatchObject({
      error: "O destino não respondeu em 10 s.",
    });

    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));
    const outcome = await postWebhook(TARGET, SECRET, EVENT);
    expect(outcome).toMatchObject({ error: "Falha de rede (ECONNREFUSED)." });
    expect(outcome.httpStatus).toBeUndefined();

    fetchMock.mockRejectedValueOnce(new Error("???"));
    await expect(postWebhook(TARGET, SECRET, EVENT)).resolves.toMatchObject({ error: "Falha de rede." });
  });
});

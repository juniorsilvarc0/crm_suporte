import { afterEach, describe, expect, it, vi } from "vitest";

import { ticketFieldError, ticketRequest } from "@/features/tickets/lib/ticket-request";

const TRANSITION_URL = "/api/tickets/t1/transition";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn();
  if (response instanceof Error) fetchMock.mockRejectedValue(response);
  else fetchMock.mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ticketRequest — a requisição", () => {
  it("manda o corpo como JSON, com o Content-Type", async () => {
    const fetchMock = stubFetch(jsonResponse({ ok: true, changed: true }));

    await ticketRequest(TRANSITION_URL, { method: "POST", body: { to: "resolvido", version: 3 } });

    expect(fetchMock).toHaveBeenCalledWith(TRANSITION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "resolvido", version: 3 }),
    });
  });

  it("sem corpo é GET, sem Content-Type, e leva o signal de quem cancela", async () => {
    const fetchMock = stubFetch(jsonResponse({ ok: true, tickets: [] }));
    const controller = new AbortController();

    await ticketRequest("/api/tickets?conversation_id=c1", { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith("/api/tickets?conversation_id=c1", {
      method: "GET",
      signal: controller.signal,
    });
  });
});

describe("ticketRequest — a resposta", () => {
  it("2xx com ok: true devolve o corpo inteiro", async () => {
    stubFetch(jsonResponse({ ok: true, changed: false }));

    await expect(ticketRequest(TRANSITION_URL, { method: "POST", body: {} })).resolves.toEqual({
      ok: true,
      data: { ok: true, changed: false },
    });
  });

  // O corpo é quem diz que deu certo: 200 sem `ok: true` não é sucesso.
  it("2xx sem ok: true é recusa", async () => {
    stubFetch(jsonResponse({ ok: false, message: "Não deu." }));

    await expect(ticketRequest(TRANSITION_URL, { method: "POST", body: {} })).resolves.toEqual({
      ok: false,
      status: 200,
      body: { ok: false, message: "Não deu." },
    });
  });

  // Sem o campo, também não: sucesso é `ok: true`, não "ok diferente de false".
  it("2xx sem o campo ok é recusa", async () => {
    stubFetch(jsonResponse({ tickets: [] }));

    await expect(ticketRequest("/api/tickets")).resolves.toEqual({
      ok: false,
      status: 200,
      body: { tickets: [], ok: false },
    });
  });

  // E o HTTP também precisa concordar: `ok: true` num 5xx não é sucesso.
  it("5xx com ok: true no corpo é recusa", async () => {
    stubFetch(jsonResponse({ ok: true }, 500));

    await expect(ticketRequest(TRANSITION_URL, { method: "POST", body: {} })).resolves.toEqual({
      ok: false,
      status: 500,
      body: { ok: false },
    });
  });

  it("409 devolve o corpo de erro com os extras do código", async () => {
    stubFetch(
      jsonResponse(
        {
          ok: false,
          code: "already_assigned",
          message: "Já está com outra pessoa.",
          assigned_to_user_id: "u2",
          assigned_to_name: "Ana",
        },
        409
      )
    );

    await expect(ticketRequest(TRANSITION_URL, { method: "POST", body: {} })).resolves.toEqual({
      ok: false,
      status: 409,
      body: {
        ok: false,
        code: "already_assigned",
        message: "Já está com outra pessoa.",
        assigned_to_user_id: "u2",
        assigned_to_name: "Ana",
      },
    });
  });

  // Defensivo: as rotas de ticket mandam `ok: false` em todo erro (o 400 do zod
  // inclusive), mas um corpo de erro sem `ok` (proxy, rota fora do padrão) sai
  // marcado do mesmo jeito.
  it("corpo de erro sem `ok` sai marcado como ok: false", async () => {
    stubFetch(jsonResponse({ message: "Revise os campos.", errors: { title: ["Informe."] } }, 400));

    const result = await ticketRequest(TRANSITION_URL, { method: "POST", body: {} });

    expect(result).toEqual({
      ok: false,
      status: 400,
      body: { ok: false, message: "Revise os campos.", errors: { title: ["Informe."] } },
    });
  });

  it("corpo que não é JSON (ou não é objeto) dá body nulo", async () => {
    stubFetch(new Response("<html>502</html>", { status: 502 }));
    await expect(ticketRequest(TRANSITION_URL)).resolves.toEqual({ ok: false, status: 502, body: null });

    stubFetch(jsonResponse(["x"], 500));
    await expect(ticketRequest(TRANSITION_URL)).resolves.toEqual({ ok: false, status: 500, body: null });
  });

  it("falha de rede não lança: status 0", async () => {
    stubFetch(new TypeError("Failed to fetch"));

    await expect(ticketRequest(TRANSITION_URL, { method: "POST", body: {} })).resolves.toEqual({
      ok: false,
      status: 0,
      body: null,
    });
  });

  it("requisição cancelada não lança: status 0", async () => {
    stubFetch(new DOMException("The operation was aborted.", "AbortError"));

    await expect(ticketRequest(TRANSITION_URL)).resolves.toEqual({ ok: false, status: 0, body: null });
  });
});

describe("ticketFieldError", () => {
  it("devolve a 1ª mensagem de campo", () => {
    expect(
      ticketFieldError({
        ok: false,
        code: "invalid_input",
        message: "Revise os campos.",
        errors: { title: [], reason: ["Informe o motivo do cancelamento."] },
      })
    ).toBe("Informe o motivo do cancelamento.");
  });

  it("sem `errors` (ou sem corpo) não inventa texto", () => {
    expect(ticketFieldError({ ok: false, code: "x", message: "Falhou." })).toBeUndefined();
    expect(ticketFieldError(null)).toBeUndefined();
  });
});

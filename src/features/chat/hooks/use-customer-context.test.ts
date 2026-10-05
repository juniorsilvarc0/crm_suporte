import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useCustomerContext } from "@/features/chat/hooks/use-customer-context";

const OK = { state: "ok", context: { externalId: "33" } };
const fetchMock = vi.fn();
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(jsonResponse({ ok: true, result: OK }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCustomerContext", () => {
  it("desligado (sem CNPJ): não busca, sem resultado", () => {
    const { result } = renderHook(() => useCustomerContext("c1", false));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.result).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("sem empresa: não busca", () => {
    renderHook(() => useCustomerContext(null, true));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ligado: busca pela empresa e devolve o resultado da fonte", async () => {
    const { result } = renderHook(() => useCustomerContext("c1", true));

    await waitFor(() => expect(result.current.result).toEqual(OK));
    expect(fetchMock).toHaveBeenCalledWith("/api/customers/c1/external-context");
    expect(result.current.loading).toBe(false);
  });

  it("resposta não-ok vira unavailable", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false }, 500));
    const { result } = renderHook(() => useCustomerContext("c1", true));

    await waitFor(() => expect(result.current.result).toEqual({ state: "unavailable" }));
  });

  it("falha de rede vira unavailable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const { result } = renderHook(() => useCustomerContext("c1", true));

    await waitFor(() => expect(result.current.result).toEqual({ state: "unavailable" }));
  });

  it("retry busca de novo", async () => {
    const { result } = renderHook(() => useCustomerContext("c1", true));
    await waitFor(() => expect(result.current.result).toEqual(OK));

    result.current.retry();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("trocar de empresa zera o resultado e busca a nova", async () => {
    const { result, rerender } = renderHook(({ id }) => useCustomerContext(id, true), {
      initialProps: { id: "c1" },
    });
    await waitFor(() => expect(result.current.result).toEqual(OK));

    fetchMock.mockResolvedValue(jsonResponse({ ok: true, result: { state: "not_found" } }));
    rerender({ id: "c2" });

    await waitFor(() => expect(result.current.result).toEqual({ state: "not_found" }));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/customers/c2/external-context");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useTicketCatalog } from "@/features/tickets/hooks/use-ticket-catalog";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PRODUCTS = [{ id: "q1", name: "ERP Varejo", niche: null, color: "blue", archived_at: null }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTicketCatalog", () => {
  it("lê o catálogo e mantém `null` na parte que falhou", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, statuses: null, transitions: [], priorities: null, products: PRODUCTS, categories: [] })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTicketCatalog());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.failed).toBe(false);
    expect(result.current.catalog).toEqual({
      statuses: null,
      transitions: [],
      priorities: null,
      products: PRODUCTS,
      categories: [],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/tickets/catalog");
  });

  it("falha tem saída: `retry` volta a carregar e relê", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: false, message: "Falhou." }, 500))
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, statuses: [], transitions: [], priorities: [], products: [], categories: [] })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTicketCatalog());
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.catalog).toBeNull();

    act(() => result.current.retry());
    expect(result.current.loading).toBe(true);
    expect(result.current.failed).toBe(false);

    await waitFor(() => expect(result.current.catalog?.products).toEqual([]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

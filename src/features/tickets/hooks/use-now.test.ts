import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { NOW_TICK_MS, useNow } from "@/features/tickets/hooks/use-now";

// O fetchedAt do servidor e o relógio do navegador, fixos.
const FETCHED_AT = "2026-09-25T12:00:00.000Z";
const CLIENT_NOW = new Date("2026-09-25T12:00:05.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(CLIENT_NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useNow", () => {
  it("começa no fetchedAt do servidor, não no relógio do navegador", () => {
    const { result } = renderHook(() => useNow(FETCHED_AT));

    expect(result.current.toISOString()).toBe(FETCHED_AT);
  });

  it("avança a cada 60 s no navegador", () => {
    const { result } = renderHook(() => useNow(FETCHED_AT));

    act(() => {
      vi.advanceTimersByTime(NOW_TICK_MS - 1);
    });
    expect(result.current.toISOString()).toBe(FETCHED_AT);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.getTime()).toBe(CLIENT_NOW.getTime() + NOW_TICK_MS);

    act(() => {
      vi.advanceTimersByTime(NOW_TICK_MS);
    });
    expect(result.current.getTime()).toBe(CLIENT_NOW.getTime() + 2 * NOW_TICK_MS);
  });

  it("devolve o mesmo Date entre renders sem tique", () => {
    const { result, rerender } = renderHook(() => useNow(FETCHED_AT));
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it("adota o fetchedAt de um refresh quando ele é mais recente", () => {
    const { result, rerender } = renderHook(({ at }) => useNow(at), {
      initialProps: { at: FETCHED_AT },
    });
    act(() => {
      vi.advanceTimersByTime(NOW_TICK_MS);
    });

    const refreshedAt = "2026-09-25T12:10:00.000Z";
    rerender({ at: refreshedAt });

    expect(result.current.toISOString()).toBe(refreshedAt);
  });

  it("nunca volta no tempo com o relógio do navegador atrasado", () => {
    // Navegador 5 min atrás do servidor: o tique fica antes do fetchedAt.
    vi.setSystemTime(new Date("2026-09-25T11:55:00.000Z"));
    const { result } = renderHook(() => useNow(FETCHED_AT));

    act(() => {
      vi.advanceTimersByTime(NOW_TICK_MS);
    });

    expect(result.current.toISOString()).toBe(FETCHED_AT);
  });

  it("com fetchedAt inválido, cede ao tique do navegador", () => {
    const { result } = renderHook(() => useNow("não é data"));
    expect(Number.isNaN(result.current.getTime())).toBe(true);

    act(() => {
      vi.advanceTimersByTime(NOW_TICK_MS);
    });

    expect(result.current.getTime()).toBe(CLIENT_NOW.getTime() + NOW_TICK_MS);
  });

  it("limpa o intervalo ao desmontar", () => {
    const clearSpy = vi.spyOn(window, "clearInterval");
    const { unmount } = renderHook(() => useNow(FETCHED_AT));

    unmount();

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

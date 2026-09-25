import { beforeEach, describe, expect, it, vi } from "vitest";

const { setAuthMock, subscribeMock, removeChannelMock } = vi.hoisted(() => ({
  setAuthMock: vi.fn(),
  subscribeMock: vi.fn(),
  removeChannelMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    realtime: { setAuth: setAuthMock },
    channel: () => ({ subscribe: subscribeMock }),
    removeChannel: removeChannelMock,
  }),
}));

import { __resetSupabaseBrowserTokenCache, subscribeAuthenticated } from "@/lib/supabase/client";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function tokenResponse(ok: boolean) {
  return ok
    ? Response.json({ token: "jwt", expiresAt: Math.floor(Date.now() / 1000) + 900 })
    : new Response(null, { status: 401 });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetSupabaseBrowserTokenCache();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  subscribeMock.mockImplementation(function (this: unknown) {
    return this;
  });
});

describe("subscribeAuthenticated", () => {
  it("só assina depois de o token estar no socket", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => tokenResponse(true)));
    let releaseAuth!: () => void;
    setAuthMock.mockReturnValue(new Promise<void>((resolve) => (releaseAuth = resolve)));

    subscribeAuthenticated((supabase) => supabase.channel("c"));
    await flush();
    expect(setAuthMock).toHaveBeenCalledWith();
    expect(subscribeMock).not.toHaveBeenCalled();

    releaseAuth();
    await flush();
    expect(subscribeMock).toHaveBeenCalledTimes(1);
  });

  it("sem token (sessão expirada) não assina como anônimo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => tokenResponse(false)));

    subscribeAuthenticated((supabase) => supabase.channel("c"));
    await flush();

    expect(setAuthMock).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("desmontar antes do token chegar não deixa canal aberto", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => tokenResponse(true)));
    setAuthMock.mockResolvedValue(undefined);

    const unsubscribe = subscribeAuthenticated((supabase) => supabase.channel("c"));
    unsubscribe();
    await flush();

    expect(subscribeMock).not.toHaveBeenCalled();
  });
});

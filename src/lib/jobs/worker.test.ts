// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, envMock, createMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  envMock: vi.fn(() => true),
  createMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: envMock,
  createSupabaseAdminClient: createMock,
}));

import { runSlaSweep, startJobs } from "@/lib/jobs/worker";

type Store = typeof globalThis & { __crmsupJobsStarted?: boolean };

beforeEach(() => {
  vi.clearAllMocks();
  envMock.mockReturnValue(true);
  rpcMock.mockResolvedValue({ error: null });
  createMock.mockReturnValue({ rpc: rpcMock });
  (globalThis as Store).__crmsupJobsStarted = undefined;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runSlaSweep", () => {
  it("chama a RPC sla_sweep", async () => {
    await runSlaSweep({ rpc: rpcMock } as never);
    expect(rpcMock).toHaveBeenCalledWith("sla_sweep");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("loga quando a RPC devolve erro, sem lançar", async () => {
    rpcMock.mockResolvedValue({ error: { code: "XX", message: "boom" } });
    await expect(runSlaSweep({ rpc: rpcMock } as never)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("engole exceção da RPC (nunca derruba o worker)", async () => {
    rpcMock.mockRejectedValue(new Error("rede"));
    await expect(runSlaSweep({ rpc: rpcMock } as never)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("startJobs", () => {
  it("sem Supabase admin não inicia", () => {
    envMock.mockReturnValue(false);
    const setInterval = vi.spyOn(globalThis, "setInterval");

    startJobs();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(setInterval).not.toHaveBeenCalled();
    expect((globalThis as Store).__crmsupJobsStarted).toBeFalsy();
  });

  it("inicia: tenta já e agenda o intervalo; segunda chamada não duplica", () => {
    const setInterval = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue({ unref: vi.fn() } as never);

    startJobs();
    // Tentativa imediata + um único intervalo agendado.
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenCalledTimes(1);
    expect((globalThis as Store).__crmsupJobsStarted).toBe(true);

    startJobs(); // guarda: não reinicia
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenCalledTimes(1);
  });
});

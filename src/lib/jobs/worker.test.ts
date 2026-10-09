// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, envMock, createMock, reconcileMock, dispatchMock, checkMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  envMock: vi.fn(() => true),
  createMock: vi.fn(),
  reconcileMock: vi.fn(),
  dispatchMock: vi.fn(),
  checkMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: envMock,
  createSupabaseAdminClient: createMock,
}));
vi.mock("@/features/customers/server/external-contracts", () => ({
  reconcileExternalContracts: reconcileMock,
}));
vi.mock("@/features/integrations/server/relay-dispatch", () => ({
  dispatchRelayBatch: dispatchMock,
}));
vi.mock("@/features/connection/server/connection-monitor", () => ({
  checkWhatsappConnection: checkMock,
}));

import {
  runMaintenance,
  runRelayDispatch,
  runSlaSweep,
  runTcbxReconcile,
  runWhatsappMonitor,
  startJobs,
} from "@/lib/jobs/worker";

type Store = typeof globalThis & { __crmsupJobsStarted?: boolean };

const client = { rpc: rpcMock } as never;

// Por padrão: a RPC devolve ok; o lease NÃO é pego (job_claim claimed:false),
// para os testes de "não roda" serem o default e cada teste liberar o seu.
function defaultRpc() {
  rpcMock.mockImplementation((name: string) =>
    name === "job_claim"
      ? Promise.resolve({ data: { claimed: false }, error: null })
      : Promise.resolve({ data: null, error: null })
  );
}

function claimGranted(cursor: string | null = null) {
  rpcMock.mockImplementation((name: string) =>
    name === "job_claim"
      ? Promise.resolve({ data: { claimed: true, cursor }, error: null })
      : Promise.resolve({ data: null, error: null })
  );
}

const report = (overrides: Record<string, unknown> = {}) => ({
  processed: 1,
  ok: 1,
  notFound: 0,
  unavailable: 0,
  ambiguous: 0,
  skipped: 0,
  contractsUpserted: 1,
  cursor: "cust-20",
  done: false,
  notConfigured: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  envMock.mockReturnValue(true);
  createMock.mockReturnValue(client);
  reconcileMock.mockResolvedValue(report());
  dispatchMock.mockResolvedValue(undefined);
  defaultRpc();
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
    await runSlaSweep(client);
    expect(rpcMock).toHaveBeenCalledWith("sla_sweep");
  });

  it("engole erro e exceção (nunca derruba o worker)", async () => {
    rpcMock.mockResolvedValueOnce({ error: { code: "X", message: "boom" } });
    await expect(runSlaSweep(client)).resolves.toBeUndefined();
    rpcMock.mockRejectedValueOnce(new Error("rede"));
    await expect(runSlaSweep(client)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe("runTcbxReconcile", () => {
  it("com o lease: reconcilia uma leva e salva o cursor", async () => {
    claimGranted(null);
    await runTcbxReconcile(client);

    expect(reconcileMock).toHaveBeenCalledWith(client, { limit: 20, after: null });
    expect(rpcMock).toHaveBeenCalledWith("job_cursor_set", {
      p_name: "tcbx_reconcile",
      p_cursor: "cust-20",
    });
  });

  it("no fim da volta (done) ou fonte desligada, zera o cursor", async () => {
    claimGranted("cust-999");
    reconcileMock.mockResolvedValue(report({ done: true, cursor: null }));
    await runTcbxReconcile(client);
    expect(rpcMock).toHaveBeenCalledWith("job_cursor_set", {
      p_name: "tcbx_reconcile",
      p_cursor: "",
    });
  });

  it("sem o lease (outra réplica), não reconcilia", async () => {
    // default: claimed:false
    await runTcbxReconcile(client);
    expect(reconcileMock).not.toHaveBeenCalled();
  });
});

describe("runRelayDispatch", () => {
  it("drena a leva pelo dispatch do outbox", async () => {
    await runRelayDispatch(client);
    expect(dispatchMock).toHaveBeenCalledWith(client);
  });

  it("engole erro (nunca derruba o worker)", async () => {
    dispatchMock.mockRejectedValueOnce(new Error("boom"));
    await expect(runRelayDispatch(client)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe("runMaintenance", () => {
  it("com o lease, purga chaves e logs", async () => {
    claimGranted();
    await runMaintenance(client);
    expect(rpcMock).toHaveBeenCalledWith("api_idempotency_purge");
    expect(rpcMock).toHaveBeenCalledWith("purge_integration_logs");
  });

  it("sem o lease, não purga", async () => {
    await runMaintenance(client);
    expect(rpcMock).not.toHaveBeenCalledWith("api_idempotency_purge");
  });
});

describe("startJobs", () => {
  it("sem Supabase admin não inicia", () => {
    envMock.mockReturnValue(false);
    const setInterval = vi.spyOn(globalThis, "setInterval");
    startJobs();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(setInterval).not.toHaveBeenCalled();
  });

  it("inicia os cinco jobs; segunda chamada não duplica", () => {
    const setInterval = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue({ unref: vi.fn() } as never);

    startJobs();
    // Imediato no boot: sla_sweep, o dispatch do relay e o job_claim do tcbx.
    expect(rpcMock).toHaveBeenCalledWith("sla_sweep");
    expect(dispatchMock).toHaveBeenCalledWith(client);
    expect(rpcMock).toHaveBeenCalledWith("job_claim", { p_name: "tcbx_reconcile", p_seconds: 290 });
    expect(rpcMock).toHaveBeenCalledWith("job_claim", { p_name: "whatsapp_monitor", p_seconds: 110 });
    // Cinco intervalos (SLA, relay, TCBX, manutenção, WhatsApp).
    expect(setInterval).toHaveBeenCalledTimes(5);
    expect((globalThis as Store).__crmsupJobsStarted).toBe(true);

    const before = rpcMock.mock.calls.length;
    startJobs(); // guarda
    expect(rpcMock.mock.calls.length).toBe(before);
    expect(setInterval).toHaveBeenCalledTimes(5);
  });
});

describe("runWhatsappMonitor", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    checkMock.mockReset();
    checkMock.mockResolvedValue({ status: "unchanged", state: "open" });
  });

  it("com o lease, roda a checagem (uma réplica por ciclo)", async () => {
    claimGranted();
    await runWhatsappMonitor(client);
    expect(rpcMock).toHaveBeenCalledWith("job_claim", { p_name: "whatsapp_monitor", p_seconds: 110 });
    expect(checkMock).toHaveBeenCalledWith(client);
  });

  it("sem o lease (outra réplica rodando), não checa", async () => {
    defaultRpc();
    await runWhatsappMonitor(client);
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("nunca derruba o processo", async () => {
    claimGranted();
    checkMock.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(runWhatsappMonitor(client)).resolves.toBeUndefined();
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireAdminMock, backfillMock, clientMock, hasEnvMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  backfillMock: vi.fn(),
  clientMock: vi.fn(),
  hasEnvMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireDashboardAdmin: requireAdminMock }));
vi.mock("@/features/customers/server/backfill-external", () => ({ backfillExternalCustomers: backfillMock }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: clientMock, hasSupabaseAdminEnv: hasEnvMock }));

import { POST } from "@/app/api/customers/backfill-external/route";

const REPORT = {
  processed: 2,
  created: 1,
  reused: 0,
  linked: 2,
  notFound: 0,
  skippedPf: 0,
  errors: 0,
  remaining: 7,
};

const post = (body: unknown) =>
  POST(
    new Request("http://crm.test/api/customers/backfill-external", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  hasEnvMock.mockReturnValue(true);
  clientMock.mockReturnValue({});
  backfillMock.mockResolvedValue(REPORT);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/customers/backfill-external", () => {
  it("recusa quem não é admin, sem rodar o backfill", async () => {
    requireAdminMock.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 403 }) });

    const response = await post({ apply: true });

    expect(response.status).toBe(403);
    expect(backfillMock).not.toHaveBeenCalled();
  });

  it("aplica (apply=true) com o id do admin, e devolve o relatório", async () => {
    const response = await post({ apply: true, limit: 50 });

    expect(backfillMock).toHaveBeenCalledWith(expect.anything(), { apply: true, limit: 50, createdBy: "admin-1" });
    expect(await response.json()).toEqual({ ok: true, apply: true, report: REPORT });
  });

  it("ensaio por padrão: sem apply, roda com apply=false", async () => {
    await post({});
    expect(backfillMock).toHaveBeenCalledWith(expect.anything(), { apply: false, limit: undefined, createdBy: "admin-1" });
  });

  it("limit que não é número é ignorado", async () => {
    await post({ apply: true, limit: "muitos" });
    expect(backfillMock).toHaveBeenCalledWith(expect.anything(), { apply: true, limit: undefined, createdBy: "admin-1" });
  });

  it("sem Supabase admin: 500, sem rodar o backfill", async () => {
    hasEnvMock.mockReturnValue(false);

    expect((await post({ apply: true })).status).toBe(500);
    expect(backfillMock).not.toHaveBeenCalled();
  });

  it("o backfill lança: 500 com aviso", async () => {
    backfillMock.mockRejectedValue(new Error("tcbx fora"));

    const response = await post({ apply: true });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, message: "Não foi possível executar o cadastro em massa." });
  });
});

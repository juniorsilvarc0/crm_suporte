// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireUserMock, contextMock, clientMock, hasEnvMock, maybeSingleMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  contextMock: vi.fn(),
  clientMock: vi.fn(),
  hasEnvMock: vi.fn(),
  maybeSingleMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireDashboardUser: requireUserMock }));
vi.mock("@/features/customer-source/get-customer-context", () => ({ getCustomerContext: contextMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: clientMock,
  hasSupabaseAdminEnv: hasEnvMock,
}));

import { GET } from "@/app/api/customers/[id]/external-context/route";

const ID = "0b8f2c1e-6a4d-4f2b-9c1a-7d3e5f6a8b90";
const CONTEXT = { externalId: "33", documento: "12.321.030/0001-89" };

const get = (id = ID) =>
  GET(new Request(`http://crm.test/api/customers/${id}/external-context`), { params: Promise.resolve({ id }) });

// A cadeia .from("customers").select("cnpj").eq("id", id).maybeSingle()
const selectMock = vi.fn(() => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }));

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ viewer: { id: "u1", role: "member" } });
  hasEnvMock.mockReturnValue(true);
  clientMock.mockReturnValue({ from: vi.fn(() => ({ select: selectMock })) });
  maybeSingleMock.mockResolvedValue({ data: { cnpj: "12321030000189" }, error: null });
  contextMock.mockResolvedValue({ state: "ok", context: CONTEXT });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/customers/[id]/external-context", () => {
  it("recusa quem não tem sessão, sem consultar nada", async () => {
    requireUserMock.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 401 }) });

    const response = await get();

    expect(response.status).toBe(401);
    expect(clientMock).not.toHaveBeenCalled();
    expect(contextMock).not.toHaveBeenCalled();
  });

  it("id que não é uuid: 400", async () => {
    const response = await get("nao-e-uuid");
    expect(response.status).toBe(400);
    expect(contextMock).not.toHaveBeenCalled();
  });

  it("empresa com CNPJ: consulta a fonte por documento e devolve o resultado", async () => {
    const response = await get();

    expect(selectMock).toHaveBeenCalledWith("cnpj");
    expect(contextMock).toHaveBeenCalledWith({ documento: "12321030000189" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: { state: "ok", context: CONTEXT } });
  });

  it("repassa not_found/unavailable da fonte como vêm", async () => {
    contextMock.mockResolvedValue({ state: "not_found" });
    expect(await (await get()).json()).toEqual({ ok: true, result: { state: "not_found" } });

    contextMock.mockResolvedValue({ state: "not_configured" });
    expect(await (await get()).json()).toEqual({ ok: true, result: { state: "not_configured" } });
  });

  it("empresa sem CNPJ: not_found, sem chamar a fonte", async () => {
    maybeSingleMock.mockResolvedValue({ data: { cnpj: null }, error: null });

    expect(await (await get()).json()).toEqual({ ok: true, result: { state: "not_found" } });
    expect(contextMock).not.toHaveBeenCalled();
  });

  it("empresa inexistente: not_found", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });

    expect(await (await get()).json()).toEqual({ ok: true, result: { state: "not_found" } });
    expect(contextMock).not.toHaveBeenCalled();
  });

  it("a leitura da empresa falha: unavailable (não 'sem dados')", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });

    expect(await (await get()).json()).toEqual({ ok: true, result: { state: "unavailable" } });
    expect(contextMock).not.toHaveBeenCalled();
  });

  it("sem Supabase admin: unavailable, sem tocar o banco", async () => {
    hasEnvMock.mockReturnValue(false);

    expect(await (await get()).json()).toEqual({ ok: true, result: { state: "unavailable" } });
    expect(clientMock).not.toHaveBeenCalled();
  });
});

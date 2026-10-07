// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireUserMock, contextMock, resolveMock, clientMock, hasEnvMock, contactRow, customerRow } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  contextMock: vi.fn(),
  resolveMock: vi.fn(),
  clientMock: vi.fn(),
  hasEnvMock: vi.fn(),
  contactRow: vi.fn(),
  customerRow: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireDashboardUser: requireUserMock }));
vi.mock("@/features/customer-source/get-customer-context", () => ({ getCustomerContext: contextMock }));
vi.mock("@/features/customer-source/resolve-by-phone", () => ({ resolveCustomerByPhone: resolveMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: clientMock,
  hasSupabaseAdminEnv: hasEnvMock,
}));

import { GET } from "@/app/api/contacts/[id]/external-context/route";

const ID = "0b8f2c1e-6a4d-4f2b-9c1a-7d3e5f6a8b90";
const CUSTOMER_ID = "7e1c5a3b-9d2f-4b8a-a6c4-1e3f5d7b9a2c";
const CONTEXT = { externalId: "33" };

const get = (id = ID) =>
  GET(new Request(`http://crm.test/api/contacts/${id}/external-context`), { params: Promise.resolve({ id }) });

// Roteia .from("contacts") e .from("customers") para respostas diferentes.
const selectFor = (table: string) => () => ({
  eq: () => ({ maybeSingle: table === "contacts" ? contactRow : customerRow }),
});

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ viewer: { id: "u1", role: "member" } });
  hasEnvMock.mockReturnValue(true);
  clientMock.mockReturnValue({ from: (table: string) => ({ select: selectFor(table) }) });
  contactRow.mockResolvedValue({ data: { phone: "558699783446", customer_id: CUSTOMER_ID }, error: null });
  customerRow.mockResolvedValue({ data: { cnpj: "12321030000189" }, error: null });
  contextMock.mockResolvedValue({ state: "ok", context: CONTEXT });
  resolveMock.mockResolvedValue({ state: "ok", context: CONTEXT });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/contacts/[id]/external-context", () => {
  it("recusa quem não tem sessão, sem consultar nada", async () => {
    requireUserMock.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 401 }) });

    const response = await get();

    expect(response.status).toBe(401);
    expect(clientMock).not.toHaveBeenCalled();
    expect(contextMock).not.toHaveBeenCalled();
  });

  it("id que não é uuid: 400", async () => {
    expect((await get("nao-uuid")).status).toBe(400);
    expect(contextMock).not.toHaveBeenCalled();
  });

  it("contato com empresa que tem CNPJ: consulta por DOCUMENTO (mais preciso)", async () => {
    const response = await get();

    expect(contextMock).toHaveBeenCalledWith({ documento: "12321030000189" });
    expect(await response.json()).toEqual({ ok: true, result: { state: "ok", context: CONTEXT } });
  });

  it("contato com empresa SEM CNPJ: cai no TELEFONE", async () => {
    customerRow.mockResolvedValue({ data: { cnpj: null }, error: null });

    await get();

    expect(resolveMock).toHaveBeenCalledWith("558699783446");
    expect(contextMock).not.toHaveBeenCalled();
  });

  it("contato sem empresa vinculada: consulta por TELEFONE, sem ler empresa", async () => {
    contactRow.mockResolvedValue({ data: { phone: "558699783446", customer_id: null }, error: null });

    await get();

    expect(customerRow).not.toHaveBeenCalled();
    expect(resolveMock).toHaveBeenCalledWith("558699783446");
  });

  it("repassa not_found/not_configured da fonte como vêm", async () => {
    contextMock.mockResolvedValue({ state: "not_configured" });
    expect(await (await get()).json()).toEqual({ ok: true, result: { state: "not_configured" } });
  });

  it("contato inexistente: not_found, sem chamar a fonte", async () => {
    contactRow.mockResolvedValue({ data: null, error: null });

    expect(await (await get()).json()).toEqual({ ok: true, result: { state: "not_found" } });
    expect(contextMock).not.toHaveBeenCalled();
  });

  it("a leitura do contato falha: unavailable", async () => {
    contactRow.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });

    expect(await (await get()).json()).toEqual({ ok: true, result: { state: "unavailable" } });
    expect(contextMock).not.toHaveBeenCalled();
  });

  it("a leitura da empresa falha: unavailable (não cai no telefone silenciosamente)", async () => {
    customerRow.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });

    expect(await (await get()).json()).toEqual({ ok: true, result: { state: "unavailable" } });
    expect(contextMock).not.toHaveBeenCalled();
  });

  it("sem Supabase admin: unavailable, sem tocar o banco", async () => {
    hasEnvMock.mockReturnValue(false);

    expect(await (await get()).json()).toEqual({ ok: true, result: { state: "unavailable" } });
    expect(clientMock).not.toHaveBeenCalled();
  });
});

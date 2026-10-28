// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireAdminMock, integrationMock, statusMock, listMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  integrationMock: vi.fn(),
  statusMock: vi.fn(),
  listMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireDashboardAdmin: requireAdminMock }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/features/chat/lib/connection/integration", () => ({ getUazapiIntegration: integrationMock }));
vi.mock("@/features/chat/lib/connection/uazapi", () => ({
  getUazapiStatus: statusMock,
  listUazapiGroups: listMock,
}));

import { GET } from "@/app/api/connection/groups/route";

const INTEGRATION = { id: "i1", apiUrl: "https://inst.uazapi.com", token: "tok", phone_number: null };
const GROUPS = [{ jid: "120363000000000001@g.us", name: "Equipe" }];
const get = (query = "") => GET(new Request(`http://x/api/connection/groups${query}`));

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/connection/groups", () => {
  it("conectado: os grupos do cache; ?force=1 relê do WhatsApp", async () => {
    requireAdminMock.mockResolvedValue({ viewer: { id: "u1", role: "admin" } });
    integrationMock.mockResolvedValue(INTEGRATION);
    statusMock.mockResolvedValue({ connected: true });
    listMock.mockResolvedValue(GROUPS);

    expect(await (await get()).json()).toStrictEqual({ ok: true, connected: true, groups: GROUPS });
    expect(listMock).toHaveBeenLastCalledWith("https://inst.uazapi.com", "tok", false);

    await get("?force=1");
    expect(listMock).toHaveBeenLastCalledWith("https://inst.uazapi.com", "tok", true);
  });

  it("sem WhatsApp configurado ou desconectado: lista vazia com o motivo, sem pedir os grupos", async () => {
    requireAdminMock.mockResolvedValue({ viewer: { id: "u1", role: "admin" } });
    integrationMock.mockResolvedValue(null);
    expect(await (await get()).json()).toMatchObject({ ok: true, connected: false, groups: [] });

    integrationMock.mockResolvedValue(INTEGRATION);
    statusMock.mockResolvedValue({ connected: false });
    const body = await (await get()).json();
    expect(body).toMatchObject({ ok: true, connected: false, groups: [] });
    expect(body.message).toContain("desconectado");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("falha do provedor: 502 com lista vazia", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    requireAdminMock.mockResolvedValue({ viewer: { id: "u1", role: "admin" } });
    integrationMock.mockResolvedValue(INTEGRATION);
    statusMock.mockResolvedValue({ connected: true });
    listMock.mockRejectedValue(new Error("uazapi group/list 500"));

    const res = await get();

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, groups: [] });
  });

  it("não-admin: o erro de auth, sem tocar no WhatsApp", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ ok: false, message: "forbidden" }, { status: 403 }),
    });

    expect((await get()).status).toBe(403);
    expect(integrationMock).not.toHaveBeenCalled();
  });
});

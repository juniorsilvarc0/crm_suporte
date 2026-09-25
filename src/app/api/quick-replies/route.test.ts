import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { guardMock, getQuickRepliesMock, insertMock, selectMock, singleMock } = vi.hoisted(() => ({
  guardMock: vi.fn(),
  getQuickRepliesMock: vi.fn(),
  insertMock: vi.fn(),
  selectMock: vi.fn(),
  singleMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: guardMock,
}));
vi.mock("@/features/quick-replies/queries/get-quick-replies", () => ({
  getQuickReplies: getQuickRepliesMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: () => ({ from: () => ({ insert: insertMock }) }),
}));

import { GET, POST } from "@/app/api/quick-replies/route";

function get(url: string) {
  return new Request(url);
}

function post(body: unknown) {
  return new Request("http://x/api/quick-replies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  guardMock.mockResolvedValue({ viewer: { id: "user-1", role: "member", is_active: true } });
  getQuickRepliesMock.mockResolvedValue([]);
  singleMock.mockResolvedValue({ data: { id: "reply-1", title: "Valores" }, error: null });
  selectMock.mockReturnValue({ single: singleMock });
  insertMock.mockReturnValue({ select: selectMock });
});

describe("GET /api/quick-replies", () => {
  it("devolve só as ativas por padrão", async () => {
    await GET(get("http://x/api/quick-replies"));

    expect(getQuickRepliesMock).toHaveBeenCalledWith({ activeOnly: true });
  });

  it("inclui as inativas com scope=all", async () => {
    // O popover do chat gerencia: não dá para reativar o que não aparece.
    await GET(get("http://x/api/quick-replies?scope=all"));

    expect(getQuickRepliesMock).toHaveBeenCalledWith({ activeOnly: false });
  });

  it("recusa sem sessão antes de consultar o banco", async () => {
    guardMock.mockResolvedValue({
      error: NextResponse.json({ ok: false }, { status: 401 }),
    });

    const response = await GET(get("http://x/api/quick-replies"));

    expect(response.status).toBe(401);
    expect(getQuickRepliesMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/quick-replies", () => {
  it("deixa um membro criar e registra a autoria", async () => {
    const response = await POST(
      post({ title: "Valores", shortcut: "/Valores", content: "R$ 500" }),
    );

    expect(response.status).toBe(200);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Valores",
        // O schema normaliza: tira a barra e baixa a caixa.
        shortcut: "valores",
        content: "R$ 500",
        is_active: true,
        created_by_user_id: "user-1",
      }),
    );
  });

  it("recusa campo inválido sem tocar no banco", async () => {
    const response = await POST(post({ title: "", shortcut: "x", content: "y" }));

    expect(response.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("traduz atalho duplicado em 409", async () => {
    singleMock.mockResolvedValue({ data: null, error: { code: "23505" } });

    const response = await POST(post({ title: "Valores", shortcut: "valores", content: "R$" }));

    expect(response.status).toBe(409);
  });
});

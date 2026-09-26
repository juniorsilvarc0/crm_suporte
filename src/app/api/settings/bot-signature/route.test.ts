import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// Mocka as fronteiras: auth de admin, client admin (upsert) e o push ao agente.
const { requireAdminMock, pushMock, upsertMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  pushMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardAdmin: requireAdminMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: () => ({
    from: () => ({ upsert: upsertMock }),
  }),
}));

vi.mock("@/features/settings/lib/push-bot-signature", () => ({
  pushBotSignatureToAgent: pushMock,
}));

import { PATCH } from "@/app/api/settings/bot-signature/route";

function patch(body: unknown) {
  return new Request("http://x/api/settings/bot-signature", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/settings/bot-signature", () => {
  it("não-admin → devolve o erro de auth, sem gravar nem avisar o agente", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ ok: false, message: "forbidden" }, { status: 403 }),
    });

    const res = await PATCH(patch({ enabled: true, apelido: "Ana Lima" }));

    expect(res.status).toBe(403);
    expect(upsertMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("ligado sem apelido → 400 (regra de produto), sem gravar", async () => {
    requireAdminMock.mockResolvedValue({ viewer: { id: "u1", role: "admin" } });

    const res = await PATCH(patch({ enabled: true, apelido: "" }));

    expect(res.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("sucesso → upsert na chave certa, push com a config e resposta incluindo agent", async () => {
    requireAdminMock.mockResolvedValue({ viewer: { id: "u1", role: "admin" } });
    upsertMock.mockResolvedValue({ error: null });
    pushMock.mockResolvedValue({ delivered: true, skipped: false });

    const res = await PATCH(patch({ enabled: true, apelido: "Ana Lima" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      enabled: true,
      apelido: "Ana Lima",
      agent: { delivered: true, skipped: false },
    });

    // grava na chave dedicada, sem colidir com 'automation'
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock.mock.calls[0][0]).toMatchObject({
      key: "bot_signature",
      value: { enabled: true, apelido: "Ana Lima" },
    });
    expect(upsertMock.mock.calls[0][1]).toEqual({ onConflict: "key" });

    // o push recebe a config salva
    expect(pushMock).toHaveBeenCalledWith({ enabled: true, apelido: "Ana Lima" });
  });

  it("erro no upsert → 500, sem tentar avisar o agente", async () => {
    requireAdminMock.mockResolvedValue({ viewer: { id: "u1", role: "admin" } });
    upsertMock.mockResolvedValue({ error: { message: "boom" } });

    const res = await PATCH(patch({ enabled: false, apelido: "" }));

    expect(res.status).toBe(500);
    expect(pushMock).not.toHaveBeenCalled();
  });
});

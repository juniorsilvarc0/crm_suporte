import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// Mesma fronteira mockada dos outros testes de /api/integracao/*: só a
// autorização (coberta por verify-webhook.test.ts) e a leitura da config.
const { authorizeIntegrationMock, getBotSignatureConfigMock } = vi.hoisted(() => ({
  authorizeIntegrationMock: vi.fn(),
  getBotSignatureConfigMock: vi.fn(),
}));

vi.mock("@/features/integrations/lib/authorize-integration", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/integrations/lib/authorize-integration")>();
  return { ...actual, authorizeIntegration: authorizeIntegrationMock };
});

vi.mock("@/features/settings/lib/get-bot-signature", () => ({
  getBotSignatureConfig: getBotSignatureConfigMock,
}));

import { GET } from "@/app/api/integracao/bot-signature/route";

function request() {
  return new Request("http://x/api/integracao/bot-signature");
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/integracao/bot-signature", () => {
  it("devolve o erro de autorização quando o token é inválido (401)", async () => {
    authorizeIntegrationMock.mockResolvedValue({
      error: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }),
    });

    const res = await GET(request());

    expect(res.status).toBe(401);
    expect(getBotSignatureConfigMock).not.toHaveBeenCalled();
  });

  it("autorizado → devolve { ok, enabled, apelido }", async () => {
    authorizeIntegrationMock.mockResolvedValue({ supabase: {} });
    getBotSignatureConfigMock.mockResolvedValue({ enabled: true, apelido: "Dra. Ana" });

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, enabled: true, apelido: "Dra. Ana" });
  });

  it("quando desligado → devolve enabled=false", async () => {
    authorizeIntegrationMock.mockResolvedValue({ supabase: {} });
    getBotSignatureConfigMock.mockResolvedValue({ enabled: false, apelido: "" });

    const res = await GET(request());

    expect(await res.json()).toEqual({ ok: true, enabled: false, apelido: "" });
  });
});

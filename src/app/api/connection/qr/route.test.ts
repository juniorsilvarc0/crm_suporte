// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireAdminMock, clientMock, integrationMock, connectMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  clientMock: vi.fn(),
  integrationMock: vi.fn(),
  connectMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardAdmin: requireAdminMock,
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: clientMock }));
vi.mock("@/features/chat/lib/connection/integration", () => ({
  getUazapiIntegration: integrationMock,
}));
vi.mock("@/features/chat/lib/connection/uazapi", () => ({ connectUazapi: connectMock }));

import * as route from "@/app/api/connection/qr/route";
import { POST } from "@/app/api/connection/qr/route";

const ADMIN_CLIENT = { marker: "admin-client" };
const INTEGRATION = {
  id: "integracao-1",
  apiUrl: "https://demo.invalid",
  token: "token-de-mentira",
  phone_number: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  clientMock.mockReturnValue(ADMIN_CLIENT);
  integrationMock.mockResolvedValue(INTEGRATION);
  connectMock.mockResolvedValue({
    connected: false,
    qrcode: "data:image/png;base64,QR",
    pairingCode: "ABCD-1234",
  });
});

describe("POST /api/connection/qr", () => {
  it("só existe por POST: o pedido age no provedor, e GET fica fora da trava de origem do proxy", () => {
    // O Next responde 405 ao método que o arquivo não exporta, e HEAD segue o GET.
    expect(Object.keys(route).sort()).toEqual(["POST", "dynamic", "runtime"]);
  });

  it("recusa quem não é administrador sem chamar o provedor nem ler a integração", async () => {
    requireAdminMock.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 403 }) });

    const response = await POST();

    expect(response.status).toBe(403);
    expect(integrationMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("pede o QR ao provedor com a URL e o token da integração, e devolve o que veio", async () => {
    const response = await POST();

    expect(integrationMock).toHaveBeenCalledWith(ADMIN_CLIENT);
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledWith("https://demo.invalid", "token-de-mentira");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      configured: true,
      qrcode: "data:image/png;base64,QR",
      pairingCode: "ABCD-1234",
      connected: false,
    });
  });

  it("o provedor responde que a instância já está conectada: a resposta diz isso, sem QR", async () => {
    connectMock.mockResolvedValue({ connected: true, qrcode: null, pairingCode: null });

    const response = await POST();

    expect(await response.json()).toEqual({
      ok: true,
      configured: true,
      qrcode: null,
      pairingCode: null,
      connected: true,
    });
  });

  it("sem integração: diz que não está configurado, e não chama o provedor", async () => {
    integrationMock.mockResolvedValue(null);

    const response = await POST();

    expect(connectMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      configured: false,
      qrcode: null,
      pairingCode: null,
      connected: false,
      message: "Instância uazapi não configurada.",
    });
  });

  it("o provedor falha: 200 com `ok: false`, o motivo e nenhum QR", async () => {
    connectMock.mockRejectedValue(new Error("uazapi fora do ar"));

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      configured: true,
      qrcode: null,
      pairingCode: null,
      connected: false,
      message: "uazapi fora do ar",
    });
  });

  it("falha que não é um Error: mensagem padrão", async () => {
    connectMock.mockRejectedValue("texto solto");

    const response = await POST();

    expect((await response.json()).message).toBe("Falha ao consultar a uazapi.");
  });

  it("o token da integração nunca volta na resposta", async () => {
    for (const outcome of [
      () => connectMock.mockResolvedValue({ connected: false, qrcode: "QR", pairingCode: null }),
      () => connectMock.mockRejectedValue(new Error("falhou")),
    ]) {
      outcome();

      const response = await POST();

      expect(JSON.stringify(await response.json())).not.toContain("token-de-mentira");
    }
  });
});

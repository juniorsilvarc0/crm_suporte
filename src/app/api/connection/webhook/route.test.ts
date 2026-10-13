// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireAdminMock, clientMock, integrationMock, secretMock, registerMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  clientMock: vi.fn(),
  integrationMock: vi.fn(),
  secretMock: vi.fn(),
  registerMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireDashboardAdmin: requireAdminMock }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: clientMock }));
vi.mock("@/features/chat/lib/connection/integration", () => ({
  getUazapiIntegration: integrationMock,
  getChatIntegrationSecret: secretMock,
}));
// A lista de eventos é a de verdade (é o que está sendo testado); só o envio é de mentira.
vi.mock("@/features/chat/lib/connection/uazapi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/chat/lib/connection/uazapi")>()),
  registerUazapiWebhook: registerMock,
}));

import * as route from "@/app/api/connection/webhook/route";
import { POST } from "@/app/api/connection/webhook/route";

const ADMIN_CLIENT = { marker: "admin-client" };
const INTEGRATION = { id: "integracao-1", apiUrl: "https://demo.invalid", token: "token-de-mentira", phone_number: null };
const SECRET = "segredo-do-webhook-de-mentira";
const post = () => POST(new Request("https://crm.test/api/connection/webhook", { method: "POST" }));
let consoles: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_PUBLIC_URL", "https://suporte.exemplo.com/");
  requireAdminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  clientMock.mockReturnValue(ADMIN_CLIENT);
  integrationMock.mockResolvedValue(INTEGRATION);
  secretMock.mockResolvedValue(SECRET);
  registerMock.mockResolvedValue(undefined);
  consoles = (["info", "warn", "error"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const spy of consoles) spy.mockRestore();
});

describe("POST /api/connection/webhook", () => {
  it("só existe por POST (age no provedor)", () => {
    expect(Object.keys(route).sort()).toEqual(["POST", "dynamic", "runtime"]);
  });

  it("recusa quem não é administrador sem ler a integração nem chamar a uazapi", async () => {
    requireAdminMock.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 403 }) });
    expect((await post()).status).toBe(403);
    expect(integrationMock).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("recadastra o MESMO endereço e segredo, com a lista de eventos atual (inclui connection)", async () => {
    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, events: ["messages", "messages_update", "connection"] });
    expect(secretMock).toHaveBeenCalledWith(ADMIN_CLIENT, "integracao-1", "webhook_secret");
    // Sem o 4º argumento: vale a lista padrão do módulo (a mesma do persist).
    expect(registerMock).toHaveBeenCalledWith(
      "https://demo.invalid",
      "token-de-mentira",
      `https://suporte.exemplo.com/api/chat/webhook/uazapi?s=${SECRET}`
    );
  });

  it("sem integração ou sem segredo: 409, sem chamar a uazapi", async () => {
    integrationMock.mockResolvedValue(null);
    expect((await post()).status).toBe(409);
    integrationMock.mockResolvedValue(INTEGRATION);
    secretMock.mockResolvedValue(null);
    expect((await post()).status).toBe(409);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("banco ou cofre fora: 503 (não é 'não configurado')", async () => {
    secretMock.mockRejectedValue(new Error("vault fora"));
    expect((await post()).status).toBe(503);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("uazapi recusou: 502, e o segredo não vai para o log nem para a resposta", async () => {
    registerMock.mockRejectedValue(new Error(`uazapi webhook 400: url inválida https://x/?s=${SECRET}`));
    const response = await post();
    expect(response.status).toBe(502);
    const logged = JSON.stringify(consoles.flatMap((spy) => spy.mock.calls));
    expect(logged).toContain("uazapi webhook 400");
    expect(logged).not.toContain(SECRET);
    expect(JSON.stringify(await response.json())).not.toContain(SECRET);
  });
});

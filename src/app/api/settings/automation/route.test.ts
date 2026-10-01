// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// Mocka as fronteiras: auth de admin, o client admin (upsert) e a leitura da
// configuração. A guarda da URL é a de verdade.
const { requireAdminMock, upsertMock, configMock, hasAdminEnvMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  upsertMock: vi.fn(),
  configMock: vi.fn(),
  hasAdminEnvMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardAdmin: requireAdminMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: hasAdminEnvMock,
  createSupabaseAdminClient: () => ({
    from: (table: string) => ({
      upsert: (row: unknown, options: unknown) => upsertMock(table, row, options),
    }),
  }),
}));
vi.mock("@/features/settings/lib/get-relay-url", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/settings/lib/get-relay-url")>()),
  getRelayConfig: configMock,
}));

import { GET, PATCH } from "@/app/api/settings/automation/route";

const URL_OK = "https://agente.exemplo.com/webhook/7f3c";

function patch(body: unknown) {
  return new Request("http://x/api/settings/automation", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  requireAdminMock.mockResolvedValue({ viewer: { id: "u1", role: "admin" } });
  hasAdminEnvMock.mockReturnValue(true);
  upsertMock.mockResolvedValue({ error: null });
  configMock.mockResolvedValue({ configuredUrl: URL_OK, state: "active", reason: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("GET /api/settings/automation", () => {
  it("não-admin: devolve o erro de auth, sem ler a configuração", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ ok: false, message: "forbidden" }, { status: 403 }),
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(configMock).not.toHaveBeenCalled();
  });

  it("devolve a URL salva e o estado do repasse", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, configuredUrl: URL_OK, state: "active", reason: null });
  });

  it("URL salva que o envio recusa: devolve o estado e o motivo", async () => {
    configMock.mockResolvedValue({ configuredUrl: "http://10.0.0.5/x", state: "refused", reason: "motivo" });

    const response = await GET();

    expect(await response.json()).toEqual({ ok: true, configuredUrl: "http://10.0.0.5/x", state: "refused", reason: "motivo" });
  });
});

describe("PATCH /api/settings/automation", () => {
  it("não-admin: devolve o erro de auth, sem gravar", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ ok: false, message: "forbidden" }, { status: 403 }),
    });

    const response = await PATCH(patch({ relayUrl: URL_OK }));

    expect(response.status).toBe(403);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("não-admin com corpo inválido recebe o 403, e não o motivo da recusa da URL", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ ok: false, message: "forbidden" }, { status: 403 }),
    });

    const response = await PATCH(patch({ relayUrl: "https://10.0.0.5/hook" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, message: "forbidden" });
  });

  it("sem Supabase configurado: 500, sem gravar", async () => {
    hasAdminEnvMock.mockReturnValue(false);

    const response = await PATCH(patch({ relayUrl: URL_OK }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, message: "Supabase não configurado." });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("grava a URL na chave `automation` e devolve a configuração", async () => {
    const response = await PATCH(patch({ relayUrl: `  ${URL_OK}  ` }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, configuredUrl: URL_OK, state: "active", reason: null });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      "app_settings",
      { key: "automation", value: { relay_url: URL_OK }, updated_at: "2026-10-01T12:00:00.000Z" },
      { onConflict: "key" }
    );
  });

  it("campo vazio é aceito: é como se desliga o repasse", async () => {
    configMock.mockResolvedValue({ configuredUrl: null, state: "none", reason: null });

    const response = await PATCH(patch({ relayUrl: "" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, configuredUrl: null, state: "none", reason: null });
    expect(upsertMock.mock.calls[0][1]).toMatchObject({ value: { relay_url: "" } });
  });

  it.each([
    ["rede interna", "https://192.168.0.10/hook", "A URL aponta para um host de rede interna (bloqueado)."],
    ["metadata da nuvem", "https://169.254.169.254/latest", "A URL aponta para um host de rede interna (bloqueado)."],
    ["esquema que não é http", "ftp://agente.exemplo.com/x", "A URL deve usar http ou https."],
    ["texto que não é URL", "agente", "URL inválida."],
    ["usuário e senha", "https://u:s@agente.exemplo.com/x", "A URL não pode levar usuário e senha."],
  ])("recusa %s com 400 e o motivo, sem gravar", async (_label, relayUrl, message) => {
    const response = await PATCH(patch({ relayUrl }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, message });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("em produção, http é recusado", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await PATCH(patch({ relayUrl: "http://agente.exemplo.com/x" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, message: "Em produção a URL deve usar HTTPS." });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it.each([
    ["sem o campo", {}],
    ["campo que não é texto", { relayUrl: 42 }],
    ["campo nulo", { relayUrl: null }],
  ])("corpo inválido (%s): 400 com o motivo em português, sem gravar", async (_label, body) => {
    const response = await PATCH(patch(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      message: "Informe a URL do agente (ou vazio para desligar o repasse).",
    });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("o teto é de 2048 caracteres: 2048 passa, 2049 não", async () => {
    const base = "https://agente.exemplo.com/";
    const atLimit = base + "a".repeat(2048 - base.length);

    const accepted = await PATCH(patch({ relayUrl: atLimit }));
    expect(accepted.status).toBe(200);
    expect(upsertMock.mock.calls[0][1]).toMatchObject({ value: { relay_url: atLimit } });

    upsertMock.mockClear();
    const refused = await PATCH(patch({ relayUrl: `${atLimit}a` }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ ok: false, message: "A URL deve ter no máximo 2048 caracteres." });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("JSON inválido: 400", async () => {
    const response = await PATCH(patch("{"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, message: "JSON inválido." });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("banco que recusa a gravação: 500", async () => {
    upsertMock.mockResolvedValue({ error: { message: "permission denied" } });

    const response = await PATCH(patch({ relayUrl: URL_OK }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, message: "permission denied" });
    expect(configMock).not.toHaveBeenCalled();
  });
});

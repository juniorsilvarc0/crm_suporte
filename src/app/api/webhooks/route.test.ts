// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireAdminMock, hasEnvMock, clientMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  hasEnvMock: vi.fn(),
  clientMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireDashboardAdmin: requireAdminMock }));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: hasEnvMock,
  createSupabaseAdminClient: clientMock,
}));

import { GET, POST } from "@/app/api/webhooks/route";
import { createHarness, has, type Call } from "@/app/api/v1/test-harness";

const SUB_ID = "5b0e8f1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
const KEY = /^[0-9a-f]{64}$/;
const ROW = {
  id: SUB_ID,
  name: "ERP",
  url: "https://erp.exemplo.com/hook",
  events: ["ticket.created", "evento.antigo"],
  is_active: true,
  secret_id: "vault-ref-1",
  created_at: "2026-10-09T12:00:00Z",
  updated_at: "2026-10-09T12:00:00Z",
};

const h = createHarness(clientMock);
let consoles: ReturnType<typeof vi.spyOn>[];

const post = (body: unknown, raw?: string) =>
  POST(
    new Request("http://x/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw ?? JSON.stringify(body),
    })
  );
const valid = { name: "ERP", url: "https://erp.exemplo.com/hook", events: ["ticket.created"] };
const audited = () =>
  (h.chains.integration_logs ?? []).map((calls: Call[]) => calls.find(([method]) => method === "insert")?.[1]);

beforeEach(() => {
  vi.clearAllMocks();
  h.reset([]);
  h.tables.webhook_subscriptions = () => ({ data: ROW, error: null });
  h.rpcs.set_webhook_subscription_secret = () => ({ data: true, error: null });
  requireAdminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  hasEnvMock.mockReturnValue(true);
  consoles = (["info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined)
  );
});

afterEach(() => {
  for (const spy of consoles) spy.mockRestore();
});

describe("GET /api/webhooks", () => {
  it("lista os destinos sem segredo, só se existe; evento fora do catálogo não aparece", async () => {
    h.tables.webhook_subscriptions = () => ({ data: [ROW], error: null });
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.subscriptions).toEqual([
      {
        id: SUB_ID,
        name: "ERP",
        url: "https://erp.exemplo.com/hook",
        events: ["ticket.created"],
        isActive: true,
        hasSecret: true,
        createdAt: "2026-10-09T12:00:00Z",
        updatedAt: "2026-10-09T12:00:00Z",
      },
    ]);
    // A referência do Vault serve só para dizer se há segredo: não sai na resposta.
    expect(JSON.stringify(body)).not.toContain("vault-ref-1");
  });

  it("recusa não-admin", async () => {
    requireAdminMock.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 403 }) });
    expect((await GET()).status).toBe(403);
    expect(h.chains.webhook_subscriptions).toBeUndefined();
  });
});

describe("POST /api/webhooks", () => {
  it("cadastra, gera o segredo, grava no cofre e o devolve UMA vez, sem cache", async () => {
    const response = await post(valid);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.secret).toMatch(KEY);
    expect(body.subscription).toMatchObject({ id: SUB_ID, hasSecret: true });

    const insert = h.lastChain("webhook_subscriptions");
    expect(has(insert, "insert", { ...valid, created_by_user_id: "admin-1" })).toBe(true);
    expect(h.rpcCalls).toEqual([
      ["set_webhook_subscription_secret", { p_subscription_id: SUB_ID, p_value: body.secret }],
    ]);
    // A trilha diz quem cadastrou; nem segredo nem URL vão para o registro.
    expect(audited()).toEqual([
      expect.objectContaining({
        provider: "webhooks",
        action: "subscription.created",
        status: "ok",
        payload: { by: "admin-1", subscription_id: SUB_ID },
      }),
    ]);
    expect(JSON.stringify(audited())).not.toContain(body.secret);
    expect(JSON.stringify(audited())).not.toContain("erp.exemplo.com");
  });

  it("URL de rede interna: 422, nada gravado", async () => {
    const response = await post({ ...valid, url: "http://10.0.0.5/hook" });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.errors.url).toEqual(["A URL aponta para um host de rede interna (bloqueado)."]);
    expect(h.chains.webhook_subscriptions).toBeUndefined();
    expect(h.rpcCalls).toEqual([]);
  });

  it("corpo inválido: 400 com os campos; segredo vindo de fora é recusado", async () => {
    expect((await post(null, "{não é json")).status).toBe(400);
    const response = await post({ ...valid, events: [] });
    expect(response.status).toBe(400);
    expect((await response.json()).errors.events).toBeTruthy();
    expect((await post({ ...valid, secret: "x".repeat(64) })).status).toBe(400);
    expect(h.chains.webhook_subscriptions).toBeUndefined();
  });

  it("cofre falhou: desfaz o cadastro e não devolve segredo", async () => {
    h.rpcs.set_webhook_subscription_secret = () => ({ data: null, error: { code: "XX000", message: "vault" } });
    const response = await post(valid);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.secret).toBeUndefined();
    const chains = h.chains.webhook_subscriptions ?? [];
    expect(chains).toHaveLength(2);
    expect(has(chains[1], "delete")).toBe(true);
    expect(audited()).toEqual([]);
  });

  it("recusa não-admin antes de ler o corpo", async () => {
    requireAdminMock.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 403 }) });
    expect((await post(null, "{não é json")).status).toBe(403);
    expect(h.rpcCalls).toEqual([]);
  });
});

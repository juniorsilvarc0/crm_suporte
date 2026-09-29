// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock } = vi.hoisted(() => ({ adminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: adminClientMock }));

import { GET as health } from "@/app/api/v1/health/route";
import { GET as me } from "@/app/api/v1/me/route";
import { GET as openapi } from "@/app/api/v1/openapi.json/route";
import { healthSchema, meSchema } from "@/lib/api/v1/openapi";

// A resposta REAL de cada rota bate com o schema que o OpenAPI publica.

const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  adminClientMock.mockReset();
});

describe("rotas da v1 contra o contrato publicado", () => {
  it("GET /health bate com o schema Health e não toca o banco", async () => {
    const response = await health(new Request("http://crm.test/api/v1/health"), ctx);

    expect(response.status).toBe(200);
    expect(healthSchema.safeParse(await response.json()).success).toBe(true);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("GET /me bate com o schema Me e nunca devolve o hash", async () => {
    const row = {
      id: "tok-1",
      name: "IA de triagem",
      token_prefix: "crmsuporte_a",
      scopes: ["tickets:*"],
      actor_type: "ai",
      rate_limit_per_min: 300,
      expires_at: null,
      last_used_at: new Date().toISOString(),
    };
    adminClientMock.mockReturnValue({
      from: (table: string) =>
        table === "api_tokens"
          ? { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) }
          : { insert: async () => ({ error: null }) },
    });

    const response = await me(
      new Request("http://crm.test/api/v1/me", {
        headers: { authorization: "Bearer crmsuporte_x", "x-forwarded-for": "192.0.2.10" },
      }),
      ctx
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(meSchema.safeParse(body).success).toBe(true);
    expect(JSON.stringify(body)).not.toContain("token_hash");
    expect(body.data.token).toMatchObject({ actor_type: "ai", rate_limit_per_min: 300 });
  });

  it("GET /openapi.json é OpenAPI 3.1 com o envelope de erro", async () => {
    const response = await openapi(new Request("http://crm.test/api/v1/openapi.json"), ctx);
    const doc = await response.json();

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.components.schemas.Error.properties.request_id).toBeDefined();
    expect(doc.components.securitySchemes.bearer.scheme).toBe("bearer");
  });
});

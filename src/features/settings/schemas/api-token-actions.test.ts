import { describe, expect, it } from "vitest";

import {
  createApiTokenSchema,
  isKnownScope,
  updateApiTokenSchema,
} from "@/features/settings/schemas/api-token-actions";

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

describe("isKnownScope", () => {
  it("aceita escopo do catálogo e recurso:* de recurso existente", () => {
    expect(isKnownScope("tickets:read")).toBe(true);
    expect(isKnownScope("tickets:*")).toBe(true);
  });

  it("recusa escopo fora do catálogo, mesmo no formato certo", () => {
    expect(isKnownScope("tickets:delete")).toBe(false);
    expect(isKnownScope("faturas:*")).toBe(false);
    expect(isKnownScope("*:*")).toBe(false);
  });
});

describe("createApiTokenSchema", () => {
  it("só com nome: token inerte, integração, 120/min e sem validade", () => {
    expect(createApiTokenSchema.parse({ name: "n8n" })).toEqual({
      name: "n8n",
      scopes: [],
      actor_type: "api",
      rate_limit_per_min: 120,
      expires_at: null,
    });
  });

  it("remove escopo repetido", () => {
    expect(createApiTokenSchema.parse({ name: "x", scopes: ["tickets:read", "tickets:read"] }).scopes).toEqual([
      "tickets:read",
    ]);
  });

  it.each([
    ["escopo desconhecido", { scopes: ["tickets:apagar"] }],
    ["tipo fora de ai|api", { actor_type: "robo" }],
    ["limite acima de 6000", { rate_limit_per_min: 6001 }],
    ["limite fracionado", { rate_limit_per_min: 1.5 }],
    ["validade no passado", { expires_at: "2020-01-01T00:00:00Z" }],
    ["validade sem fuso", { expires_at: "2030-01-01T00:00:00" }],
  ])("recusa %s", (_label, extra) => {
    expect(createApiTokenSchema.safeParse({ name: "x", ...extra }).success).toBe(false);
  });

  it("aceita validade futura com fuso", () => {
    expect(createApiTokenSchema.parse({ name: "x", expires_at: FUTURE }).expires_at).toBe(FUTURE);
  });

  it("normaliza a validade para UTC (o Postgres recusa fuso acima de ±15:59)", () => {
    const parsed = createApiTokenSchema.parse({ name: "x", expires_at: "2030-01-01T10:00:00+16:00" });
    expect(parsed.expires_at).toBe("2029-12-31T18:00:00.000Z");
  });
});

describe("updateApiTokenSchema", () => {
  it("corpo vazio não altera nada: é recusado", () => {
    expect(updateApiTokenSchema.safeParse({}).success).toBe(false);
  });

  it("aceita só o que mudou, e null para tirar a validade", () => {
    expect(updateApiTokenSchema.parse({ expires_at: null })).toEqual({ expires_at: null });
    expect(updateApiTokenSchema.parse({ scopes: ["context:read"] })).toEqual({ scopes: ["context:read"] });
  });
});

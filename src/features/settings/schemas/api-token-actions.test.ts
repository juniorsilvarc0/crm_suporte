import { describe, expect, it } from "vitest";

import {
  apiTokenEditFormSchema,
  createApiTokenSchema,
  isKnownScope,
  isPastExpiry,
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

describe("apiTokenEditFormSchema", () => {
  const form = { name: "n8n", scopes: ["tickets:read"], actor_type: "api", rate_limit_per_min: "120", expires_on: "" };

  it("converte o que se digita no corpo do PATCH, e a rota aceita o resultado", () => {
    const parsed = apiTokenEditFormSchema.parse({ ...form, rate_limit_per_min: " 300 ", expires_on: "2099-06-15" });

    expect(parsed).toEqual({
      name: "n8n",
      scopes: ["tickets:read"],
      actor_type: "api",
      rate_limit_per_min: 300,
      // Fim do dia no fuso do app (-03:00), em UTC.
      expires_on: "2099-06-16T02:59:59.000Z",
    });
    const { expires_on: expires_at, ...rest } = parsed;
    expect(updateApiTokenSchema.safeParse({ ...rest, expires_at }).success).toBe(true);
  });

  it("validade vazia é sem validade", () => {
    expect(apiTokenEditFormSchema.parse(form).expires_on).toBeNull();
  });

  it("usa as mesmas regras de campo da rota", () => {
    const issues = (input: object) =>
      apiTokenEditFormSchema.safeParse({ ...form, ...input }).error?.issues.map((issue) => issue.message);

    expect(issues({ name: " " })).toEqual(["Informe um nome."]);
    expect(issues({ scopes: ["tickets:apagar"] })).toEqual(["Escopo desconhecido."]);
    expect(issues({ rate_limit_per_min: "0" })).toEqual(["Mínimo de 1 por minuto."]);
    expect(issues({ rate_limit_per_min: "6001" })).toEqual(["Máximo de 6000 por minuto."]);
    expect(issues({ rate_limit_per_min: "1,5" })).toEqual(["Informe um número de 1 a 6000."]);
    expect(issues({ expires_on: "2099-02-30" })).toEqual(["Data inválida."]);
  });

  it("aceita uma data já passada: a regra do futuro só vale quando a validade é mexida", () => {
    expect(apiTokenEditFormSchema.safeParse({ ...form, expires_on: "2020-01-01" }).success).toBe(true);
  });
});

describe("isPastExpiry", () => {
  it("sem validade nunca passou; o instante exato já conta como passado", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    expect(isPastExpiry(null, now)).toBe(false);
    expect(isPastExpiry("2026-10-02T12:00:00.000Z", now)).toBe(true);
    expect(isPastExpiry("2026-10-02T12:00:00.001Z", now)).toBe(false);
  });
});

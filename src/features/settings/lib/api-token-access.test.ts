import { describe, expect, it } from "vitest";

import {
  accessPresetFields,
  API_TOKEN_LIST_COLUMNS,
  describeTokenAccess,
  isTokenExpired,
  toApiTokenListItem,
  tokenStatus,
} from "@/features/settings/lib/api-token-access";
import { createApiTokenSchema } from "@/features/settings/schemas/api-token-actions";
import { AI_TRIAGE_PRESET } from "@/lib/api/v1/scopes";

describe("acesso do token", () => {
  it("a lista de colunas nunca traz o hash", () => {
    expect(API_TOKEN_LIST_COLUMNS).not.toMatch(/token_hash/);
  });

  it("o preset da IA grava os escopos do agente, tipo ai e 300/min — e passa no schema", () => {
    const fields = accessPresetFields("ai_triage");

    expect(fields).toEqual({ scopes: [...AI_TRIAGE_PRESET], actor_type: "ai", rate_limit_per_min: 300 });
    expect(createApiTokenSchema.safeParse({ name: "IA", ...fields }).success).toBe(true);
  });

  it("sem acesso grava token inerte de integração", () => {
    expect(accessPresetFields("none")).toEqual({ scopes: [], actor_type: "api", rate_limit_per_min: 120 });
  });

  it("descreve o acesso na lista", () => {
    expect(describeTokenAccess({ scopes: [], actor_type: "api" })).toBe("Sem escopo");
    expect(describeTokenAccess({ scopes: [...AI_TRIAGE_PRESET], actor_type: "ai" })).toBe("IA de triagem");
    // Os escopos da IA num token de integração não são "IA de triagem".
    expect(describeTokenAccess({ scopes: [...AI_TRIAGE_PRESET], actor_type: "api" })).toBe("12 escopos");
    expect(describeTokenAccess({ scopes: ["tickets:read"], actor_type: "api" })).toBe("1 escopo");
  });

  it("vencido é validade no passado; sem validade nunca vence", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");
    expect(isTokenExpired({ expires_at: "2026-09-29T11:59:59Z" }, now)).toBe(true);
    expect(isTokenExpired({ expires_at: "2026-09-29T12:00:01Z" }, now)).toBe(false);
    expect(isTokenExpired({ expires_at: null }, now)).toBe(false);
  });

  it("status único: revogado vence vencido, que vence ativo", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");
    expect(tokenStatus({ revoked_at: "2026-09-01T00:00:00Z", expires_at: "2020-01-01T00:00:00Z" }, now)).toBe("revoked");
    expect(tokenStatus({ revoked_at: null, expires_at: "2020-01-01T00:00:00Z" }, now)).toBe("expired");
    expect(tokenStatus({ revoked_at: null, expires_at: null }, now)).toBe("active");
  });

  it("o hash nunca passa, mesmo se a linha do banco o trouxer", () => {
    const row = {
      id: "t",
      name: "x",
      token_prefix: "crmsuporte_a",
      scopes: [],
      actor_type: "api",
      rate_limit_per_min: 120,
      expires_at: null,
      created_at: "2026-09-29T00:00:00Z",
      last_used_at: null,
      revoked_at: null,
      token_hash: "a".repeat(64),
      created_by: "u",
    };
    const item = toApiTokenListItem(row) as Record<string, unknown>;
    expect(item).not.toHaveProperty("token_hash");
    expect(item).not.toHaveProperty("created_by");
  });

  it("tipo desconhecido vindo do banco vira api", () => {
    const row = {
      id: "t",
      name: "x",
      token_prefix: "crmsuporte_a",
      scopes: [],
      actor_type: "outro",
      rate_limit_per_min: 120,
      expires_at: null,
      created_at: "2026-09-29T00:00:00Z",
      last_used_at: null,
      revoked_at: null,
    };
    expect(toApiTokenListItem(row).actor_type).toBe("api");
  });
});

import { describe, expect, it } from "vitest";

import { AI_TRIAGE_PRESET, API_SCOPES, hasScope, missingScopes } from "@/lib/api/v1/scopes";

describe("escopos da API v1", () => {
  it("todo escopo do catálogo passa no formato que o banco aceita", () => {
    // O mesmo regex de api_tokens_scopes_shape_check (20260925120200).
    for (const scope of API_SCOPES) {
      expect(scope).toMatch(/^[a-z][a-z_]*:([a-z][a-z_]*|\*)$/);
    }
  });

  it("recurso:* cobre as ações do recurso, e só dele", () => {
    expect(hasScope(["tickets:*"], "tickets:write")).toBe(true);
    expect(hasScope(["tickets:*"], "tickets:read")).toBe(true);
    expect(hasScope(["tickets:*"], "comments:write")).toBe(false);
    expect(hasScope(["tickets:read"], "tickets:write")).toBe(false);
  });

  it("token sem escopo não cobre nada", () => {
    expect(missingScopes([], ["context:read"])).toEqual(["context:read"]);
    expect(missingScopes([], [])).toEqual([]);
  });

  it("devolve só o que falta", () => {
    expect(missingScopes(["context:read", "tickets:*"], ["context:read", "tickets:write", "messages:send"])).toEqual([
      "messages:send",
    ]);
  });

  it("o preset da IA (D4) é do catálogo e deixa fora customers:write e notices:claim", () => {
    for (const scope of AI_TRIAGE_PRESET) expect(API_SCOPES).toContain(scope);
    expect(AI_TRIAGE_PRESET).not.toContain("customers:write");
    expect(AI_TRIAGE_PRESET).not.toContain("notices:claim");
  });

  it("a IA escreve comentário interno, mas não lê o que é só do time", () => {
    expect(API_SCOPES).toContain("comments:read");
    expect(hasScope(AI_TRIAGE_PRESET, "comments:write")).toBe(true);
    expect(hasScope(AI_TRIAGE_PRESET, "comments:read")).toBe(false);
    // As mensagens da conversa ela lê: é com o cliente que ela fala.
    expect(hasScope(AI_TRIAGE_PRESET, "conversations:read")).toBe(true);
  });
});

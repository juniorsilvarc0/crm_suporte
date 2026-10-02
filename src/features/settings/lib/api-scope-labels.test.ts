import { describe, expect, it } from "vitest";

import { scopeActionLabel, scopeGroups, scopeResourceLabel } from "@/features/settings/lib/api-scope-labels";
import { API_SCOPES } from "@/lib/api/v1/scopes";

describe("rótulos dos escopos", () => {
  it("todo escopo do catálogo tem recurso e ação em português", () => {
    for (const scope of API_SCOPES) {
      const resource = scope.slice(0, scope.indexOf(":"));
      expect(scopeResourceLabel(resource)).not.toBe(resource);
      expect(scopeActionLabel(scope)).not.toBe(scope.slice(scope.indexOf(":") + 1));
    }
  });

  it("agrupa por recurso, na ordem do catálogo, com todo escopo uma vez", () => {
    const groups = scopeGroups();

    expect(groups.flatMap((group) => group.scopes)).toEqual([...API_SCOPES]);
    expect(groups[0]).toEqual({ resource: "context", label: "Contexto da triagem", scopes: ["context:read"] });
  });

  it("o `recurso:*` do token entra no grupo do recurso; o que a tela não conhece, como veio", () => {
    const groups = scopeGroups(["tickets:read", "tickets:*", "novo:ler"]);

    expect(groups.find((group) => group.resource === "tickets")?.scopes).toEqual([
      "tickets:read",
      "tickets:write",
      "tickets:*",
    ]);
    expect(scopeActionLabel("tickets:*")).toBe("Todas as ações, inclusive as que vierem");
    expect(groups.at(-1)).toEqual({ resource: "novo", label: "novo", scopes: ["novo:ler"] });
    expect(scopeActionLabel("novo:ler")).toBe("ler");
  });
});

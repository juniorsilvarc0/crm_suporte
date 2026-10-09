import { describe, expect, it } from "vitest";

import {
  INTEGRATION_LOG_PERIOD_LABELS,
  INTEGRATION_PROVIDER_LABELS,
  integrationActionLabel,
  integrationLogAuthor,
  integrationProviderLabel,
} from "@/features/integrations/lib/log-labels";
import {
  INTEGRATION_LOG_ACTIONS,
  INTEGRATION_LOG_PERIODS,
  INTEGRATION_LOG_PROVIDERS,
} from "@/features/integrations/types";

describe("rótulos dos registros", () => {
  it("toda integração, ação do repasse e dos webhooks e período que o filtro aceita tem rótulo próprio", () => {
    for (const provider of INTEGRATION_LOG_PROVIDERS) {
      expect(INTEGRATION_PROVIDER_LABELS[provider]).toBeTruthy();
    }
    for (const action of [...INTEGRATION_LOG_ACTIONS.relay, ...INTEGRATION_LOG_ACTIONS.webhooks]) {
      expect(integrationActionLabel(action)).not.toBe(action);
    }
    for (const period of INTEGRATION_LOG_PERIODS) {
      expect(INTEGRATION_LOG_PERIOD_LABELS[period]).toBeTruthy();
    }
  });

  it("na API, a ação é o método HTTP, como veio", () => {
    for (const method of INTEGRATION_LOG_ACTIONS.api_v1) expect(integrationActionLabel(method)).toBe(method);
  });

  it("o que a tela não conhece aparece como veio; ação vazia é um traço", () => {
    expect(integrationProviderLabel("meta")).toBe("meta");
    expect(integrationActionLabel("acao.nova")).toBe("acao.nova");
    expect(integrationActionLabel(null)).toBe("—");
  });

  it("quem fez: o token (nome e prefixo), o usuário, ou ninguém", () => {
    expect(integrationLogAuthor({ token: { id: "t", name: "IA", prefix: "crmsuporte_ab" }, actor: null })).toBe(
      "IA (crmsuporte_ab…)"
    );
    expect(integrationLogAuthor({ token: null, actor: { id: "u", name: "Ana" } })).toBe("Ana");
    expect(integrationLogAuthor({ token: null, actor: { id: "u", name: null } })).toBe("Usuário não identificado");
    expect(integrationLogAuthor({ token: null, actor: null })).toBeNull();
  });
});

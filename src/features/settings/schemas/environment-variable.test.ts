import { describe, expect, it } from "vitest";

import {
  deleteEnvironmentVariableSchema,
  environmentVariableSchema,
} from "@/features/settings/schemas/environment-variable";

describe("environmentVariableSchema", () => {
  it("normaliza a chave para maiúsculas", () => {
    expect(
      environmentVariableSchema.parse({ name: " openai_api_key ", value: "segredo" })
    ).toEqual({ name: "OPENAI_API_KEY", value: "segredo", replace: false });
  });

  it("aceita uma chave livre válida", () => {
    expect(
      environmentVariableSchema.safeParse({ name: "MINHA_INTEGRACAO_URL", value: "https://x.test" })
        .success
    ).toBe(true);
  });

  it("recusa chave inválida e valor vazio", () => {
    const result = environmentVariableSchema.safeParse({ name: "1-chave", value: "" });
    expect(result.success).toBe(false);
  });

  it("protege o modelo reservado com allowlist", () => {
    expect(
      environmentVariableSchema.safeParse({
        name: "OPENAI_TRANSCRIPTION_MODEL",
        value: "modelo-inexistente",
      }).success
    ).toBe(false);
  });
});

describe("deleteEnvironmentVariableSchema", () => {
  it("normaliza a chave removida", () => {
    expect(deleteEnvironmentVariableSchema.parse({ name: " minha_chave " })).toEqual({
      name: "MINHA_CHAVE",
    });
  });
});

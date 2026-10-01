import { describe, expect, it } from "vitest";

import {
  deleteEnvironmentVariableSchema,
  environmentVariableSchema,
} from "@/features/settings/schemas/environment-variable";
import { RUNTIME_ENVIRONMENT_NAMES } from "@/features/settings/types";

const nameErrors = (input: unknown) => {
  const result = environmentVariableSchema.safeParse(input);
  return result.success ? [] : (result.error.flatten().fieldErrors.name ?? []);
};

describe("environmentVariableSchema", () => {
  it("normaliza a chave para maiúsculas", () => {
    expect(
      environmentVariableSchema.parse({ name: " openai_api_key ", value: "segredo" })
    ).toEqual({ name: "OPENAI_API_KEY", value: "segredo", replace: false });
  });

  it("o catálogo é o que o app lê do cofre, e a chave de assinatura faz parte dele", () => {
    expect([...RUNTIME_ENVIRONMENT_NAMES]).toEqual([
      "OPENAI_API_KEY",
      "OPENAI_TRANSCRIPTION_MODEL",
      "RELAY_SIGNING_SECRET",
    ]);
  });

  it.each([
    ["nome bem formado que o app não lê", "MINHA_INTEGRACAO_URL"],
    ["nome parecido com um do catálogo", "OPENAI_API_KEY_2"],
    ["prefixo de um nome do catálogo", "OPENAI_API"],
    ["o antigo endereço do agente por variável", "N8N_WEBHOOK_URL"],
    ["nome mal formado", "1-chave"],
    ["nome vazio", ""],
  ])("recusa chave fora do catálogo (%s), e diz quais o cofre guarda", (_label, name) => {
    expect(nameErrors({ name, value: "valor" })).toEqual([
      "O cofre só guarda as chaves que o CRM usa: OPENAI_API_KEY, OPENAI_TRANSCRIPTION_MODEL.",
    ]);
  });

  it.each(["RELAY_SIGNING_SECRET", " relay_signing_secret "])(
    "a chave de assinatura (%j) não se grava à mão, com qualquer valor",
    (name) => {
      for (const value of ["x", "f".repeat(64)]) {
        expect(nameErrors({ name, value, replace: true })).toEqual([
          "A chave de assinatura é gerada pelo CRM, em Agente de IA.",
        ]);
      }
    }
  );

  it("recusa valor vazio e valor acima de 16 KB", () => {
    const errors = (value: string) => {
      const result = environmentVariableSchema.safeParse({ name: "OPENAI_API_KEY", value });
      return result.success ? [] : result.error.flatten().fieldErrors.value;
    };

    expect(errors("")).toEqual(["Informe o valor da variável."]);
    expect(errors("a".repeat(16_385))).toEqual(["O valor deve ter no máximo 16 KB."]);
    expect(errors("a".repeat(16_384))).toEqual([]);
    // Não há piso de tamanho: a credencial de um provedor tem o tamanho que tiver.
    expect(errors("x")).toEqual([]);
  });

  it.each([
    ["sem o nome", { value: "x" }, "name", "Informe a chave da variável."],
    ["nome que não é texto", { name: 42, value: "x" }, "name", "Informe a chave da variável."],
    ["sem o valor", { name: "OPENAI_API_KEY" }, "value", "Informe o valor da variável."],
    ["valor que não é texto", { name: "OPENAI_API_KEY", value: 42 }, "value", "Informe o valor da variável."],
  ] as const)("%s: a mensagem é em português", (_label, input, field, message) => {
    const result = environmentVariableSchema.safeParse(input);

    expect(result.error?.flatten().fieldErrors[field]).toEqual([message]);
  });

  it("protege o modelo reservado com allowlist", () => {
    expect(
      environmentVariableSchema.safeParse({
        name: "OPENAI_TRANSCRIPTION_MODEL",
        value: "modelo-inexistente",
      }).success
    ).toBe(false);
    expect(
      environmentVariableSchema.safeParse({ name: "OPENAI_TRANSCRIPTION_MODEL", value: "whisper-1" }).success
    ).toBe(true);
  });
});

describe("deleteEnvironmentVariableSchema", () => {
  it("normaliza a chave removida", () => {
    expect(deleteEnvironmentVariableSchema.parse({ name: " openai_api_key " })).toEqual({
      name: "OPENAI_API_KEY",
    });
  });

  it("aceita nome bem formado de fora do catálogo: é como se limpa uma variável antiga", () => {
    expect(deleteEnvironmentVariableSchema.parse({ name: " minha_chave " })).toEqual({
      name: "MINHA_CHAVE",
    });
  });

  it.each([["1-chave"], [""], ["COM ESPACO"], ["A".repeat(65)]])("recusa nome mal formado (%j)", (name) => {
    const result = deleteEnvironmentVariableSchema.safeParse({ name });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.name).toEqual(["Variável inválida."]);
  });

  it.each([[undefined], [null], [42]])("nome que não é texto (%j): a mensagem é em português", (name) => {
    const result = deleteEnvironmentVariableSchema.safeParse({ name });

    expect(result.error?.flatten().fieldErrors.name).toEqual(["Variável inválida."]);
  });

  it.each(["RELAY_SIGNING_SECRET", " relay_signing_secret "])(
    "a chave de assinatura (%j) não sai por aqui: é removida em Agente de IA",
    (name) => {
      const result = deleteEnvironmentVariableSchema.safeParse({ name });

      expect(result.error?.flatten().fieldErrors.name).toEqual([
        "A chave de assinatura é gerada pelo CRM, em Agente de IA.",
      ]);
    }
  );
});

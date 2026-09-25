import { describe, expect, it } from "vitest";

import { leadWebhookSchema } from "@/features/leads/schemas/webhook";

describe("leadWebhookSchema", () => {
  it("aceita um payload contendo apenas o campo obrigatório (phone)", () => {
    const result = leadWebhookSchema.safeParse({ phone: "11987654321" });

    expect(result.success).toBe(true);
  });

  it("aceita um payload completo com todos os campos opcionais válidos", () => {
    const payload = {
      phone: "11987654321",
      name: "Maria Silva",
      instagram_user: "maria.silva",
      email: "maria@example.com",
      source: "whatsapp",
      status: "novo",
      tipo_ensaio: "gestante",
      agencia_nome: "Agência X",
      modelo_nome: "Maria",
      interesse: "Ensaio gestante",
      valor_estimado: 500,
      is_recorrente: false,
      memoria_contexto: "cliente já conversou antes",
      notes: "observação qualquer",
    };

    const result = leadWebhookSchema.safeParse(payload);

    expect(result.success).toBe(true);
  });

  it("rejeita payload sem o campo phone", () => {
    const result = leadWebhookSchema.safeParse({ name: "Maria Silva" });

    expect(result.success).toBe(false);
  });

  it("rejeita phone com menos de 8 caracteres", () => {
    const result = leadWebhookSchema.safeParse({ phone: "1234567" });

    expect(result.success).toBe(false);
  });

  it("rejeita source fora do enum permitido", () => {
    const result = leadWebhookSchema.safeParse({
      phone: "11987654321",
      source: "facebook",
    });

    expect(result.success).toBe(false);
  });

  it("rejeita status fora do enum permitido", () => {
    const result = leadWebhookSchema.safeParse({
      phone: "11987654321",
      status: "inexistente",
    });

    expect(result.success).toBe(false);
  });

  it("aceita tipo_ensaio de texto livre (rótulos customizáveis por cliente)", () => {
    const result = leadWebhookSchema.safeParse({
      phone: "11987654321",
      tipo_ensaio: "reuniao",
    });

    expect(result.success).toBe(true);
  });

  it("rejeita valor_estimado negativo", () => {
    const result = leadWebhookSchema.safeParse({
      phone: "11987654321",
      valor_estimado: -10,
    });

    expect(result.success).toBe(false);
  });

  it("rejeita name vazio quando informado", () => {
    const result = leadWebhookSchema.safeParse({
      phone: "11987654321",
      name: "",
    });

    expect(result.success).toBe(false);
  });

  it("rejeita is_recorrente com tipo diferente de boolean", () => {
    const result = leadWebhookSchema.safeParse({
      phone: "11987654321",
      is_recorrente: "sim",
    });

    expect(result.success).toBe(false);
  });
});

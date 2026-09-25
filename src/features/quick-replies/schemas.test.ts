import { describe, expect, it } from "vitest";

import {
  quickReplyInputSchema,
  quickReplyUpdateSchema,
} from "@/features/quick-replies/schemas";

describe("schemas de respostas rápidas", () => {
  it("normaliza o atalho digitado com barra e letras maiúsculas", () => {
    const parsed = quickReplyInputSchema.parse({
      title: "  Valores  ",
      shortcut: "/VALORES",
      content: "  Nossa consulta custa R$ 500.  ",
      is_active: true,
    });

    expect(parsed).toEqual({
      title: "Valores",
      shortcut: "valores",
      content: "Nossa consulta custa R$ 500.",
      is_active: true,
    });
  });

  it("rejeita atalho ambíguo e mensagem vazia", () => {
    const parsed = quickReplyInputSchema.safeParse({
      title: "Retorno",
      shortcut: "retôrno com espaço",
      content: " ",
      is_active: true,
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.shortcut).toBeDefined();
      expect(parsed.error.flatten().fieldErrors.content).toBeDefined();
    }
  });

  it("aceita atualização isolada de status e rejeita payload vazio", () => {
    expect(quickReplyUpdateSchema.parse({ is_active: false })).toEqual({
      is_active: false,
    });
    expect(quickReplyUpdateSchema.safeParse({}).success).toBe(false);
  });
});

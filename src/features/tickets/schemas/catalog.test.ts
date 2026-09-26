import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  catalogRootErrorMessage,
  productPatchSchema,
  slaPolicyPatchSchema,
  ticketCategoryCreateSchema,
  ticketCategoryPatchSchema,
  ticketStatusPatchSchema,
} from "@/features/tickets/schemas/catalog";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_ID = "22222222-2222-4222-8222-222222222222";

function fieldErrors(result: { error?: z.ZodError }): Record<string, string[] | undefined> {
  return result.error ? z.flattenError(result.error).fieldErrors : {};
}

function rootMessage(result: { error?: z.ZodError }): string | null {
  return result.error ? catalogRootErrorMessage(result.error) : null;
}

describe("productPatchSchema", () => {
  it("aceita só o que veio; ausente continua ausente", () => {
    expect(productPatchSchema.parse({ name: "  ERP Varejo  " })).toEqual({ name: "ERP Varejo" });
    expect(productPatchSchema.parse({ archived: true })).toEqual({ archived: true });
  });

  it("nicho em branco vira null; null tira o nicho", () => {
    expect(productPatchSchema.parse({ niche: "   " })).toEqual({ niche: null });
    expect(productPatchSchema.parse({ niche: null })).toEqual({ niche: null });
    expect(productPatchSchema.parse({ niche: " Varejo " })).toEqual({ niche: "Varejo" });
  });

  it.each([["E"], ["a".repeat(81)], [""], [null], ["ERP\u0000"]])(
    "recusa o nome %j no campo name",
    (name) => {
      const result = productPatchSchema.safeParse({ name });

      expect(result.success).toBe(false);
      expect(fieldErrors(result).name).toHaveLength(1);
    }
  );

  it("cor fora da paleta (inclusive chave do protótipo) → 400 no campo color", () => {
    for (const color of ["magenta", "constructor", "SKY"]) {
      expect(fieldErrors(productPatchSchema.safeParse({ color })).color).toEqual(["Cor inválida."]);
    }
    expect(productPatchSchema.parse({ color: " teal " })).toEqual({ color: "teal" });
  });

  it("nicho acima de 80 caracteres → 400 no campo", () => {
    expect(fieldErrors(productPatchSchema.safeParse({ niche: "a".repeat(81) })).niche).toEqual([
      "Máximo de 80 caracteres.",
    ]);
  });

  it("PATCH vazio → erro de raiz 'Nada para atualizar.'", () => {
    expect(rootMessage(productPatchSchema.safeParse({}))).toBe("Nada para atualizar.");
  });

  it("archived_at no corpo é recusado: a data do arquivamento é do servidor", () => {
    const result = productPatchSchema.safeParse({ archived_at: null });

    expect(result.success).toBe(false);
    expect(rootMessage(result)).toBe("Campo que não pode ser alterado por aqui: archived_at.");
  });

  it("archived só aceita booleano", () => {
    expect(fieldErrors(productPatchSchema.safeParse({ archived: "true" })).archived).toEqual([
      "Valor inválido.",
    ]);
  });
});

describe("ticketCategoryCreateSchema", () => {
  it("sem fila e sem mãe = categoria geral (null explícito)", () => {
    expect(ticketCategoryCreateSchema.parse({ name: " Financeiro " })).toEqual({
      name: "Financeiro",
      product_id: null,
      parent_id: null,
    });
  });

  it("fila e mãe vazias viram null; uuid passa", () => {
    expect(
      ticketCategoryCreateSchema.parse({ name: "Boletos", product_id: "", parent_id: "" })
    ).toEqual({ name: "Boletos", product_id: null, parent_id: null });
    expect(
      ticketCategoryCreateSchema.parse({
        name: "Boletos",
        product_id: PRODUCT_ID,
        parent_id: PARENT_ID,
      })
    ).toEqual({ name: "Boletos", product_id: PRODUCT_ID, parent_id: PARENT_ID });
  });

  it("referência fora do formato → 400 no campo", () => {
    const result = ticketCategoryCreateSchema.safeParse({
      name: "Boletos",
      product_id: "1",
      parent_id: 42,
    });

    expect(fieldErrors(result)).toEqual({
      product_id: ["Fila inválida."],
      parent_id: ["Categoria mãe inválida."],
    });
  });

  it("nome obrigatório, de 2 a 80 caracteres", () => {
    expect(fieldErrors(ticketCategoryCreateSchema.safeParse({})).name).toEqual([
      "Informe o nome da categoria.",
    ]);
    expect(fieldErrors(ticketCategoryCreateSchema.safeParse({ name: " a " })).name).toEqual([
      "Use ao menos 2 caracteres.",
    ]);
    expect(ticketCategoryCreateSchema.safeParse({ name: "a".repeat(81) }).success).toBe(false);
  });

  it("chave desconhecida → 400 (.strict())", () => {
    expect(ticketCategoryCreateSchema.safeParse({ name: "Boletos", archived: false }).success).toBe(
      false
    );
  });
});

describe("ticketCategoryPatchSchema", () => {
  it("nome e arquivar, sozinhos ou juntos", () => {
    expect(ticketCategoryPatchSchema.parse({ name: " Boletos " })).toEqual({ name: "Boletos" });
    expect(ticketCategoryPatchSchema.parse({ archived: false })).toEqual({ archived: false });
  });

  it("a fila e a mãe não mudam depois de criada", () => {
    for (const body of [{ product_id: PRODUCT_ID }, { parent_id: null }]) {
      const result = ticketCategoryPatchSchema.safeParse(body);

      expect(result.success).toBe(false);
      expect(rootMessage(result)).toMatch(/^Campo que não pode ser alterado por aqui: /);
    }
  });

  it("PATCH vazio → 'Nada para atualizar.'", () => {
    expect(rootMessage(ticketCategoryPatchSchema.safeParse({}))).toBe("Nada para atualizar.");
  });
});

describe("slaPolicyPatchSchema", () => {
  it("aceita os minutos e o aviso, cada um sozinho", () => {
    expect(slaPolicyPatchSchema.parse({ first_response_minutes: 1 })).toEqual({
      first_response_minutes: 1,
    });
    expect(slaPolicyPatchSchema.parse({ resolution_minutes: 525600 })).toEqual({
      resolution_minutes: 525600,
    });
    expect(slaPolicyPatchSchema.parse({ warn_pct: 99 })).toEqual({ warn_pct: 99 });
  });

  it.each([[0], [525601], [1.5], ["60"], [null], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "recusa %j minutos no campo",
    (value) => {
      const result = slaPolicyPatchSchema.safeParse({ resolution_minutes: value });

      expect(result.success).toBe(false);
      expect(fieldErrors(result).resolution_minutes).toHaveLength(1);
    }
  );

  it.each([[0], [100], [80.5]])("recusa aviso de %j%%", (warn_pct) => {
    expect(fieldErrors(slaPolicyPatchSchema.safeParse({ warn_pct })).warn_pct).toHaveLength(1);
  });

  it("1ª resposta maior que a solução, os dois no corpo → 400 no campo da 1ª resposta", () => {
    const result = slaPolicyPatchSchema.safeParse({
      first_response_minutes: 481,
      resolution_minutes: 480,
    });

    expect(fieldErrors(result).first_response_minutes).toEqual([
      "A 1ª resposta não pode ter prazo maior que a solução.",
    ]);
    expect(
      slaPolicyPatchSchema.safeParse({ first_response_minutes: 480, resolution_minutes: 480 })
        .success
    ).toBe(true);
  });

  it("prioridade, rank e updated_at não vêm pelo corpo", () => {
    for (const body of [{ priority: "alta" }, { rank: 2 }, { warn_pct: 80, updated_at: "x" }]) {
      expect(slaPolicyPatchSchema.safeParse(body).success).toBe(false);
    }
  });

  it("PATCH vazio → 'Nada para atualizar.'", () => {
    expect(rootMessage(slaPolicyPatchSchema.safeParse({}))).toBe("Nada para atualizar.");
  });
});

describe("ticketStatusPatchSchema", () => {
  it("rótulo aparado e cor da paleta", () => {
    expect(ticketStatusPatchSchema.parse({ label: "  Novo chamado ", color: "teal" })).toEqual({
      label: "Novo chamado",
      color: "teal",
    });
  });

  it.each([["N"], ["a".repeat(41)], ["   "], ["Novo\u{D800}"]])(
    "recusa o rótulo %j no campo label",
    (label) => {
      expect(fieldErrors(ticketStatusPatchSchema.safeParse({ label })).label).toHaveLength(1);
    }
  );

  it("modo do SLA, terminal, posição e chave não são editáveis", () => {
    for (const body of [
      { sla_mode: "paused" },
      { is_terminal: true },
      { position: 15 },
      { key: "novo", label: "Novo" },
    ]) {
      const result = ticketStatusPatchSchema.safeParse(body);

      expect(result.success).toBe(false);
      expect(rootMessage(result)).toMatch(/^Campo que não pode ser alterado por aqui: /);
    }
  });

  it("PATCH vazio → 'Nada para atualizar.'", () => {
    expect(rootMessage(ticketStatusPatchSchema.safeParse({}))).toBe("Nada para atualizar.");
  });
});

describe("catalogRootErrorMessage", () => {
  it("erro só de campo não tem mensagem de raiz", () => {
    const result = ticketStatusPatchSchema.safeParse({ color: "magenta" });

    expect(result.success).toBe(false);
    expect(rootMessage(result)).toBeNull();
  });
});

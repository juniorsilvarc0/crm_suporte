import { describe, expect, it } from "vitest";

import { botSignatureSchema } from "@/features/settings/schemas/bot-signature";

describe("botSignatureSchema", () => {
  it("liga com apelido preenchido → válido", () => {
    const r = botSignatureSchema.safeParse({ enabled: true, apelido: "Ana Lima" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ enabled: true, apelido: "Ana Lima" });
  });

  it("liga sem apelido → inválido (apelido obrigatório)", () => {
    const r = botSignatureSchema.safeParse({ enabled: true, apelido: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/apelido/i);
      expect(r.error.issues[0]?.path).toEqual(["apelido"]);
    }
  });

  it("liga com apelido só de espaços → inválido (trim vira vazio)", () => {
    const r = botSignatureSchema.safeParse({ enabled: true, apelido: "   " });
    expect(r.success).toBe(false);
  });

  it("desligado sem apelido → válido", () => {
    const r = botSignatureSchema.safeParse({ enabled: false, apelido: "" });
    expect(r.success).toBe(true);
  });

  it("desligado com apelido → válido (guarda o nome, só não assina)", () => {
    const r = botSignatureSchema.safeParse({ enabled: false, apelido: "Ana Lima" });
    expect(r.success).toBe(true);
  });

  it("apelido com mais de 40 caracteres → inválido", () => {
    const r = botSignatureSchema.safeParse({ enabled: true, apelido: "x".repeat(41) });
    expect(r.success).toBe(false);
  });

  it("faz trim do apelido", () => {
    const r = botSignatureSchema.safeParse({ enabled: true, apelido: "  Ana Lima  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.apelido).toBe("Ana Lima");
  });
});

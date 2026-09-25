import { describe, expect, it } from "vitest";

import { cleanContactName } from "@/lib/formatters/clean-name";

describe("cleanContactName", () => {
  it("preserva nome normal com acentos", () => {
    expect(cleanContactName("João Silva")).toBe("João Silva");
    expect(cleanContactName("Maria Conceição")).toBe("Maria Conceição");
  });

  it("remove emojis e colapsa espaços", () => {
    expect(cleanContactName("João 😊")).toBe("João");
    expect(cleanContactName("🔥Maria🔥")).toBe("Maria");
    expect(cleanContactName("Ana ❤️ Paula")).toBe("Ana Paula");
  });

  it("remove bandeiras (regional indicators)", () => {
    expect(cleanContactName("Pedro 🇧🇷")).toBe("Pedro");
  });

  it("remove o til de auto-update do uazapi", () => {
    expect(cleanContactName("~João Silva")).toBe("João Silva");
  });

  it("retorna null quando fica vazio ou é nulo", () => {
    expect(cleanContactName("😀")).toBeNull();
    expect(cleanContactName("   ")).toBeNull();
    expect(cleanContactName(null)).toBeNull();
    expect(cleanContactName(undefined)).toBeNull();
    expect(cleanContactName("")).toBeNull();
  });
});

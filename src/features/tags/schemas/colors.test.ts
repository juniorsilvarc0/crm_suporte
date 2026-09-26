import { describe, expect, it } from "vitest";

import { getColorStyle, isColorName } from "@/features/tags/schemas/colors";

describe("isColorName", () => {
  it("aceita um nome da paleta", () => {
    expect(isColorName("slate")).toBe(true);
    expect(isColorName("emerald")).toBe(true);
  });

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__", "Red", ""])(
    "recusa %s (chave do protótipo ou fora da paleta)",
    (value) => {
      expect(isColorName(value)).toBe(false);
    }
  );
});

describe("getColorStyle", () => {
  it("cai no estilo padrão para chave do protótipo, em vez de devolver função", () => {
    const fallback = getColorStyle(null);
    expect(getColorStyle("constructor")).toBe(fallback);
    expect(typeof getColorStyle("constructor").dot).toBe("string");
  });

  it("devolve o estilo do nome da paleta", () => {
    expect(getColorStyle("emerald")).not.toBe(getColorStyle(null));
  });
});

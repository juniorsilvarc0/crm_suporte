import { describe, expect, it } from "vitest";

import { firstParam, searchParamsRecord } from "@/lib/http/search-params";

describe("firstParam", () => {
  it("texto, lista e ausente", () => {
    expect(firstParam("a")).toBe("a");
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam([])).toBeUndefined();
    expect(firstParam(undefined)).toBeUndefined();
  });
});

describe("searchParamsRecord", () => {
  it("parâmetro repetido: vale a primeira ocorrência, como na página", () => {
    const params = new URLSearchParams("periodo=24h&integracao=api_v1&periodo=90d&integracao=relay");

    expect(searchParamsRecord(params)).toEqual({ periodo: "24h", integracao: "api_v1" });
  });

  it("decodifica o valor e guarda o vazio", () => {
    expect(searchParamsRecord(new URLSearchParams("pedido=a%2Bb&cursor="))).toEqual({ pedido: "a+b", cursor: "" });
  });

  it("nome que existe em todo objeto é parâmetro como outro qualquer", () => {
    const record = searchParamsRecord(new URLSearchParams("constructor=x&__proto__=y&toString=z"));

    expect(Object.keys(record).sort()).toEqual(["__proto__", "constructor", "toString"]);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });

  it("sem parâmetros: objeto vazio", () => {
    expect(searchParamsRecord(new URLSearchParams(""))).toEqual({});
  });
});

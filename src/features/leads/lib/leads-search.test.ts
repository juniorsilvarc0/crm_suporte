import { describe, expect, it } from "vitest";

import {
  matchingLeadSources,
  matchingLeadStatuses,
  parseLeadEntryDate,
  parseLeadSearchColumn,
  sanitizeLeadSearch,
} from "@/features/leads/lib/leads-search";

describe("busca global de leads", () => {
  it("aceita somente colunas conhecidas", () => {
    expect(parseLeadSearchColumn("contexto")).toBe("contexto");
    expect(parseLeadSearchColumn("qualquer-coisa")).toBe("lead");
    expect(parseLeadSearchColumn(undefined)).toBe("lead");
  });

  it("remove caracteres que alterariam a expressão PostgREST", () => {
    expect(sanitizeLeadSearch("  Maria%, (Souza)  ")).toBe("Maria Souza");
  });

  it("resolve rótulos de origem e status sem depender de acentos", () => {
    expect(matchingLeadSources("anuncio")).toContain("anuncio");
    expect(matchingLeadStatuses("em atendimento")).toContain("em_atendimento");
    expect(matchingLeadStatuses("pré consulta")).toEqual(["pre_consulta"]);
  });

  it("converte uma data brasileira em intervalo UTC de um dia", () => {
    expect(parseLeadEntryDate("07/08/2026")).toEqual({
      from: "2026-08-07T00:00:00-03:00",
      to: "2026-08-08T00:00:00-03:00",
    });
    expect(parseLeadEntryDate("31/02/2026")).toBeNull();
    expect(parseLeadEntryDate("agosto")).toBeNull();
  });
});

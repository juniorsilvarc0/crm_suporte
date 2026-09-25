import { describe, expect, it } from "vitest";

import {
  getLeadSourceLabel,
  getLeadStatusLabel,
  getTipoEnsaioLabel,
} from "@/features/leads/schemas/status";

describe("getLeadStatusLabel", () => {
  it("retorna o rótulo mapeado para um status conhecido", () => {
    expect(getLeadStatusLabel("novo")).toBe("Novo");
    expect(getLeadStatusLabel("em_atendimento")).toBe("Em atendimento");
    expect(getLeadStatusLabel("perdido")).toBe("Perdido");
  });

  it("humaniza um status desconhecido substituindo underscores por espaço e capitalizando", () => {
    expect(getLeadStatusLabel("status_nao_mapeado")).toBe("Status nao mapeado");
  });

  it("retorna travessão para status vazio", () => {
    expect(getLeadStatusLabel("")).toBe("—");
  });
});

describe("getLeadSourceLabel", () => {
  it("retorna o rótulo mapeado para uma origem conhecida", () => {
    expect(getLeadSourceLabel("whatsapp")).toBe("WhatsApp direto");
    expect(getLeadSourceLabel("indicacao")).toBe("Indicação");
  });

  it("humaniza uma origem desconhecida", () => {
    expect(getLeadSourceLabel("origem-nova")).toBe("Origem nova");
  });
});

describe("getTipoEnsaioLabel", () => {
  it("retorna o rótulo mapeado para um tipo conhecido", () => {
    expect(getTipoEnsaioLabel("reuniao")).toBe("Reunião");
    expect(getTipoEnsaioLabel("suporte")).toBe("Suporte");
  });

  it("humaniza um tipo desconhecido com múltiplos separadores", () => {
    expect(getTipoEnsaioLabel("tipo__novo-servico")).toBe("Tipo novo servico");
  });
});

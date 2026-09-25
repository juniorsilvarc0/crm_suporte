import { describe, expect, it } from "vitest";

import {
  classifyLead,
  conversionStageLabels,
  type ClassificationColumn,
} from "@/features/dashboard/lib/lead-classification";

// Board real de produção. Padrão da migration: conversão = etapas de ganho.
const COLUMNS: (ClassificationColumn & { label: string })[] = [
  { key: "novo", label: "Novo", stage_type: "open", counts_as_conversion: false },
  { key: "em_atendimento", label: "Em atendimento", stage_type: "open", counts_as_conversion: false },
  { key: "qualificado", label: "Qualificado", stage_type: "open", counts_as_conversion: false },
  { key: "em-atendimento-bruna", label: "Em atendimento BRUNA", stage_type: null, counts_as_conversion: false },
  { key: "agendado", label: "Agendado", stage_type: "open", counts_as_conversion: false },
  { key: "compareceu", label: "Compareceu", stage_type: "open", counts_as_conversion: false },
  { key: "cliente", label: "Cliente", stage_type: "won", counts_as_conversion: true },
  { key: "recorrente", label: "Recorrente", stage_type: "won", counts_as_conversion: true },
  { key: "perdido", label: "Perdido", stage_type: "lost", counts_as_conversion: false },
];

/** Mesmo board com "Compareceu" também marcado — o caso que motivou a task. */
const COM_COMPARECEU = COLUMNS.map((c) =>
  c.key === "compareceu" ? { ...c, counts_as_conversion: true } : c
);

describe("classifyLead", () => {
  it("etapa de entrada = sem contato", () => {
    expect(classifyLead("novo", COLUMNS)).toBe("noContact");
  });

  it("etapa aberta no meio = em etapa", () => {
    expect(classifyLead("agendado", COLUMNS)).toBe("inStage");
    expect(classifyLead("compareceu", COLUMNS)).toBe("inStage");
  });

  it("etapa de ganho marcada = convertida", () => {
    expect(classifyLead("cliente", COLUMNS)).toBe("converted");
  });

  it("perdida", () => {
    expect(classifyLead("perdido", COLUMNS)).toBe("lost");
  });

  it("ETAPA ABERTA marcada como conversão vira convertida", () => {
    expect(classifyLead("compareceu", COM_COMPARECEU)).toBe("converted");
  });

  it("conversão tem precedência sobre 'em etapa' — a soma não passa de 100%", () => {
    // Sem a precedência, "compareceu" cairia nos dois baldes.
    const buckets = COM_COMPARECEU.map((c) => classifyLead(c.key, COM_COMPARECEU));
    expect(buckets.filter((b) => b === "converted")).toHaveLength(3);
    expect(buckets.filter((b) => b === "inStage")).toHaveLength(4);
    expect(buckets.filter((b) => b === "noContact")).toHaveLength(1);
    expect(buckets.filter((b) => b === "lost")).toHaveLength(1);
    expect(buckets).toHaveLength(COM_COMPARECEU.length);
  });

  it("conversão vence até a etapa de entrada, se alguém marcar", () => {
    const absurdo = COLUMNS.map((c) =>
      c.key === "novo" ? { ...c, counts_as_conversion: true } : c
    );
    expect(classifyLead("novo", absurdo)).toBe("converted");
  });

  it("conversão vence perdido — marcar as duas coisas é contradição do usuário", () => {
    const conflito = COLUMNS.map((c) =>
      c.key === "perdido" ? { ...c, counts_as_conversion: true } : c
    );
    expect(classifyLead("perdido", conflito)).toBe("converted");
  });

  it("nenhuma etapa marcada = ninguém converte", () => {
    const semConversao = COLUMNS.map((c) => ({ ...c, counts_as_conversion: false }));
    expect(classifyLead("cliente", semConversao)).toBe("inStage");
  });

  it("status fora do board cai em 'em etapa', não some da conta", () => {
    expect(classifyLead("coluna-apagada", COLUMNS)).toBe("inStage");
  });

  it("campo ausente (board antigo, antes da migration) não converte ninguém", () => {
    const semCampo: ClassificationColumn[] = [
      { key: "cliente", stage_type: "won" },
      { key: "novo", stage_type: "open" },
    ];
    expect(classifyLead("cliente", semCampo)).toBe("inStage");
    expect(classifyLead("novo", semCampo)).toBe("noContact");
  });

  it("stage_type nulo não é perdido", () => {
    expect(classifyLead("em-atendimento-bruna", COLUMNS)).toBe("inStage");
  });
});

describe("conversionStageLabels", () => {
  it("lista o rótulo das etapas marcadas, na ordem do board", () => {
    expect(conversionStageLabels(COM_COMPARECEU)).toEqual([
      "Compareceu",
      "Cliente",
      "Recorrente",
    ]);
  });

  it("vazio quando nada está marcado", () => {
    expect(conversionStageLabels(COLUMNS.map((c) => ({ ...c, counts_as_conversion: false })))).toEqual(
      []
    );
  });

  it("cai na key quando não há rótulo", () => {
    expect(
      conversionStageLabels([{ key: "cliente", stage_type: "won", counts_as_conversion: true }])
    ).toEqual(["cliente"]);
  });
});

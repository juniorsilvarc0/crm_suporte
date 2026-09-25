import { describe, expect, it } from "vitest";

import {
  buildConversionFunnel,
  buildStagePositionIndex,
  costPer,
  formatList,
  furthestStagePosition,
  resolveFunnelStages,
  splitTrailingEmptyStages,
  summarizeSpend,
  type FunnelColumn,
  type FunnelStageRow,
} from "@/features/meta/funnel";

// As 10 colunas reais de produção, inclusive as duas filas de operador que
// ficam ENTRE Qualificado e Agendado.
const columns: FunnelColumn[] = [
  { key: "novo", label: "Novo", position: 0, stage_type: "open", counts_as_conversion: false },
  { key: "em_atendimento", label: "Em atendimento", position: 1, stage_type: "open", counts_as_conversion: false },
  { key: "qualificado", label: "Qualificado", position: 2, stage_type: "open", counts_as_conversion: false },
  { key: "em-atendimento-bruna", label: "Em atendimento BRUNA", position: 3, stage_type: "open", counts_as_conversion: false },
  { key: "em-atendimento-debora", label: "Em atendimento DEBORA", position: 4, stage_type: "open", counts_as_conversion: false },
  { key: "agendado", label: "Agendado", position: 5, stage_type: "open", counts_as_conversion: true },
  { key: "compareceu", label: "Compareceu", position: 6, stage_type: "open", counts_as_conversion: true },
  { key: "cliente", label: "Cliente", position: 7, stage_type: "won", counts_as_conversion: true },
  { key: "recorrente", label: "Recorrente", position: 8, stage_type: "won", counts_as_conversion: true },
  { key: "perdido", label: "Perdido", position: 9, stage_type: "lost", counts_as_conversion: false },
];

const index = buildStagePositionIndex(columns);
const stages = resolveFunnelStages(columns);

describe("resolveFunnelStages", () => {
  it("usa marco de conversão e qualificação, nunca as filas de operador", () => {
    expect(stages.map((stage) => stage.key)).toEqual([
      "qualificado",
      "agendado",
      "compareceu",
      "cliente",
      "recorrente",
    ]);
  });

  it("deixa a coluna de perda fora do funil", () => {
    expect(stages.some((stage) => stage.key === "perdido")).toBe(false);
    expect(index.has("perdido")).toBe(false);
  });

  it("segue a configuração: marcar outra coluna como conversão a inclui", () => {
    const withEmAtendimento = resolveFunnelStages(
      columns.map((column) =>
        column.key === "em_atendimento" ? { ...column, counts_as_conversion: true } : column
      )
    );
    expect(withEmAtendimento[0].key).toBe("em_atendimento");
  });
});

describe("furthestStagePosition", () => {
  it("pega a etapa mais avançada, não a última tocada", () => {
    expect(furthestStagePosition(["novo", "agendado", "em_atendimento"], index)).toBe(5);
  });

  it("ignora etapa desconhecida em vez de derrubar a conta", () => {
    expect(furthestStagePosition(["etapa-apagada", "novo"], index)).toBe(0);
  });

  it("ignora a coluna de perda", () => {
    expect(furthestStagePosition(["perdido"], index)).toBe(-1);
  });

  it("devolve -1 quando nada foi tocado", () => {
    expect(furthestStagePosition([], index)).toBe(-1);
  });
});

describe("buildConversionFunnel", () => {
  it("mantém o funil monotônico com lead que PULA etapa", () => {
    // O caso real de produção: novo → agendado, sem passar por em_atendimento.
    const pulou = furthestStagePosition(["novo", "agendado"], index);
    const funnel = buildConversionFunnel({
      stages,
      furthestPositions: [pulou, ...Array.from({ length: 99 }, () => 0)],
    });

    const leads = funnel.stages.map((stage) => stage.leads);
    // Quem chegou a Agendado conta também em Qualificado, que vem antes.
    expect(leads).toEqual([1, 1, 0, 0, 0]);
    for (const stage of funnel.stages) {
      expect(stage.stepConversion).not.toBeNull();
      expect(stage.stepConversion!).toBeLessThanOrEqual(100);
    }
  });

  it("calcula a conversão do enunciado: 100 leads, 30 qualificados = 30%", () => {
    const funnel = buildConversionFunnel({
      stages,
      furthestPositions: [
        ...Array.from({ length: 30 }, () => 2),
        ...Array.from({ length: 70 }, () => 0),
      ],
    });

    expect(funnel.contacts).toBe(100);
    expect(funnel.stages[0].leads).toBe(30);
    expect(funnel.stages[0].shareOfTop).toBe(30);
    expect(funnel.stages[0].stepConversion).toBe(30);
  });

  it("reproduz a coorte medida em produção", () => {
    // 144 contatos: 3 chegaram a Agendado, 1 parou na fila DEBORA (posição 4,
    // acima de Qualificado), o resto ficou em Novo/Em atendimento.
    const funnel = buildConversionFunnel({
      stages,
      furthestPositions: [5, 5, 5, 4, ...Array.from({ length: 140 }, () => 1)],
    });

    expect(funnel.contacts).toBe(144);
    expect(funnel.stages.map((stage) => stage.leads)).toEqual([4, 3, 0, 0, 0]);
    // 4/144 = 2,77…% — arredondar para inteiro aqui seria perder a casa que
    // distingue 2,8% de 3%. O formatador da UI é quem arredonda.
    expect(funnel.stages[0].shareOfTop).toBeCloseTo(2.78, 2);
    expect(funnel.stages[1].stepConversion).toBe(75);
  });

  it("não divide por zero com coorte vazia", () => {
    const funnel = buildConversionFunnel({ stages, furthestPositions: [] });
    expect(funnel.contacts).toBe(0);
    expect(funnel.stages.every((stage) => stage.leads === 0)).toBe(true);
    expect(funnel.stages.every((stage) => stage.shareOfTop === 0)).toBe(true);
    expect(funnel.stages.every((stage) => stage.stepConversion === 0)).toBe(true);
  });
});

describe("summarizeSpend", () => {
  const insights = [
    { adId: "ad-rezum", spend: 251.17, messagingStarted: 71 },
    { adId: "ad-holep", spend: 371.28, messagingStarted: 25 },
    { adId: "ad-trafego", spend: 108.75, messagingStarted: 1 },
  ];

  it("separa gasto que gerou lead do que não gerou", () => {
    const summary = summarizeSpend(
      [
        { adId: "ad-rezum", leads: 70 },
        { adId: "ad-holep", leads: 27 },
      ],
      insights
    );

    expect(summary.attributedSpend).toBeCloseTo(622.45, 2);
    expect(summary.unattributedSpend).toBeCloseTo(108.75, 2);
    expect(summary.unattributedAds).toBe(1);
    expect(summary.metaMessagingStarted).toBe(96);
  });

  it("conta lead vindo de anúncio sem veiculação no período", () => {
    const summary = summarizeSpend(
      [
        { adId: "ad-rezum", leads: 70 },
        { adId: "ad-pausado", leads: 2 },
      ],
      insights
    );

    expect(summary.leadsWithoutSpend).toBe(2);
    expect(summary.attributedSpend).toBeCloseTo(251.17, 2);
  });

  it("trata lead sem anúncio identificado como lead sem gasto", () => {
    const summary = summarizeSpend([{ adId: null, leads: 1 }], insights);
    expect(summary.leadsWithoutSpend).toBe(1);
    expect(summary.attributedSpend).toBe(0);
  });

  it("soma o mesmo anúncio uma vez só, mesmo com leads em grupos separados", () => {
    const summary = summarizeSpend(
      [
        { adId: "ad-rezum", leads: 40 },
        { adId: "ad-rezum", leads: 30 },
      ],
      insights
    );
    expect(summary.attributedSpend).toBeCloseTo(251.17, 2);
  });
});

describe("splitTrailingEmptyStages", () => {
  function row(key: string, leads: number): FunnelStageRow {
    return { key, label: key, position: 0, leads, shareOfTop: 0, stepConversion: 0 };
  }

  it("junta as etapas vazias do FIM, que é a coorte de produção hoje", () => {
    const { reached, pending } = splitTrailingEmptyStages([
      row("qualificado", 4),
      row("agendado", 3),
      row("compareceu", 0),
      row("cliente", 0),
      row("recorrente", 0),
    ]);

    expect(reached.map((stage) => stage.key)).toEqual(["qualificado", "agendado"]);
    expect(pending.map((stage) => stage.key)).toEqual([
      "compareceu",
      "cliente",
      "recorrente",
    ]);
  });

  it("mantém etapa zerada no MEIO: ali o zero é informação", () => {
    const { reached, pending } = splitTrailingEmptyStages([
      row("qualificado", 0),
      row("agendado", 3),
    ]);

    expect(reached).toHaveLength(2);
    expect(pending).toHaveLength(0);
  });

  it("não quebra com tudo zerado nem com lista vazia", () => {
    expect(splitTrailingEmptyStages([row("a", 0)]).reached).toHaveLength(0);
    expect(splitTrailingEmptyStages([]).pending).toHaveLength(0);
  });
});

describe("formatList", () => {
  it("usa 'e' antes do último, como se fala", () => {
    expect(formatList(["Compareceu", "Cliente", "Recorrente"])).toBe(
      "Compareceu, Cliente e Recorrente"
    );
    expect(formatList(["Cliente", "Recorrente"])).toBe("Cliente e Recorrente");
    expect(formatList(["Cliente"])).toBe("Cliente");
    expect(formatList([])).toBe("");
  });
});

describe("costPer", () => {
  it("calcula o custo medido em produção", () => {
    expect(costPer(1171.84, 141)).toBeCloseTo(8.31, 2);
  });

  it("devolve null sem denominador — R$ 0 por paciente seria mentira", () => {
    expect(costPer(1171.84, 0)).toBeNull();
  });

  it("devolve null sem gasto conhecido", () => {
    expect(costPer(0, 141)).toBeNull();
  });
});

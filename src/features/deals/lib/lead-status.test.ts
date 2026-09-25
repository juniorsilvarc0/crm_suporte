import { describe, expect, it } from "vitest";

import {
  projectLeadStatus,
  type StageColumn,
} from "@/features/deals/lib/lead-status";

// Board real de produção (10 colunas, com duas customizadas no meio).
const COLUMNS: StageColumn[] = [
  { key: "novo", position: 0, stage_type: "open" },
  { key: "em_atendimento", position: 1, stage_type: "open" },
  { key: "qualificado", position: 2, stage_type: "open" },
  { key: "em-atendimento-bruna", position: 3, stage_type: null },
  { key: "em-atendimento-debora", position: 4, stage_type: null },
  { key: "agendado", position: 5, stage_type: "open" },
  { key: "compareceu", position: 6, stage_type: "open" },
  { key: "cliente", position: 7, stage_type: "won" },
  { key: "recorrente", position: 8, stage_type: "won" },
  { key: "perdido", position: 9, stage_type: "lost" },
];

const deals = (...stages: (string | null)[]) => stages.map((stage) => ({ stage }));

describe("projectLeadStatus", () => {
  it("um card só = a etapa dele", () => {
    expect(projectLeadStatus(deals("em_atendimento"), COLUMNS)).toBe("em_atendimento");
  });

  it("sem card, devolve null — o chamador não deve mexer no lead", () => {
    expect(projectLeadStatus([], COLUMNS)).toBeNull();
  });

  it("vários cards abertos: vence o mais avançado do board", () => {
    expect(projectLeadStatus(deals("novo", "agendado", "em_atendimento"), COLUMNS)).toBe(
      "agendado"
    );
  });

  it("coluna customizada entra na ordem pela position", () => {
    expect(
      projectLeadStatus(deals("qualificado", "em-atendimento-debora"), COLUMNS)
    ).toBe("em-atendimento-debora");
  });

  it("GANHO vence card aberto mais avançado — não rebaixa quem já comprou", () => {
    expect(projectLeadStatus(deals("cliente", "agendado"), COLUMNS)).toBe("cliente");
  });

  it("GANHO vence perdido", () => {
    expect(projectLeadStatus(deals("perdido", "cliente"), COLUMNS)).toBe("cliente");
  });

  it("aberto vence perdido — ainda há atendimento vivo", () => {
    expect(projectLeadStatus(deals("perdido", "novo"), COLUMNS)).toBe("novo");
  });

  it("só perdido = lead perdido", () => {
    expect(projectLeadStatus(deals("perdido", "perdido"), COLUMNS)).toBe("perdido");
  });

  it("entre dois ganhos, o mais avançado", () => {
    expect(projectLeadStatus(deals("cliente", "recorrente"), COLUMNS)).toBe("recorrente");
  });

  it("stage_type nulo conta como aberto", () => {
    expect(projectLeadStatus(deals("em-atendimento-bruna"), COLUMNS)).toBe(
      "em-atendimento-bruna"
    );
  });

  it("etapa fora de board_columns é ignorada", () => {
    expect(projectLeadStatus(deals("coluna-apagada", "novo"), COLUMNS)).toBe("novo");
  });

  it("todas as etapas órfãs devolvem null em vez de chutar", () => {
    expect(projectLeadStatus(deals("coluna-apagada", null), COLUMNS)).toBeNull();
  });

  it("sem colunas (board indisponível) devolve null", () => {
    expect(projectLeadStatus(deals("novo"), [])).toBeNull();
  });

  it("ordem dos cards não altera o resultado", () => {
    const cards = deals("perdido", "cliente", "novo", "agendado");
    expect(projectLeadStatus(cards, COLUMNS)).toBe("cliente");
    expect(projectLeadStatus([...cards].reverse(), COLUMNS)).toBe("cliente");
  });
});

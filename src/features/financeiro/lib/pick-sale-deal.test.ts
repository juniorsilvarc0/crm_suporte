import { describe, expect, it } from "vitest";

import {
  pickSaleDeal,
  type DealForSale,
  type SaleStageColumn,
} from "@/features/financeiro/lib/pick-sale-deal";

const COLUMNS: SaleStageColumn[] = [
  { key: "novo", position: 0, stage_type: "open" },
  { key: "em_atendimento", position: 1, stage_type: "open" },
  { key: "agendado", position: 5, stage_type: "open" },
  { key: "compareceu", position: 6, stage_type: "open" },
  { key: "cliente", position: 7, stage_type: "won" },
  { key: "perdido", position: 9, stage_type: "lost" },
];

const deal = (id: string, stage: string | null, created_at: string): DealForSale => ({
  id,
  stage,
  created_at,
});

describe("pickSaleDeal", () => {
  it("sem card, devolve null — a venda é registrada e o funil fica parado", () => {
    expect(pickSaleDeal([], COLUMNS)).toBeNull();
  });

  it("um card só", () => {
    expect(pickSaleDeal([deal("a", "em_atendimento", "2026-08-01")], COLUMNS)).toBe("a");
  });

  it("entre abertos, o mais avançado do board", () => {
    const deals = [
      deal("a", "novo", "2026-08-03"),
      deal("b", "compareceu", "2026-08-01"),
      deal("c", "em_atendimento", "2026-08-02"),
    ];
    expect(pickSaleDeal(deals, COLUMNS)).toBe("b");
  });

  it("card ganho não rouba a venda de um atendimento vivo", () => {
    const deals = [deal("ganho", "cliente", "2026-08-03"), deal("vivo", "agendado", "2026-08-01")];
    expect(pickSaleDeal(deals, COLUMNS)).toBe("vivo");
  });

  it("card perdido também não", () => {
    const deals = [deal("perdido", "perdido", "2026-08-03"), deal("vivo", "novo", "2026-08-01")];
    expect(pickSaleDeal(deals, COLUMNS)).toBe("vivo");
  });

  it("só cards fechados = recompra, vai no mais recente", () => {
    const deals = [deal("antigo", "cliente", "2026-07-01"), deal("novo", "cliente", "2026-08-01")];
    expect(pickSaleDeal(deals, COLUMNS)).toBe("novo");
  });

  it("empate de etapa resolve pelo mais recente", () => {
    const deals = [
      deal("antigo", "agendado", "2026-07-01"),
      deal("recente", "agendado", "2026-08-01"),
    ];
    expect(pickSaleDeal(deals, COLUMNS)).toBe("recente");
  });

  it("etapa órfã conta como aberta, mas perde para qualquer etapa conhecida", () => {
    const deals = [
      deal("orfao", "coluna-apagada", "2026-08-05"),
      deal("conhecido", "novo", "2026-08-01"),
    ];
    expect(pickSaleDeal(deals, COLUMNS)).toBe("conhecido");
  });

  it("stage nulo não quebra", () => {
    expect(pickSaleDeal([deal("a", null, "2026-08-01")], COLUMNS)).toBe("a");
  });

  it("board indisponível: cai no mais recente sem quebrar", () => {
    const deals = [deal("a", "novo", "2026-07-01"), deal("b", "agendado", "2026-08-01")];
    expect(pickSaleDeal(deals, [])).toBe("b");
  });

  it("ordem da entrada não altera o resultado", () => {
    const deals = [
      deal("a", "novo", "2026-08-03"),
      deal("b", "compareceu", "2026-08-01"),
      deal("c", "agendado", "2026-08-02"),
    ];
    expect(pickSaleDeal(deals, COLUMNS)).toBe("b");
    expect(pickSaleDeal([...deals].reverse(), COLUMNS)).toBe("b");
  });
});

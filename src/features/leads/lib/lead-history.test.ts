import { describe, expect, it } from "vitest";

import {
  buildLeadHistoryItems,
  formatLeadHistoryTimestamp,
  getLeadHistoryTransitionLabel,
} from "@/features/leads/lib/lead-history";

describe("lead-history", () => {
  it("prioriza os rótulos atuais das colunas do funil", () => {
    const [item] = buildLeadHistoryItems(
      [
        {
          id: "history-1",
          from_stage: "em-atendimento-debora",
          to_stage: "agendado",
          occurred_at: "2026-08-10T19:32:00.000Z",
        },
      ],
      [
        { key: "em-atendimento-debora", label: "Em atendimento · Débora" },
        { key: "agendado", label: "Consulta agendada" },
      ]
    );

    expect(getLeadHistoryTransitionLabel(item)).toBe(
      "Em atendimento · Débora → Consulta agendada"
    );
  });

  it("diferencia a entrada inicial de uma mudança de etapa", () => {
    const [item] = buildLeadHistoryItems(
      [
        {
          id: "history-2",
          from_stage: null,
          to_stage: "novo",
          occurred_at: "2026-08-10T19:32:00.000Z",
        },
      ],
      []
    );

    expect(getLeadHistoryTransitionLabel(item)).toBe("Entrou em Novo");
  });

  it("formata data e hora no fuso do CRM", () => {
    expect(formatLeadHistoryTimestamp("2026-08-10T17:32:00.000Z")).toBe(
      "10/08/2026 às 14:32"
    );
  });
});

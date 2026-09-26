import { describe, expect, it } from "vitest";

import { ticketActionErrorMessage } from "@/features/tickets/lib/ticket-action-error";
import type { TicketTakeOverErrorBody } from "@/features/tickets/types";

function failure(status: number, body: Partial<TicketTakeOverErrorBody> | null) {
  return { ok: false as const, status, body: body ? ({ ok: false, message: "", code: "", ...body } as TicketTakeOverErrorBody) : null };
}

describe("ticketActionErrorMessage", () => {
  it("rede fora: pede para conferir a conexão", () => {
    expect(ticketActionErrorMessage(failure(0, null), "novo", null)).toContain("Confira a conexão");
  });

  it("conflito de versão e ticket já pego têm frase própria", () => {
    expect(ticketActionErrorMessage(failure(409, { code: "version_conflict" }), "novo", null)).toBe(
      "O ticket mudou em outro lugar."
    );
    expect(ticketActionErrorMessage(failure(409, { code: "already_assigned" }), "novo", null)).toBe(
      "Alguém já pegou este ticket."
    );
  });

  it("transição inválida lista os destinos com o rótulo do catálogo", () => {
    const message = ticketActionErrorMessage(
      failure(409, { code: "invalid_transition", allowed: ["em_triagem"], current: "novo" }),
      "em_atendimento",
      [
        { key: "novo", label: "Recebido", color: "blue", position: 1, sla_mode: "running", is_terminal: false },
        { key: "em_triagem", label: "Triagem", color: "blue", position: 2, sla_mode: "running", is_terminal: false },
      ]
    );
    expect(message).toBe("De Recebido só vai para Triagem.");
  });

  it("o resto usa o erro do campo, depois a mensagem da rota", () => {
    expect(
      ticketActionErrorMessage(
        failure(422, { code: "x", message: "Revise.", errors: { reason: ["Informe o motivo."] } }),
        "novo",
        null
      )
    ).toBe("Informe o motivo.");
    expect(ticketActionErrorMessage(failure(404, { code: "not_found", message: "Ticket não encontrado." }), "novo", null)).toBe(
      "Ticket não encontrado."
    );
    expect(ticketActionErrorMessage(failure(500, null), "novo", null)).toBe(
      "Não foi possível concluir a operação."
    );
  });
});

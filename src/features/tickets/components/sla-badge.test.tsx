import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { SlaBadge } from "@/features/tickets/components/sla-badge";
import type { SlaTone } from "@/features/tickets/lib/sla";
import type { TicketSlaFields } from "@/features/tickets/types";

// Relógio fixo: nenhum teste depende da hora em que roda.
const NOW = new Date("2026-09-25T12:00:00.000Z");
const MINUTE = 60_000;

// Instante a `minutes` de NOW no formato do PostgREST (fração zerada omitida).
const at = (minutes: number) =>
  new Date(NOW.getTime() + minutes * MINUTE).toISOString().replace(/(?:\.000)?Z$/, "+00:00");

type Policy = { first: number; resolution: number };
// A semente de sla_policies (migration 20260925120900, bloco 1.3), aviso a 80%.
const CRITICA: Policy = { first: 30, resolution: 240 };
const ALTA: Policy = { first: 60, resolution: 480 };
const MEDIA: Policy = { first: 240, resolution: 1440 };

// Ticket aberto há `openedMinutesAgo`, em `novo`, correndo e sem 1ª resposta;
// `patch` faz o resto do caso.
function ticket(
  openedMinutesAgo: number,
  patch: Partial<TicketSlaFields> = {},
  policy: Policy = CRITICA
): TicketSlaFields {
  return {
    status: "novo",
    sla_mode: "running",
    sla_first_response_minutes: policy.first,
    sla_resolution_minutes: policy.resolution,
    sla_warn_pct: 80,
    first_response_due_at: at(-openedMinutesAgo + policy.first),
    resolution_due_at: at(-openedMinutesAgo + policy.resolution),
    first_responded_at: null,
    sla_paused_at: null,
    resolved_at: null,
    closed_at: null,
    ...patch,
  };
}

const answered = { status: "em_atendimento", first_responded_at: at(-1) } as const;
const paused = (minutesAgo: number) =>
  ({
    status: "aguardando_cliente",
    sla_mode: "paused",
    first_responded_at: at(-minutesAgo - 1),
    sla_paused_at: at(-minutesAgo),
  }) as const;
const resolved = (minutesAgo: number) =>
  ({
    status: "resolvido",
    sla_mode: "stopped",
    first_responded_at: at(-minutesAgo - 1),
    sla_paused_at: at(-minutesAgo),
    resolved_at: at(-minutesAgo),
  }) as const;

function badgeOf(label: string) {
  return screen.getByText(label).parentElement;
}

// A tabela "lib/sla.ts" da spec da Fase 4 (seção 3, Telas), com os textos
// reais de formatDuration ("2 horas", não "2 h").
describe("SlaBadge — rótulos da tabela da spec", () => {
  it.each<[string, TicketSlaFields, string, SlaTone]>([
    ["1ª resposta pendente, no prazo", ticket(5), "1ª resposta em 25 min", "ok"],
    ["1ª resposta pendente, a partir do aviso", ticket(26), "1ª resposta em 4 min", "warn"],
    ["1ª resposta vencida", ticket(150), "1ª resposta atrasada há 2 horas", "breached"],
    // Pronto do PR 4: alta com a abertura recuada 6 h.
    ["solução correndo", ticket(360, answered, ALTA), "Vence em 2 horas", "ok"],
    ["solução correndo, a partir do aviso", ticket(200, answered), "Vence em 40 min", "warn"],
    ["solução vencida", ticket(420, answered), "Venceu há 3 horas", "breached"],
    // Pronto do PR 4: aguardando cliente pausa o relógio da solução.
    ["pausado", ticket(80, paused(20)), "Pausado · restavam 3 horas", "paused"],
    ["pausado depois de vencer", ticket(300, paused(30)), "Pausado · venceu há 1 hora", "breached"],
    ["resolvido no prazo", ticket(600, resolved(60), MEDIA), "Resolvido no prazo", "met"],
    ["resolvido fora do prazo", ticket(600, resolved(60)), "Resolvido fora do prazo", "missed"],
    [
      "cancelado",
      ticket(10, { status: "cancelado", sla_mode: "stopped", sla_paused_at: at(-1) }),
      "Cancelado",
      "none",
    ],
  ])("%s → \"%s\" (%s)", (_case, fields, label, tone) => {
    render(<SlaBadge ticket={fields} now={NOW} />);

    const badge = badgeOf(label);
    expect(badge).toHaveAttribute("data-tone", tone);
    expect(badge).toHaveAttribute("title", label);
  });

  it("pausado com a 1ª resposta pendente mostra a 1ª resposta, não \"Pausado\"", () => {
    const fields = ticket(5, {
      status: "aguardando_cliente",
      sla_mode: "paused",
      sla_paused_at: at(-2),
    });
    render(<SlaBadge ticket={fields} now={NOW} />);

    expect(badgeOf("1ª resposta em 25 min")).toHaveAttribute("data-tone", "ok");
    expect(screen.queryByText(/Pausado/)).not.toBeInTheDocument();
  });
});

describe("SlaBadge — cor do tom", () => {
  it("estouro usa o token destrutivo com fundo", () => {
    render(<SlaBadge ticket={ticket(420, answered)} now={NOW} />);

    const badge = badgeOf("Venceu há 3 horas");
    expect(badge).toHaveClass("text-destructive", "bg-destructive/10");
    expect(badge).not.toHaveClass("text-foreground");
  });

  it("resolvido fora do prazo é destrutivo sem fundo", () => {
    render(<SlaBadge ticket={ticket(600, resolved(60))} now={NOW} />);

    const badge = badgeOf("Resolvido fora do prazo");
    expect(badge).toHaveClass("text-destructive");
    expect(badge).not.toHaveClass("bg-destructive/10");
  });

  it("aviso e resolvido no prazo usam a paleta de domínio", () => {
    render(
      <>
        <SlaBadge ticket={ticket(26)} now={NOW} />
        <SlaBadge ticket={ticket(600, resolved(60), MEDIA)} now={NOW} />
      </>
    );

    expect(badgeOf("1ª resposta em 4 min")).toHaveClass("text-amber-700");
    expect(badgeOf("Resolvido no prazo")).toHaveClass("text-emerald-700");
  });

  it("pausa e cancelado ficam discretos", () => {
    render(
      <>
        <SlaBadge ticket={ticket(80, paused(20))} now={NOW} />
        <SlaBadge
          ticket={ticket(10, { status: "cancelado", sla_mode: "stopped", sla_paused_at: at(-1) })}
          now={NOW}
        />
      </>
    );

    expect(badgeOf("Pausado · restavam 3 horas")).toHaveClass("bg-muted", "text-muted-foreground");
    expect(badgeOf("Cancelado")).toHaveClass("text-muted-foreground");
  });
});

describe("SlaBadge — dado inválido", () => {
  it("instante inválido não vira selo", () => {
    const { container } = render(
      <SlaBadge ticket={ticket(5, { resolution_due_at: "não é data" })} now={NOW} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});

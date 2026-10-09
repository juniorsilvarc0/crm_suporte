import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { MetricsPeriodSwitch } from "@/features/metrics/components/metrics-period-switch";
import { MetricsSummary } from "@/features/metrics/components/metrics-summary";
import { OpenedResolvedChart } from "@/features/metrics/components/opened-resolved-chart";
import type { SupportMetrics } from "@/features/metrics/types";

const metrics = (overrides: Partial<SupportMetrics> = {}): SupportMetrics => ({
  openNow: 12,
  breachedNow: 3,
  opened: 40,
  openedByAi: 10,
  resolved: 35,
  firstResponse: { medianMs: (2 * 60 + 15) * 60_000, sample: 30 },
  resolution: { medianMs: (3 * 24 + 4) * 3_600_000, sample: 35 },
  reopened: 2,
  daily: [],
  partial: false,
  ...overrides,
});

function stat(label: string) {
  const term = screen.getByText(label, { selector: "dt" });
  return term.parentElement as HTMLElement;
}

describe("MetricsSummary", () => {
  it("põe o que está em aberto agora como protagonista, com o SLA estourado e o aviso de que não segue o período", () => {
    render(<MetricsSummary metrics={metrics()} days={30} />);

    expect(screen.getByRole("heading", { name: "Em aberto agora" })).toBeInTheDocument();
    expect(screen.getByText("12")).toHaveClass("text-5xl");
    expect(screen.getByText("3 com SLA estourado")).toHaveClass("text-destructive");
    expect(screen.getByText(/independente do período/)).toBeInTheDocument();
  });

  it("todo número da janela diz o que conta e traz o lastro", () => {
    render(<MetricsSummary metrics={metrics()} days={30} />);

    expect(screen.getByRole("heading", { name: "Nos últimos 30 dias" })).toBeInTheDocument();
    expect(within(stat("Abertos")).getByText("40")).toBeInTheDocument();
    expect(within(stat("Resolvidos")).getByText("35")).toBeInTheDocument();
    expect(within(stat("1ª resposta")).getByText("2 h 15 min")).toBeInTheDocument();
    expect(within(stat("1ª resposta")).getByText("mediana · 30 com resposta do analista")).toBeInTheDocument();
    expect(within(stat("Resolução")).getByText("3 d 4 h")).toBeInTheDocument();
    expect(within(stat("Reaberturas")).getByText("2")).toBeInTheDocument();
    expect(within(stat("Abertos pela IA")).getByText("25%")).toBeInTheDocument();
    expect(within(stat("Abertos pela IA")).getByText("10 de 40")).toBeInTheDocument();
  });

  it("sem amostra mostra traço com o motivo, nunca zero inventado", () => {
    render(
      <MetricsSummary
        metrics={metrics({
          breachedNow: 0,
          opened: 0,
          openedByAi: 0,
          firstResponse: { medianMs: null, sample: 0 },
          resolution: { medianMs: null, sample: 0 },
        })}
        days={7}
      />
    );

    expect(screen.getByText("nenhum com SLA estourado")).not.toHaveClass("text-destructive");
    expect(within(stat("1ª resposta")).getByText("—")).toBeInTheDocument();
    expect(within(stat("1ª resposta")).getByText("nenhum ticket respondido")).toBeInTheDocument();
    expect(within(stat("Abertos pela IA")).getByText("nenhum ticket aberto")).toBeInTheDocument();
  });

  it("avisa quando medianas e gráfico saem de uma amostra", () => {
    render(<MetricsSummary metrics={metrics({ partial: true })} days={90} />);

    expect(screen.getByText(/as contagens são exatas/)).toBeInTheDocument();
  });
});

describe("OpenedResolvedChart", () => {
  const data = [
    { date: "2026-10-08", abertos: 3, resolvidos: 1 },
    { date: "2026-10-09", abertos: 2, resolvidos: 4 },
  ];

  it("legenda as duas séries com o total de cada uma, sem depender só da cor", () => {
    render(<OpenedResolvedChart data={data} days={7} />);

    const legend = screen.getByRole("list");
    expect(within(legend).getByText("Abertos").parentElement).toHaveTextContent("Abertos5");
    expect(within(legend).getByText("Resolvidos").parentElement).toHaveTextContent("Resolvidos5");
  });

  it("descreve o gráfico e traz a tabela de cada dia para quem não o vê", () => {
    render(<OpenedResolvedChart data={data} days={7} />);

    expect(screen.getByRole("img", { name: /5 abertos e 5 resolvidos/ })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Abertos e resolvidos por dia, últimos 7 dias" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByRole("rowheader")).toHaveTextContent("08/10");
    expect(rows[1]).toHaveTextContent("08/1031");
  });

  it("período sem movimento diz isso em vez de desenhar duas linhas no zero", () => {
    render(
      <OpenedResolvedChart data={[{ date: "2026-10-09", abertos: 0, resolvidos: 0 }]} days={7} />
    );

    expect(screen.getByText("Nenhum ticket aberto ou resolvido no período.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("MetricsPeriodSwitch", () => {
  it("marca o período atual e leva os outros pela URL", () => {
    render(<MetricsPeriodSwitch days={7} />);

    expect(screen.getByRole("link", { name: "7 dias" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "30 dias" })).toHaveAttribute("href", "/app/metricas");
    expect(screen.getByRole("link", { name: "90 dias" })).toHaveAttribute("href", "/app/metricas?periodo=90");
  });
});

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { AiVsHuman } from "@/features/metrics/components/ai-vs-human";
import { MetricsBreakdowns } from "@/features/metrics/components/metrics-breakdowns";
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
  breakdowns: { byProduct: [], byAssignee: [], byCustomer: [], customerCount: 0 },
  aiVsHuman: { openedBy: { ai: 10, agent: 25, api: 5 }, firstAiResponse: { medianMs: 60_000, sample: 9 }, resolvedWithoutHuman: 4 },
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

describe("MetricsBreakdowns", () => {
  const row = (name: string, id: string | null, overrides = {}) => ({
    id,
    name,
    opened: 4,
    resolved: 3,
    openNow: 2,
    firstResponse: { medianMs: 15 * 60_000, sample: 3 },
    ...overrides,
  });

  it("uma tabela por recorte, com o lastro da mediana e 'Sem …' em tom secundário", () => {
    render(
      <MetricsBreakdowns
        days={30}
        breakdowns={{
          byProduct: [row("ERP", "erp"), row("Sem fila", null)],
          byAssignee: [row("Ana Lima", "ana", { firstResponse: { medianMs: null, sample: 0 } })],
          byCustomer: [row("Padaria São João", "padaria")],
          customerCount: 1,
        }}
      />
    );

    const filas = within(screen.getByRole("region", { name: "Por fila" }));
    const erp = filas.getByRole("row", { name: /ERP/ });
    expect(erp).toHaveTextContent("ERP4321");
    expect(within(erp).getByText("15 min")).toBeInTheDocument();
    expect(erp).toHaveTextContent("· 3 respondidos");
    expect(filas.getByText("Sem fila")).toHaveClass("text-muted-foreground");

    const analistas = within(screen.getByRole("region", { name: "Por analista" }));
    expect(analistas.getByText("Pelo responsável atual do ticket")).toBeInTheDocument();
    expect(analistas.getByRole("row", { name: /Ana Lima/ })).toHaveTextContent("—");

    const clientes = within(screen.getByRole("region", { name: "Clientes que mais abriram" }));
    expect(clientes.getByRole("row", { name: /Padaria São João/ })).toHaveTextContent("Padaria São João4321");
  });

  it("o subtítulo do ranking de clientes diz se mostra todos ou só os primeiros", () => {
    const customers = Array.from({ length: 3 }, (_, index) => row(`Cliente ${index}`, `c${index}`));
    const { rerender } = render(
      <MetricsBreakdowns days={30} breakdowns={{ byProduct: [], byAssignee: [], byCustomer: customers.slice(0, 1), customerCount: 1 }} />
    );
    expect(screen.getByText("O único cliente com ticket aberto no período")).toBeInTheDocument();

    rerender(<MetricsBreakdowns days={30} breakdowns={{ byProduct: [], byAssignee: [], byCustomer: customers, customerCount: 3 }} />);
    expect(screen.getByText("Os 3 clientes com ticket aberto no período")).toBeInTheDocument();

    const ten = Array.from({ length: 10 }, (_, index) => row(`Cliente ${index}`, `c${index}`));
    rerender(<MetricsBreakdowns days={30} breakdowns={{ byProduct: [], byAssignee: [], byCustomer: ten, customerCount: 12 }} />);
    expect(screen.getByText("Os 10 com mais tickets abertos, de 12 clientes no período")).toBeInTheDocument();
  });

  it("recorte sem ticket diz isso, sem tabela vazia", () => {
    render(
      <MetricsBreakdowns days={7} breakdowns={{ byProduct: [], byAssignee: [], byCustomer: [], customerCount: 0 }} />
    );

    expect(screen.getAllByText("Nenhum ticket no período.")).toHaveLength(3);
    expect(screen.getByText("Nenhum ticket de empresa cadastrada no período")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("AiVsHuman", () => {
  it("mostra quem abriu, a 1ª resposta da IA e os resolvidos sem o analista, com o lastro", () => {
    render(<AiVsHuman metrics={metrics().aiVsHuman} resolved={35} days={30} />);

    const section = within(screen.getByRole("region", { name: "IA × analista" }));
    expect(section.getByText("Quem abriu").nextElementSibling).toHaveTextContent("10 IA25 analista5 integração");
    expect(section.getByText("1 min")).toBeInTheDocument();
    expect(section.getByText("mediana · 9 com resposta da IA")).toBeInTheDocument();
    expect(section.getByText("4")).toBeInTheDocument();
    expect(section.getByText("de 35 resolvidos, sem nenhuma resposta do analista")).toBeInTheDocument();
  });

  it("sem resposta da IA, explica em vez de mostrar zero", () => {
    render(
      <AiVsHuman
        metrics={{ openedBy: { ai: 0, agent: 2, api: 0 }, firstAiResponse: { medianMs: null, sample: 0 }, resolvedWithoutHuman: 0 }}
        resolved={0}
        days={7}
      />
    );

    expect(screen.getByText("a IA não respondeu nenhum ticket aberto no período")).toBeInTheDocument();
    expect(screen.getByText("nenhum ticket resolvido")).toBeInTheDocument();
  });
});

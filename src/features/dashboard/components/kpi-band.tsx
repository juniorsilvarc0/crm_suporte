import {
  CalendarPlusIcon,
  CircleDotIcon,
  DollarSignIcon,
  TargetIcon,
  TicketIcon,
  TrophyIcon,
  UserRoundSearchIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import type { DashboardKpis } from "@/features/dashboard/types";
import { formatMoney } from "@/lib/formatters/money";
import { formatNumber } from "@/lib/formatters/numbers";
import { formatPercentage } from "@/lib/formatters/percentage";
import { cn } from "@/lib/utils";

type Metric = {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone: "primary" | "neutral";
};

export function KpiBand({
  kpis,
  awaiting,
  inStage,
  converted,
  total,
  conversionStages,
}: {
  kpis: DashboardKpis;
  /** Base inteira, tempo real — não segue o período (ver getDashboardData). */
  awaiting: number;
  inStage: number;
  /** Numerador e denominador da conversão, para o número não ficar sem lastro. */
  converted: number;
  total: number;
  /** Etapas marcadas como conversão em Configurar funil. */
  conversionStages: string[];
}) {
  // Taxa configurável precisa dizer o que conta, senão ninguém confere:
  // "5 de 320 · Compareceu". Trunca no CSS quando há muitas etapas marcadas.
  const conversionHint =
    conversionStages.length > 0
      ? `${formatNumber(converted)} de ${formatNumber(total)} · ${conversionStages.join(", ")}`
      : "nenhuma etapa marcada como conversão";
  const metrics: Metric[] = [
    {
      label: "Total de leads",
      value: formatNumber(kpis.totalLeads.value),
      icon: UsersIcon,
      tone: "primary",
    },
    {
      label: "Recebidos hoje",
      value: formatNumber(kpis.leadsHoje),
      icon: CalendarPlusIcon,
      tone: "neutral",
    },
    {
      label: "Aguardando contato",
      value: formatNumber(awaiting),
      hint: "no funil agora",
      icon: UserRoundSearchIcon,
      tone: "neutral",
    },
    {
      label: "Em atendimento",
      value: formatNumber(inStage),
      hint: "no funil agora",
      icon: CircleDotIcon,
      tone: "neutral",
    },
    {
      label: "Conversão",
      value: formatPercentage(kpis.conversao.value),
      hint: conversionHint,
      icon: TargetIcon,
      tone: "neutral",
    },
    {
      label: "Vendas",
      value: formatNumber(kpis.vendas),
      hint: "no período",
      icon: TrophyIcon,
      tone: "neutral",
    },
    {
      label: "Receita total",
      value: formatMoney(kpis.receita.value),
      hint: `Hoje: ${formatMoney(kpis.receitaHoje)}`,
      icon: DollarSignIcon,
      tone: "primary",
    },
    {
      label: "Ticket médio",
      value: formatMoney(kpis.ticketMedio.value),
      hint: "por venda no período",
      icon: TicketIcon,
      tone: "neutral",
    },
  ];

  // 8 métricas em widgets SOLTOS (casca 3.0): cada número é um cartão que
  // flutua sobre a água, não uma célula de tabela. A banda única com divisores
  // dava a mesma moldura para oito grandezas diferentes e lia como planilha.
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {metrics.map((metric) => {
        const Icon = metric.icon;

        return (
          // Sem elevação no hover: o KPI não é clicável, e mover o que não
          // responde ao clique é decoração que promete interação inexistente.
          <Card key={metric.label} className="gap-0 py-0">
            <div className="min-w-0 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {metric.label}
                </span>
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full",
                    metric.tone === "primary"
                      ? "bg-primary/10 text-primary"
                      : "bg-accent text-accent-foreground",
                  )}
                >
                  <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
                </span>
              </div>
              <div className="mt-2 truncate font-display text-2xl font-semibold tracking-tight tabular-nums lg:text-3xl">
                {metric.value}
              </div>
              {metric.hint ? (
                <div className="truncate text-[11px] text-muted-foreground">
                  {metric.hint}
                </div>
              ) : null}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

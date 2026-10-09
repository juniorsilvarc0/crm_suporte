import type { MetricRange } from "@/features/metrics/lib/period";

// Tipos neutros (o client importa): a query os preenche no servidor.

/** Ticket aberto na janela: o que as métricas de abertura e 1ª resposta leem. */
export type CreatedTicketRow = {
  created_at: string;
  source: string;
  first_responded_at: string | null;
};

/** Ticket resolvido na janela (pela `resolved_at` atual). */
export type ResolvedTicketRow = {
  created_at: string;
  resolved_at: string;
};

/** Um dia do gráfico: o que abriu e o que foi resolvido naquele dia do app. */
export type DailyPoint = {
  date: string;
  abertos: number;
  resolvidos: number;
};

/** Uma mediana com o tamanho da amostra (o lastro do número). */
export type MedianMetric = {
  medianMs: number | null;
  sample: number;
};

export type SupportMetrics = {
  /** Agora (não segue o período): tickets não encerrados e não resolvidos. */
  openNow: number;
  /** Agora: desses, os com SLA estourado (1ª resposta ou solução). */
  breachedNow: number;
  /** No período: tickets abertos (contagem exata). */
  opened: number;
  /** No período: dos abertos, quantos a IA abriu. */
  openedByAi: number;
  /** No período: tickets resolvidos (contagem exata). */
  resolved: number;
  /** Abertos no período: abertura → 1ª resposta do analista. */
  firstResponse: MedianMetric;
  /** Resolvidos no período: abertura → resolução, tempo corrido. */
  resolution: MedianMetric;
  /** No período: reaberturas (saídas de "resolvido" para atendimento). */
  reopened: number;
  daily: DailyPoint[];
  /**
   * Mais tickets que o teto da leitura: as contagens continuam exatas (vêm do
   * `count`), mas medianas, IA e gráfico saem de uma amostra. A tela avisa.
   */
  partial: boolean;
};

export type SupportMetricsResult =
  | { failed: true; range: MetricRange }
  | ({ failed: false; range: MetricRange } & SupportMetrics);

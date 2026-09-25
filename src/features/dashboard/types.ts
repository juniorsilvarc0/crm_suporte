import type { Lead } from "@/features/leads/types";

export type PeriodFilter = {
  from?: string;
  to?: string;
};

// Valor atual + variação % vs período anterior (null quando não há base de comparação).
export type Trend = {
  value: number;
  delta: number | null;
};

export type DailyPoint = {
  date: string; // ISO (dia)
  leads: number;
  receita: number;
};

export type SourceRow = {
  key: string;
  label: string;
  color: string;
  leads: number;
  vendas: number;
  receita: number;
};

export type StateRow = {
  uf: string;
  leads: number;
  vendas: number;
  receita: number;
};

export type WhereBreakdown = {
  converted: number;
  inStage: number;
  noContact: number;
  lost: number;
  total: number;
  avgConversionDays: number | null;
};

// Recuperação de leads pela régua de follow-up do agente. Contagem por lead
// DISTINTO (um lead com vários toques conta 1). Denominador = leads com
// follow-up enviado no período.
export type RecoveryBreakdown = {
  sent: number; // leads distintos com follow-up enviado
  replied: number; // leads distintos que responderam
  recovered: number; // leads distintos recuperados
  rate: number; // recovered / sent * 100
};

// Quem agendou (comissionamento). Agrega agendamentos por autor
// (created_by_user_id -> nome via app_users), respeitando o período do
// dashboard por scheduled_at. Agendamentos sem autor contam como "IA".
export type SchedulerRow = {
  userId: string | null; // null = IA / não atribuído
  name: string; // nome do app_user, ou "IA / não atribuído"
  color: string; // nome da paleta (ex.: "violet"), p/ getColorStyle
  total: number; // agendamentos no período (por scheduled_at)
  compareceu: number; // subconjunto com status === "compareceu"
};

export type FunnelBreakdown = {
  novas: number;
  emEtapa: number;
  vendidas: number;
  perdidas: number;
};

export type WeekdaySales = {
  weekday: number; // 1=Seg ... 7=Dom (ordem de exibição)
  label: string;
  count: number;
};

export type LtvSummary = {
  clients: number;
  repurchaseRate: number; // %
  repurchaseRevenue: number;
  avgLtv: number;
  firstPurchaseRevenue: number;
  firstPurchaseShare: number; // %
  repurchaseShare: number; // %
  lifecycle: { first: number; loyal: number; champion: number; total: number };
};

export type DashboardKpis = {
  totalLeads: Trend;
  receita: Trend;
  conversao: Trend; // %
  ticketMedio: Trend;
  vendas: number;
  leadsHoje: number;
  receitaHoje: number;
};

export type DashboardData = {
  period: { label: string; hasComparison: boolean };
  banner: { leadsToday: number; awaitingContact: number };
  kpis: DashboardKpis;
  /**
   * Rótulos das etapas marcadas como conversão em Configurar funil. A taxa de
   * conversão é configurável, então a tela precisa dizer o que está contando —
   * senão o número não dá para conferir.
   */
  conversionStages: string[];
  pipeline: { awaiting: number; inStage: number };
  daily: DailyPoint[];
  where: WhereBreakdown;
  recovery: RecoveryBreakdown;
  funnel: FunnelBreakdown;
  salesByWeekday: WeekdaySales[];
  ltv: LtvSummary;
  bySource: SourceRow[];
  byState: StateRow[];
  schedulers: SchedulerRow[];
  recentLeads: Lead[];
};

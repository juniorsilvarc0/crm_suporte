import { getBoardColumns } from "@/features/board/queries/get-board-columns";
import {
  classifyLead,
  conversionStageLabels,
} from "@/features/dashboard/lib/lead-classification";
import { ufFromPhone } from "@/lib/formatters/location";
import { getPeriodRange, type DateRange } from "@/features/dashboard/lib/period";
import type {
  DailyPoint,
  DashboardData,
  LtvSummary,
  RecoveryBreakdown,
  SchedulerRow,
  SourceRow,
  StateRow,
  WeekdaySales,
} from "@/features/dashboard/types";
import { getLeads } from "@/features/leads/queries/get-leads";
import { leadSourceLabel } from "@/features/leads/schemas/status";
import type { Lead } from "@/features/leads/types";
import { getAppUsers } from "@/features/settings/queries/get-app-users";
import type { AppointmentStatus, LeadSource } from "@/lib/supabase/types";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

// Cor (nome da paleta) por origem — ordem categórica fixa.
const SOURCE_COLOR: Record<string, string> = {
  whatsapp: "emerald",
  agencia: "violet",
  anuncio: "amber",
  indicacao: "blue",
  particular: "cyan",
  importado: "slate",
  outro: "gray",
};

type ContractRow = {
  id: string;
  lead_id: string | null;
  total_amount: number;
  discount: number | null;
  status: string;
  created_at: string;
};

const PAGE = 1000;

type AppointmentRow = {
  id: string;
  created_by_user_id: string | null;
  created_at: string;
  status: AppointmentStatus;
};

// Paleta categórica fixa (classes estáticas via colorStyle) para diferenciar
// autores nas barras. IA/não atribuído usa "slate" à parte.
const SCHEDULER_COLORS = [
  "violet",
  "blue",
  "emerald",
  "amber",
  "cyan",
  "rose",
  "indigo",
  "teal",
  "orange",
  "pink",
];

type FollowupRow = {
  id: string;
  lead_id: string | null;
  sent_at: string | null;
  replied: boolean;
  recovered: boolean;
};

// Follow-ups efetivamente enviados pelo agente (a régua de recuperação). Só
// precisamos das colunas de agregação; paginado como os contratos.
async function fetchFollowups(): Promise<FollowupRow[]> {
  if (!hasSupabaseServerEnv()) return [];
  try {
    const supabase = createSupabaseServerClient();
    const rows: FollowupRow[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("followups")
        .select("id, lead_id, sent_at, replied, recovered")
        .eq("status", "enviado")
        .order("sent_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) {
        console.error("dashboard fetchFollowups", error.message);
        break;
      }
      const batch = (data ?? []) as FollowupRow[];
      rows.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
    return rows;
  } catch (error) {
    console.error("dashboard fetchFollowups threw", error);
    return [];
  }
}

async function fetchContracts(): Promise<ContractRow[]> {
  if (!hasSupabaseServerEnv()) return [];
  try {
    const supabase = createSupabaseServerClient();
    const rows: ContractRow[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("contracts")
        .select("id, lead_id, total_amount, discount, status, created_at")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) {
        console.error("dashboard fetchContracts", error.message);
        break;
      }
      const batch = (data ?? []) as ContractRow[];
      rows.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
    return rows;
  } catch (error) {
    console.error("dashboard fetchContracts threw", error);
    return [];
  }
}

// Agendamentos para o relatório "quem agendou". Só as colunas de agregação;
// paginado como os contratos. O período é aplicado depois por created_at
// (crédito pelo ATO de agendar — inclui agendamentos para datas futuras).
async function fetchAppointments(): Promise<AppointmentRow[]> {
  if (!hasSupabaseServerEnv()) return [];
  try {
    const supabase = createSupabaseServerClient();
    const rows: AppointmentRow[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("appointments")
        .select("id, created_by_user_id, created_at, status")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) {
        console.error("dashboard fetchAppointments", error.message);
        break;
      }
      const batch = (data ?? []) as AppointmentRow[];
      rows.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
    return rows;
  } catch (error) {
    console.error("dashboard fetchAppointments threw", error);
    return [];
  }
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

// Valor líquido faturado do contrato (total - desconto), nunca negativo.
function netOf(c: ContractRow): number {
  return Math.max(0, Number(c.total_amount ?? 0) - Number(c.discount ?? 0));
}

function inRange(iso: string | null, range: DateRange | null): boolean {
  if (!iso) return false;
  if (!range) return true; // "all" = base inteira
  const t = new Date(iso).getTime();
  return t >= range.from.getTime() && t < range.to.getTime();
}

const WD_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export async function getDashboardData(period?: string): Promise<DashboardData> {
  const [allLeads, columns, contracts, followupsSent, appointments, appUsers] =
    await Promise.all([
      getLeads(),
      getBoardColumns(),
      fetchContracts(),
      fetchFollowups(),
      fetchAppointments(),
      getAppUsers(),
    ]);
  const range = getPeriodRange(period);

  // Conversão é configurável por coluna (Configurar funil → "Contar como
  // conversão"): nesta clínica o marco é `compareceu`, que é etapa ABERTA.
  // `stage_type` continua respondendo outra pergunta — se a etapa fecha o card.
  const bucketOf = (status: string) => classifyLead(status, columns);
  const isWon = (s: string) => bucketOf(s) === "converted";
  const isLost = (s: string) => bucketOf(s) === "lost";
  const isNew = (s: string) => bucketOf(s) === "noContact";
  const isInStage = (s: string) => bucketOf(s) === "inStage";

  const validContracts = contracts.filter((c) => c.status !== "cancelado");
  const leadById = new Map(allLeads.map((l) => [l.id, l]));

  const curLeads = allLeads.filter((l) => inRange(l.created_at, range.current));
  const prevLeads = range.previous
    ? allLeads.filter((l) => inRange(l.created_at, range.previous))
    : [];
  const curContracts = validContracts.filter((c) => inRange(c.created_at, range.current));
  const prevContracts = range.previous
    ? validContracts.filter((c) => inRange(c.created_at, range.previous))
    : [];

  const delta = (cur: number, prev: number): number | null => {
    if (!range.previous) return null;
    if (prev === 0) return cur > 0 ? 100 : 0;
    return ((cur - prev) / prev) * 100;
  };

  // KPIs (atual)
  const totalLeads = curLeads.length;
  const receita = sum(curContracts.map(netOf));
  const vendas = curContracts.length;
  const convertidos = curLeads.filter((l) => isWon(l.status)).length;
  const conversao = totalLeads ? (convertidos / totalLeads) * 100 : 0;
  const ticket = vendas ? receita / vendas : 0;

  // KPIs (anterior)
  const prevTotal = prevLeads.length;
  const prevReceita = sum(prevContracts.map(netOf));
  const prevVendas = prevContracts.length;
  const prevConv = prevTotal
    ? (prevLeads.filter((l) => isWon(l.status)).length / prevTotal) * 100
    : 0;
  const prevTicket = prevVendas ? prevReceita / prevVendas : 0;

  // Hoje
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const isToday = (iso: string | null) =>
    iso != null && new Date(iso).getTime() >= midnight.getTime();
  const leadsHoje = allLeads.filter((l) => isToday(l.created_at)).length;
  const receitaHoje = sum(
    validContracts.filter((c) => isToday(c.created_at)).map(netOf)
  );

  // Pipeline atual (base inteira, tempo real)
  const awaitingContact = allLeads.filter((l) => isNew(l.status)).length;
  const inStageNow = allLeads.filter((l) => isInStage(l.status)).length;

  // Onde estão hoje (leads do período)
  const converted = convertidos;
  const inStage = curLeads.filter((l) => isInStage(l.status)).length;
  const noContact = curLeads.filter((l) => isNew(l.status)).length;
  const lost = curLeads.filter((l) => isLost(l.status)).length;
  const convDays = curLeads
    .filter((l) => isWon(l.status) && l.cliente_at)
    .map(
      (l) =>
        (new Date(l.cliente_at as string).getTime() -
          new Date(l.created_at).getTime()) /
        86_400_000
    )
    .filter((d) => d >= 0);
  const avgConversionDays = convDays.length ? sum(convDays) / convDays.length : null;

  return {
    period: { label: range.label, hasComparison: range.previous != null },
    banner: { leadsToday: leadsHoje, awaitingContact },
    conversionStages: conversionStageLabels(columns),
    kpis: {
      totalLeads: { value: totalLeads, delta: delta(totalLeads, prevTotal) },
      receita: { value: receita, delta: delta(receita, prevReceita) },
      conversao: { value: conversao, delta: delta(conversao, prevConv) },
      ticketMedio: { value: ticket, delta: delta(ticket, prevTicket) },
      vendas,
      leadsHoje,
      receitaHoje,
    },
    pipeline: { awaiting: awaitingContact, inStage: inStageNow },
    daily: buildDaily(allLeads, validContracts, range),
    where: { converted, inStage, noContact, lost, total: totalLeads, avgConversionDays },
    recovery: buildRecovery(followupsSent, range),
    funnel: { novas: noContact, emEtapa: inStage, vendidas: converted, perdidas: lost },
    salesByWeekday: buildWeekday(curContracts),
    ltv: buildLtv(validContracts),
    bySource: buildBySource(curLeads, curContracts, leadById),
    byState: buildByState(curLeads, curContracts, leadById),
    schedulers: buildSchedulers(appointments, appUsers, range),
    recentLeads: allLeads.slice(0, 6),
  };
}

function dayKey(iso: string | Date): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildDaily(
  allLeads: Lead[],
  contracts: ContractRow[],
  range: ReturnType<typeof getPeriodRange>
): DailyPoint[] {
  const end = range.current?.to ?? new Date();
  const start = range.current?.from
    ? new Date(range.current.from)
    : new Date(end.getTime() - 29 * 86_400_000);

  const map = new Map<string, { leads: number; receita: number }>();
  const order: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cursor <= end) {
    const key = dayKey(cursor);
    map.set(key, { leads: 0, receita: 0 });
    order.push(key);
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const l of allLeads) {
    const b = map.get(dayKey(l.created_at));
    if (b) b.leads += 1;
  }
  for (const c of contracts) {
    const b = map.get(dayKey(c.created_at));
    if (b) b.receita += netOf(c);
  }

  return order.map((key) => ({
    date: key,
    ...(map.get(key) as { leads: number; receita: number }),
  }));
}

// Taxa de recuperação = leads recuperados / leads com follow-up enviado, por
// lead DISTINTO e dentro do período (por sent_at). Follow-ups sem lead_id
// (telefone não casado) ficam de fora — é recuperação de leads.
function buildRecovery(
  followups: FollowupRow[],
  range: ReturnType<typeof getPeriodRange>
): RecoveryBreakdown {
  const sent = new Set<string>();
  const replied = new Set<string>();
  const recovered = new Set<string>();
  for (const f of followups) {
    if (!inRange(f.sent_at, range.current) || !f.lead_id) continue;
    sent.add(f.lead_id);
    if (f.replied) replied.add(f.lead_id);
    if (f.recovered) recovered.add(f.lead_id);
  }
  return {
    sent: sent.size,
    replied: replied.size,
    recovered: recovered.size,
    rate: sent.size ? (recovered.size / sent.size) * 100 : 0,
  };
}

function buildWeekday(contracts: ContractRow[]): WeekdaySales[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const c of contracts) counts[new Date(c.created_at).getDay()] += 1;
  const order = [1, 2, 3, 4, 5, 6, 0]; // Seg → Dom
  return order.map((idx, i) => ({
    weekday: i + 1,
    label: WD_LABEL[idx],
    count: counts[idx],
  }));
}

function buildLtv(contracts: ContractRow[]): LtvSummary {
  const byLead = new Map<string, ContractRow[]>();
  for (const c of contracts) {
    if (!c.lead_id) continue;
    const arr = byLead.get(c.lead_id) ?? [];
    arr.push(c);
    byLead.set(c.lead_id, arr);
  }

  let clients = 0;
  let repurchasers = 0;
  let totalRevenue = 0;
  let firstRevenue = 0;
  let repurchaseRevenue = 0;
  let first = 0;
  let loyal = 0;
  let champion = 0;

  for (const arr of byLead.values()) {
    arr.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    clients += 1;
    const revenues = arr.map(netOf);
    totalRevenue += sum(revenues);
    firstRevenue += revenues[0] ?? 0;
    repurchaseRevenue += sum(revenues.slice(1));
    if (arr.length >= 2) repurchasers += 1;
    if (arr.length === 1) first += 1;
    else if (arr.length <= 3) loyal += 1;
    else champion += 1;
  }

  return {
    clients,
    repurchaseRate: clients ? (repurchasers / clients) * 100 : 0,
    repurchaseRevenue,
    avgLtv: clients ? totalRevenue / clients : 0,
    firstPurchaseRevenue: firstRevenue,
    firstPurchaseShare: totalRevenue ? (firstRevenue / totalRevenue) * 100 : 0,
    repurchaseShare: totalRevenue ? (repurchaseRevenue / totalRevenue) * 100 : 0,
    lifecycle: { first, loyal, champion, total: clients },
  };
}

function buildBySource(
  curLeads: Lead[],
  curContracts: ContractRow[],
  leadById: Map<string, Lead>
): SourceRow[] {
  const rows = new Map<string, { leads: number; vendas: number; receita: number }>();
  const ensure = (k: string) => {
    let r = rows.get(k);
    if (!r) {
      r = { leads: 0, vendas: 0, receita: 0 };
      rows.set(k, r);
    }
    return r;
  };

  for (const l of curLeads) ensure(l.source ?? "outro").leads += 1;
  for (const c of curContracts) {
    const l = c.lead_id ? leadById.get(c.lead_id) : undefined;
    const r = ensure(l?.source ?? "outro");
    r.vendas += 1;
    r.receita += netOf(c);
  }

  return [...rows.entries()]
    .map(([key, v]) => ({
      key,
      label: leadSourceLabel[key as LeadSource] ?? key,
      color: SOURCE_COLOR[key] ?? "gray",
      ...v,
    }))
    .sort((a, b) => b.leads - a.leads || b.receita - a.receita);
}

function buildByState(
  curLeads: Lead[],
  curContracts: ContractRow[],
  leadById: Map<string, Lead>
): StateRow[] {
  const rows = new Map<string, { leads: number; vendas: number; receita: number }>();
  const ensure = (k: string) => {
    let r = rows.get(k);
    if (!r) {
      r = { leads: 0, vendas: 0, receita: 0 };
      rows.set(k, r);
    }
    return r;
  };

  for (const l of curLeads) ensure(ufFromPhone(l.normalized_phone) ?? "—").leads += 1;
  for (const c of curContracts) {
    const l = c.lead_id ? leadById.get(c.lead_id) : undefined;
    const r = ensure(ufFromPhone(l?.normalized_phone) ?? "—");
    r.vendas += 1;
    r.receita += netOf(c);
  }

  return [...rows.entries()]
    .map(([uf, v]) => ({ uf, ...v }))
    .sort((a, b) => b.leads - a.leads || b.receita - a.receita);
}

// Quem agendou (comissão): agrega agendamentos por autor, filtrando pelo
// período por created_at (data em que foi agendado — crédito pelo ato de
// agendar). Sem autor (created_by_user_id null) = IA.
const IA_KEY = "__ia__";
function buildSchedulers(
  appts: AppointmentRow[],
  users: { id: string; name: string }[],
  range: ReturnType<typeof getPeriodRange>
): SchedulerRow[] {
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const rows = new Map<string, { total: number; compareceu: number }>();
  const ensure = (k: string) => {
    let r = rows.get(k);
    if (!r) {
      r = { total: 0, compareceu: 0 };
      rows.set(k, r);
    }
    return r;
  };

  for (const a of appts) {
    if (!inRange(a.created_at, range.current)) continue;
    const r = ensure(a.created_by_user_id ?? IA_KEY);
    r.total += 1;
    if (a.status === "compareceu") r.compareceu += 1;
  }

  // Cor estável por autor: índice na ordem de aparição (IA sempre "slate").
  let colorIdx = 0;
  const colorByKey = new Map<string, string>();

  return [...rows.entries()]
    .map(([key, v]) => {
      const isIa = key === IA_KEY;
      let color = "slate";
      if (!isIa) {
        color = colorByKey.get(key) ?? SCHEDULER_COLORS[colorIdx % SCHEDULER_COLORS.length];
        colorByKey.set(key, color);
        colorIdx += 1;
      }
      return {
        userId: isIa ? null : key,
        name: isIa ? "IA / não atribuído" : (nameById.get(key) ?? "Usuário removido"),
        color,
        ...v,
      };
    })
    .sort((a, b) => b.total - a.total || b.compareceu - a.compareceu);
}

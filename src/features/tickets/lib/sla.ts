import type { TicketSlaFields } from "@/features/tickets/types";
import { formatDuration } from "@/lib/formatters/relative-time";

// Selo de SLA do ticket (texto e tom). Repete a MESMA regra da view
// public.ticket_queue (migration 20260925120900, bloco 11), que filtra e ordena
// a lista: `breached`, `atRisk` e `nextDueAt` daqui são sla_breached,
// sla_at_risk e next_due_at de lá, então o filtro "risco" da lista mostra
// exatamente os selos em `warn`. Os casos de sla.test.ts espelham o T95 de
// supabase/tests/tickets.sql: mudou a view, mudam os dois.
//
// A regra (`now` é de quem chama; na tela, o do hook que começa no fetchedAt):
//   - 1ª resposta: relógio de parede, NÃO pausa. Vence em first_response_due_at
//     (`<=`) enquanto ninguém respondeu e o status não parou (`stopped`);
//   - solução: vence em resolution_due_at. Parada (pausa ou stopped), vale o
//     instante em que parou (sla_paused_at), não o de agora;
//   - risco: a partir de warn_pct do prazo, com nada vencido. O da solução só
//     com o relógio correndo;
//   - próximo prazo: a 1ª resposta enquanto pendente; senão a solução, se corre.
//
// Instantes comparados em MICROSSEGUNDOS, como o Postgres compara: o Date
// guarda milissegundos, e o prazo e a pausa no mesmo milissegundo inverteriam.
// Puro e neutro: a rota, a query e o client importam.

// ok/warn: correndo no prazo (warn ⇔ sla_at_risk); breached ⇔ sla_breached;
// paused: solução pausada no prazo; met/missed: resolvido ou fechado, solução no
// prazo ou fora; none: cancelado (e dado inválido, com rótulo vazio).
export type SlaTone = "ok" | "warn" | "breached" | "paused" | "met" | "missed" | "none";

export type SlaState = {
  tone: SlaTone;
  // "" só com instante inválido: a tela não mostra selo em vez de inventar um.
  label: string;
  firstResponseOverdue: boolean;
  resolutionOverdue: boolean;
  breached: boolean;
  atRisk: boolean;
  // O ISO cru do próprio ticket (first_response_due_at ou resolution_due_at);
  // nulo = nenhum relógio correndo para vencer.
  nextDueAt: string | null;
};

const FRACTION_RE = /\.(\d+)/;

// "2026-09-26T02:45:57.194405+00:00" (ISO do PostgREST, que omite a fração
// zerada e os zeros à direita) → microssegundos desde a época. A fração sai do
// próprio texto; o Date.parse lê só o resto, sem fração, que todo navegador
// entende. Inválido → NaN.
function toMicros(iso: string): number {
  const fraction = FRACTION_RE.exec(iso)?.[1] ?? "";
  const wholeMs = Date.parse(fraction ? iso.replace(FRACTION_RE, "") : iso);
  return wholeMs * 1000 + Number(fraction.slice(0, 6).padEnd(6, "0"));
}

// A janela de aviso da view: make_interval(secs => minutos * (100 - warn_pct) * 0.6).
function warnWindowMicros(minutes: number, warnPct: number): number {
  return minutes * (100 - warnPct) * 600_000;
}

// Duração para o rótulo; o piso em 0 cobre o relógio do navegador atrás do banco.
function duration(micros: number): string {
  return formatDuration(Math.max(0, micros) / 1000);
}

const UNKNOWN: SlaState = {
  tone: "none",
  label: "",
  firstResponseOverdue: false,
  resolutionOverdue: false,
  breached: false,
  atRisk: false,
  nextDueAt: null,
};

export function getSlaState(ticket: TicketSlaFields, now: Date): SlaState {
  const nowUs = now.getTime() * 1000;
  const firstDue = toMicros(ticket.first_response_due_at);
  const resolutionDue = toMicros(ticket.resolution_due_at);
  const pausedAt = ticket.sla_paused_at === null ? null : toMicros(ticket.sla_paused_at);
  if (![nowUs, firstDue, resolutionDue, pausedAt ?? 0].every(Number.isFinite)) return UNKNOWN;

  const stopped = ticket.sla_mode === "stopped";
  const running = ticket.sla_mode === "running";
  const firstPending = ticket.first_responded_at === null;
  // O resolution_overdue da view sem o "não parou": parado, é o "fora do prazo".
  const resolutionLate = resolutionDue <= (pausedAt ?? nowUs);

  const firstResponseOverdue = firstPending && !stopped && firstDue <= nowUs;
  const resolutionOverdue = !stopped && resolutionLate;
  const breached = firstResponseOverdue || resolutionOverdue;
  const atRisk =
    !breached &&
    !stopped &&
    ((firstPending &&
      nowUs >=
        firstDue - warnWindowMicros(ticket.sla_first_response_minutes, ticket.sla_warn_pct)) ||
      (running &&
        nowUs >=
          resolutionDue - warnWindowMicros(ticket.sla_resolution_minutes, ticket.sla_warn_pct)));
  const nextDueAt = stopped
    ? null
    : firstPending
      ? ticket.first_response_due_at
      : running
        ? ticket.resolution_due_at
        : null;

  const flags = { firstResponseOverdue, resolutionOverdue, breached, atRisk, nextDueAt };

  if (stopped) {
    if (ticket.status === "cancelado") return { ...flags, tone: "none", label: "Cancelado" };
    // Resolvido ou fechado: julga a SOLUÇÃO no instante em que o relógio parou
    // (vindo de aguardando_cliente, o da pausa). A 1ª resposta atrasada não
    // entra: na view ela também some assim que alguém responde.
    return resolutionLate
      ? { ...flags, tone: "missed", label: "Resolvido fora do prazo" }
      : { ...flags, tone: "met", label: "Resolvido no prazo" };
  }

  // A 1ª resposta vem antes: é o next_due_at enquanto pendente, e corre mesmo
  // com o ticket pausado (T95d).
  if (firstResponseOverdue) {
    return {
      ...flags,
      tone: "breached",
      label: `1ª resposta atrasada há ${duration(nowUs - firstDue)}`,
    };
  }
  if (resolutionOverdue) {
    const since = duration(nowUs - resolutionDue);
    return {
      ...flags,
      tone: "breached",
      label: running ? `Venceu há ${since}` : `Pausado · venceu há ${since}`,
    };
  }
  if (firstPending) {
    return {
      ...flags,
      tone: atRisk ? "warn" : "ok",
      label: `1ª resposta em ${duration(firstDue - nowUs)}`,
    };
  }
  if (running) {
    return {
      ...flags,
      tone: atRisk ? "warn" : "ok",
      label: `Vence em ${duration(resolutionDue - nowUs)}`,
    };
  }
  // Pausado no prazo: o que restava da solução quando o relógio parou.
  return {
    ...flags,
    tone: "paused",
    label: `Pausado · restavam ${duration(resolutionDue - (pausedAt ?? nowUs))}`,
  };
}

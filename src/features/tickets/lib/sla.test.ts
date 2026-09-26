import { describe, expect, it } from "vitest";

import { getSlaState, type SlaState } from "@/features/tickets/lib/sla";
import type { TicketSlaFields } from "@/features/tickets/types";

// Relógio fixo: nenhum teste depende da hora em que roda.
const NOW = new Date("2026-09-25T12:00:00.000Z");
const MINUTE = 60_000;

// Instante a `minutes` de NOW no formato do PostgREST (fração zerada omitida).
const at = (minutes: number) =>
  new Date(NOW.getTime() + minutes * MINUTE).toISOString().replace(/(?:\.000)?Z$/, "+00:00");

type Policy = { first: number; resolution: number; warnPct: number };
// A semente de sla_policies (migration 20260925120900, bloco 1.3).
const CRITICA: Policy = { first: 30, resolution: 240, warnPct: 80 };
const ALTA: Policy = { first: 60, resolution: 480, warnPct: 80 };
const MEDIA: Policy = { first: 240, resolution: 1440, warnPct: 80 };

// Ticket aberto há `openedMinutesAgo`, com os prazos do create_ticket
// (abertura + minutos) e o recuo do pg_temp.shift_ticket. Nasce em `novo`,
// correndo e sem 1ª resposta; `patch` faz o resto do caso.
function ticket(
  openedMinutesAgo: number,
  patch: Partial<TicketSlaFields> = {},
  policy: Policy = CRITICA,
): TicketSlaFields {
  return {
    status: "novo",
    sla_mode: "running",
    sla_first_response_minutes: policy.first,
    sla_resolution_minutes: policy.resolution,
    sla_warn_pct: policy.warnPct,
    first_response_due_at: at(-openedMinutesAgo + policy.first),
    resolution_due_at: at(-openedMinutesAgo + policy.resolution),
    first_responded_at: null,
    sla_paused_at: null,
    resolved_at: null,
    closed_at: null,
    ...patch,
  };
}

const CLEAR = {
  firstResponseOverdue: false,
  resolutionOverdue: false,
  breached: false,
  atRisk: false,
} as const;

// Mesmos cenários e limites do T95 de supabase/tests/tickets.sql (todos
// `critica`: 30 min / 240 min / aviso a 80%, menos o resolvido, em `media`).
// Cada `expect` confere as colunas que o T95 confere na view. O T95h
// (last_inbound_at) não é regra de SLA e fica só no SQL.
describe("getSlaState — espelho do T95", () => {
  it("T95a correndo e vencido: estourou, e a 1ª resposta é o próximo prazo", () => {
    const t = ticket(300); // shift de v_res + 60
    expect(getSlaState(t, NOW)).toEqual<SlaState>({
      firstResponseOverdue: true,
      resolutionOverdue: true,
      breached: true,
      atRisk: false,
      nextDueAt: t.first_response_due_at,
      tone: "breached",
      label: "1ª resposta atrasada há 4 horas",
    });
  });

  it("T95b pausado antes do prazo: não estourou, mesmo com o prazo já no passado", () => {
    const t = ticket(300, {
      status: "aguardando_cliente",
      sla_mode: "paused",
      first_responded_at: at(-299),
      sla_paused_at: at(-60 - 30), // resolution_due_at - 30 min
    });
    expect(t.resolution_due_at < at(0)).toBe(true);
    expect(getSlaState(t, NOW)).toEqual<SlaState>({
      ...CLEAR,
      nextDueAt: null,
      tone: "paused",
      label: "Pausado · restavam 30 min",
    });
  });

  it("T95c pausado depois do prazo: estourou", () => {
    const t = ticket(300, {
      status: "aguardando_cliente",
      sla_mode: "paused",
      first_responded_at: at(-299),
      sla_paused_at: at(-60 + 30), // resolution_due_at + 30 min
    });
    expect(getSlaState(t, NOW)).toEqual<SlaState>({
      ...CLEAR,
      resolutionOverdue: true,
      breached: true,
      nextDueAt: null,
      tone: "breached",
      label: "Pausado · venceu há 1 hora",
    });
  });

  it("T95d 1ª resposta vencida durante a pausa (a 1ª resposta não pausa)", () => {
    const t = ticket(60, {
      // shift de v_first + 30
      status: "aguardando_cliente",
      sla_mode: "paused",
      sla_paused_at: at(-60 + 10), // created_at + 10 min
    });
    expect(getSlaState(t, NOW)).toEqual<SlaState>({
      ...CLEAR,
      firstResponseOverdue: true,
      breached: true,
      nextDueAt: t.first_response_due_at,
      tone: "breached",
      label: "1ª resposta atrasada há 30 min",
    });
  });

  it("T95e risco a 85% do prazo", () => {
    const t = ticket(30 * 0.85);
    expect(getSlaState(t, NOW)).toEqual<SlaState>({
      ...CLEAR,
      atRisk: true,
      nextDueAt: t.first_response_due_at,
      tone: "warn",
      label: "1ª resposta em 4 min",
    });
  });

  it("T95f a 75% do prazo ainda sem risco (aviso a 80%)", () => {
    const t = ticket(30 * 0.75);
    expect(getSlaState(t, NOW)).toEqual<SlaState>({
      ...CLEAR,
      nextDueAt: t.first_response_due_at,
      tone: "ok",
      label: "1ª resposta em 7 min",
    });
  });

  it("T95g next_due_at nulo em resolvido", () => {
    // em_atendimento → resolvido na mesma transação da abertura.
    const t = ticket(
      0,
      { status: "resolvido", sla_mode: "stopped", sla_paused_at: at(0), resolved_at: at(0) },
      MEDIA,
    );
    expect(getSlaState(t, NOW)).toEqual<SlaState>({
      ...CLEAR,
      nextDueAt: null,
      tone: "met",
      label: "Resolvido no prazo",
    });
  });
});

describe("getSlaState — 1ª resposta pendente", () => {
  it("no prazo: ok", () => {
    expect(getSlaState(ticket(5), NOW)).toMatchObject({
      tone: "ok",
      label: "1ª resposta em 25 min",
    });
  });

  it("aviso começa EXATAMENTE em warn_pct (>= da view)", () => {
    // 80% de 30 min = 24 min: faltam 6 min.
    expect(getSlaState(ticket(24), NOW)).toMatchObject({
      atRisk: true,
      tone: "warn",
      label: "1ª resposta em 6 min",
    });
    const justBefore = new Date(NOW.getTime() - 1);
    expect(getSlaState(ticket(24), justBefore)).toMatchObject({ atRisk: false, tone: "ok" });
  });

  it("vence no instante exato do prazo (<= da view)", () => {
    const t = ticket(30);
    expect(getSlaState(t, NOW)).toMatchObject({
      firstResponseOverdue: true,
      breached: true,
      atRisk: false,
      tone: "breached",
      label: "1ª resposta atrasada há menos de 1 min",
    });
    expect(getSlaState(t, new Date(NOW.getTime() - 1))).toMatchObject({
      firstResponseOverdue: false,
      tone: "warn",
      label: "1ª resposta em menos de 1 min",
    });
  });

  it("com o ticket pausado, a 1ª resposta continua correndo e entra em aviso", () => {
    const paused = { status: "aguardando_cliente", sla_mode: "paused" } as const;
    const early = ticket(10, { ...paused, sla_paused_at: at(-5) });
    expect(getSlaState(early, NOW)).toEqual<SlaState>({
      ...CLEAR,
      nextDueAt: early.first_response_due_at,
      tone: "ok",
      label: "1ª resposta em 20 min",
    });
    expect(getSlaState(ticket(26, { ...paused, sla_paused_at: at(-20) }), NOW)).toMatchObject({
      atRisk: true,
      tone: "warn",
      label: "1ª resposta em 4 min",
    });
  });
});

describe("getSlaState — solução", () => {
  const answered = { status: "em_atendimento", first_responded_at: at(-150) } as const;

  it("correndo no prazo: 'Vence em 2 horas' (alta aberta há 6 horas)", () => {
    const t = ticket(360, answered, ALTA);
    expect(getSlaState(t, NOW)).toEqual<SlaState>({
      ...CLEAR,
      nextDueAt: t.resolution_due_at,
      tone: "ok",
      label: "Vence em 2 horas",
    });
  });

  it("correndo em aviso: faltando menos de 20% do prazo", () => {
    // 80% de 240 min = 192 min: aberto há 200, faltam 40.
    expect(getSlaState(ticket(200, answered), NOW)).toMatchObject({
      atRisk: true,
      tone: "warn",
      label: "Vence em 40 min",
    });
    // Exatamente em 80% (>= da view) e 1 minuto antes.
    expect(getSlaState(ticket(192, answered), NOW)).toMatchObject({
      atRisk: true,
      label: "Vence em 48 min",
    });
    expect(getSlaState(ticket(191, answered), NOW)).toMatchObject({ atRisk: false, tone: "ok" });
  });

  it("correndo e vencida: 'Venceu há 3 horas'", () => {
    const t = ticket(420, answered);
    expect(getSlaState(t, NOW)).toEqual<SlaState>({
      ...CLEAR,
      resolutionOverdue: true,
      breached: true,
      nextDueAt: t.resolution_due_at,
      tone: "breached",
      label: "Venceu há 3 horas",
    });
  });

  it("pausada perto do prazo não entra em aviso (o risco da solução só corre com o relógio)", () => {
    const t = ticket(235, {
      status: "aguardando_cliente",
      sla_mode: "paused",
      first_responded_at: at(-230),
      sla_paused_at: at(-1),
    });
    expect(getSlaState(t, NOW)).toEqual<SlaState>({
      ...CLEAR,
      nextDueAt: null,
      tone: "paused",
      label: "Pausado · restavam 6 min",
    });
  });
});

describe("getSlaState — parado", () => {
  const stopped = { sla_mode: "stopped", first_responded_at: at(-290) } as const;

  it("resolvido depois do prazo: fora do prazo, sem estouro na lista (a view para)", () => {
    const t = ticket(300, {
      ...stopped,
      status: "resolvido",
      sla_paused_at: at(-10),
      resolved_at: at(-10),
    });
    expect(getSlaState(t, NOW)).toEqual<SlaState>({
      ...CLEAR,
      nextDueAt: null,
      tone: "missed",
      label: "Resolvido fora do prazo",
    });
  });

  it("vindo de aguardando_cliente, vale o instante da pausa, não o da resolução", () => {
    // Pausou 30 min antes do prazo e resolveu 50 min depois dele.
    const t = ticket(300, {
      ...stopped,
      status: "resolvido",
      sla_paused_at: at(-90),
      resolved_at: at(-10),
    });
    expect(getSlaState(t, NOW)).toMatchObject({ tone: "met", label: "Resolvido no prazo" });
  });

  it("fechado usa o mesmo rótulo do resolvido", () => {
    const base = { ...stopped, status: "fechado", resolved_at: at(-100), closed_at: at(-5) } as const;
    expect(getSlaState(ticket(300, { ...base, sla_paused_at: at(-100) }), NOW)).toMatchObject({
      tone: "met",
      label: "Resolvido no prazo",
      nextDueAt: null,
    });
    expect(getSlaState(ticket(300, { ...base, sla_paused_at: at(-60) }), NOW)).toMatchObject({
      tone: "missed",
      label: "Resolvido fora do prazo",
    });
  });

  it("cancelado não tem prazo, mesmo com os dois vencidos", () => {
    const t = ticket(300, {
      status: "cancelado",
      sla_mode: "stopped",
      sla_paused_at: at(-1),
      closed_at: at(-1),
    });
    expect(getSlaState(t, NOW)).toEqual<SlaState>({
      ...CLEAR,
      nextDueAt: null,
      tone: "none",
      label: "Cancelado",
    });
  });
});

describe("getSlaState — instantes do PostgREST", () => {
  const paused = {
    status: "aguardando_cliente",
    sla_mode: "paused",
    first_responded_at: at(-200),
    resolution_due_at: "2026-09-25T11:00:00.0005+00:00",
  } as const;

  it("compara em microssegundos: prazo e pausa no mesmo milissegundo", () => {
    // Pausou 100 µs antes do prazo: no prazo (o Date leria os dois iguais e
    // daria "venceu").
    expect(
      getSlaState(ticket(300, { ...paused, sla_paused_at: "2026-09-25T11:00:00.0004+00:00" }), NOW),
    ).toMatchObject({ resolutionOverdue: false, tone: "paused" });
    // Pausou no exato microssegundo do prazo: venceu (<= da view).
    expect(
      getSlaState(ticket(300, { ...paused, sla_paused_at: "2026-09-25T11:00:00.0005+00:00" }), NOW),
    ).toMatchObject({ resolutionOverdue: true, tone: "breached" });
  });

  it("compara pelo valor da fração, não pelo tamanho do texto", () => {
    // ".5" é 500000 µs e ".49", 490000: o Postgres corta os zeros, e ler a
    // fração como inteiro sem completar as 6 casas inverteria o par (5 < 49).
    const due = "2026-09-25T11:00:00.5+00:00";
    const pausedAt = "2026-09-25T11:00:00.49+00:00";
    expect(
      getSlaState(ticket(300, { ...paused, resolution_due_at: due, sla_paused_at: pausedAt }), NOW),
    ).toMatchObject({ resolutionOverdue: false, tone: "paused" });
    expect(
      getSlaState(ticket(300, { ...paused, resolution_due_at: pausedAt, sla_paused_at: due }), NOW),
    ).toMatchObject({ resolutionOverdue: true, tone: "breached" });
  });

  it("1 µs depois de agora ainda não venceu", () => {
    const t = ticket(30, { first_response_due_at: "2026-09-25T12:00:00.000001+00:00" });
    expect(getSlaState(t, NOW)).toMatchObject({
      firstResponseOverdue: false,
      label: "1ª resposta em menos de 1 min",
    });
  });

  it("aceita o formato com Z e fração de 6 dígitos", () => {
    const t = ticket(0, { first_response_due_at: "2026-09-25T12:25:00.123456Z" });
    expect(getSlaState(t, NOW)).toMatchObject({ tone: "ok", label: "1ª resposta em 25 min" });
  });

  it("instante inválido: sem selo, em vez de inventar um prazo", () => {
    const invalid = ticket(10, { resolution_due_at: "amanhã" });
    expect(getSlaState(invalid, NOW)).toEqual<SlaState>({
      ...CLEAR,
      nextDueAt: null,
      tone: "none",
      label: "",
    });
    expect(getSlaState(ticket(10), new Date(Number.NaN))).toMatchObject({ label: "" });
  });
});

import { describe, expect, it } from "vitest";

import {
  agendaHref,
  agendaRange,
  agendaStepHrefs,
  agendaTitle,
  agendaViewHref,
  appointmentTimeRange,
  groupAppointmentsByDay,
  parseAgendaParams,
  startMinutesOf,
  type AgendaPeriod,
} from "@/features/appointments/lib/agenda-view";
import type { AppointmentListItem } from "@/features/appointments/types";

const TODAY = "2026-10-09";

const period = (overrides: Partial<AgendaPeriod> = {}): AgendaPeriod => ({
  view: "mes",
  monthKey: "2026-10",
  dateKey: TODAY,
  ...overrides,
});

describe("parseAgendaParams", () => {
  it("abre o mês corrente em hoje, sem nada na URL", () => {
    expect(parseAgendaParams({}, TODAY)).toEqual({ view: "mes", monthKey: "2026-10", dateKey: TODAY });
  });

  it("outro mês sem dia começa no dia 1º (é dele que a semana parte)", () => {
    expect(parseAgendaParams({ view: "lista", month: "2026-12" }, TODAY)).toEqual({
      view: "lista",
      monthKey: "2026-12",
      dateKey: "2026-12-01",
    });
  });

  it("semana e dia seguem o dia da URL, e o mês sai dele", () => {
    expect(parseAgendaParams({ view: "semana", date: "2026-11-20" }, TODAY)).toEqual({
      view: "semana",
      monthKey: "2026-11",
      dateKey: "2026-11-20",
    });
  });

  it("valor estranho vira o padrão, não erro", () => {
    expect(parseAgendaParams({ view: "ano", month: "13-2026", date: "2026-02-31" }, TODAY)).toEqual({
      view: "mes",
      monthKey: "2026-10",
      dateKey: TODAY,
    });
  });
});

describe("agendaRange", () => {
  it("mês pega a grade inteira, do domingo da 1ª semana ao sábado da última", () => {
    expect(agendaRange(period())).toEqual({
      startIso: "2026-09-27T00:00:00-03:00",
      endIso: "2026-11-01T00:00:00-03:00",
    });
  });

  it("lista pega só o mês", () => {
    expect(agendaRange(period({ view: "lista" }))).toEqual({
      startIso: "2026-10-01T00:00:00-03:00",
      endIso: "2026-11-01T00:00:00-03:00",
    });
  });

  it("semana vai de domingo a domingo; dia, de meia-noite a meia-noite", () => {
    expect(agendaRange(period({ view: "semana" }))).toEqual({
      startIso: "2026-10-04T00:00:00-03:00",
      endIso: "2026-10-11T00:00:00-03:00",
    });
    expect(agendaRange(period({ view: "dia" }))).toEqual({
      startIso: "2026-10-09T00:00:00-03:00",
      endIso: "2026-10-10T00:00:00-03:00",
    });
  });
});

describe("links", () => {
  it("semana e dia levam o dia; mês e lista, o mês", () => {
    expect(agendaHref("dia", { dateKey: TODAY })).toBe("/app/agendamentos?view=dia&date=2026-10-09");
    expect(agendaHref("lista", { monthKey: "2026-10" })).toBe("/app/agendamentos?view=lista&month=2026-10");
  });

  it("anterior e próximo andam um mês no mês, sete dias na semana e um no dia", () => {
    expect(agendaStepHrefs(period(), TODAY)).toEqual({
      today: "/app/agendamentos?view=mes&month=2026-10",
      previous: "/app/agendamentos?view=mes&month=2026-09",
      next: "/app/agendamentos?view=mes&month=2026-11",
    });
    expect(agendaStepHrefs(period({ view: "semana" }), TODAY).next).toBe(
      "/app/agendamentos?view=semana&date=2026-10-16"
    );
    expect(agendaStepHrefs(period({ view: "dia", dateKey: "2026-11-01" }), TODAY)).toEqual({
      today: "/app/agendamentos?view=dia&date=2026-10-09",
      previous: "/app/agendamentos?view=dia&date=2026-10-31",
      next: "/app/agendamentos?view=dia&date=2026-11-02",
    });
  });

  it("trocar de aba mantém o período", () => {
    const novembro = period({ view: "semana", monthKey: "2026-11", dateKey: "2026-11-20" });
    expect(agendaViewHref("mes", novembro)).toBe("/app/agendamentos?view=mes&month=2026-11");
    expect(agendaViewHref("dia", novembro)).toBe("/app/agendamentos?view=dia&date=2026-11-20");
  });
});

describe("agendaTitle", () => {
  it("escreve o período como a faixa mostra", () => {
    expect(agendaTitle(period())).toBe("Outubro de 2026");
    expect(agendaTitle(period({ view: "semana" }))).toBe("04–10 de out");
    expect(agendaTitle(period({ view: "dia" }))).toBe("Sexta-feira, 09 de outubro");
  });
});

describe("horários", () => {
  it("lê o começo no fuso do app, não no do navegador", () => {
    // 13:30 em UTC = 10:30 em São Paulo.
    expect(startMinutesOf("2026-10-09T13:30:00+00:00")).toBe(630);
  });

  it("mostra começo e fim quando há duração", () => {
    expect(appointmentTimeRange({ scheduled_at: "2026-10-09T13:30:00+00:00", duration_min: 90 })).toBe(
      "10:30–12:00"
    );
    expect(appointmentTimeRange({ scheduled_at: "2026-10-09T13:30:00+00:00", duration_min: null })).toBe("10:30");
  });

  it("agrupa pelo dia do app: 01:00 UTC ainda é o dia anterior em São Paulo", () => {
    const at = (id: string, scheduled_at: string) => ({ id, scheduled_at }) as AppointmentListItem;
    const byDay = groupAppointmentsByDay(
      [at("a", "2026-10-09T12:00:00+00:00"), at("b", "2026-10-10T01:00:00+00:00"), at("c", "2027-01-01T12:00:00+00:00")],
      ["2026-10-09", "2026-10-10"]
    );

    expect(byDay.get("2026-10-09")?.map((item) => item.id)).toEqual(["a", "b"]);
    expect(byDay.get("2026-10-10")).toEqual([]);
  });
});

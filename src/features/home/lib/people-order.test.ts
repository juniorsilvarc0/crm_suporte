import { describe, expect, it } from "vitest";

import { comparePeopleForHome, isBirthdayToday } from "@/features/home/lib/people-order";
import type { HomePerson } from "@/features/home/types";

const TODAY = "2026-08-18";

function person(overrides: Partial<HomePerson> & { id: string }): HomePerson {
  return {
    name: overrides.id,
    phone: null,
    status: "cliente",
    nextAppointmentAt: null,
    lastMessageAt: null,
    birthDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function order(people: HomePerson[]): string[] {
  return [...people].sort(comparePeopleForHome(TODAY)).map((item) => item.id);
}

describe("isBirthdayToday", () => {
  it("compara só dia e mês, ignorando o ano de nascimento", () => {
    expect(isBirthdayToday("2018-08-18", TODAY)).toBe(true);
    expect(isBirthdayToday("1974-08-18", TODAY)).toBe(true);
  });

  it("não confunde dia com mês", () => {
    // 08/18 vs 18/08: se a comparação virasse os campos, isto passaria.
    expect(isBirthdayToday("2018-18-08", TODAY)).toBe(false);
  });

  it("é falso sem data de nascimento", () => {
    expect(isBirthdayToday(null, TODAY)).toBe(false);
    expect(isBirthdayToday("", TODAY)).toBe(false);
  });

  it("nascido em 29/02 só aniversaria em ano bissexto (decisão, não esquecimento)", () => {
    expect(isBirthdayToday("2016-02-29", "2028-02-29")).toBe(true);
    expect(isBirthdayToday("2016-02-29", "2027-02-28")).toBe(false);
    expect(isBirthdayToday("2016-02-29", "2027-03-01")).toBe(false);
  });
});

describe("comparePeopleForHome", () => {
  it("põe o aniversariante do dia na frente de quem tem sessão daqui a pouco", () => {
    const people = [
      person({ id: "sessao-ja", nextAppointmentAt: "2026-08-18T12:00:00Z" }),
      person({ id: "aniversariante", birthDate: "2015-08-18" }),
    ];
    expect(order(people)).toEqual(["aniversariante", "sessao-ja"]);
  });

  it("ordena por sessão mais próxima: hoje antes de amanhã, e por hora dentro do dia", () => {
    const people = [
      person({ id: "depois-de-amanha", nextAppointmentAt: "2026-08-20T13:00:00Z" }),
      person({ id: "hoje-tarde", nextAppointmentAt: "2026-08-18T20:00:00Z" }),
      person({ id: "amanha", nextAppointmentAt: "2026-08-19T13:00:00Z" }),
      person({ id: "hoje-cedo", nextAppointmentAt: "2026-08-18T13:00:00Z" }),
    ];
    expect(order(people)).toEqual([
      "hoje-cedo",
      "hoje-tarde",
      "amanha",
      "depois-de-amanha",
    ]);
  });

  it("empurra para o fim quem não tem sessão marcada", () => {
    const people = [
      person({ id: "sem-sessao" }),
      person({ id: "com-sessao", nextAppointmentAt: "2026-08-25T13:00:00Z" }),
    ];
    expect(order(people)).toEqual(["com-sessao", "sem-sessao"]);
  });

  it("preserva a ordem do banco entre os que não têm sessão", () => {
    const people = [person({ id: "primeiro" }), person({ id: "segundo" })];
    expect(order(people)).toEqual(["primeiro", "segundo"]);
  });

  it("trata data ilegível como quem não tem sessão, sem embaralhar o resto", () => {
    const people = [
      person({ id: "quebrado", nextAppointmentAt: "nao-e-uma-data" }),
      person({ id: "valido", nextAppointmentAt: "2026-08-25T13:00:00Z" }),
    ];
    expect(order(people)).toEqual(["valido", "quebrado"]);
  });

  it("desempata dois aniversariantes pela sessão mais próxima", () => {
    const people = [
      person({ id: "tarde", birthDate: "2012-08-18", nextAppointmentAt: "2026-08-18T21:00:00Z" }),
      person({ id: "cedo", birthDate: "2009-08-18", nextAppointmentAt: "2026-08-18T12:00:00Z" }),
    ];
    expect(order(people)).toEqual(["cedo", "tarde"]);
  });
});

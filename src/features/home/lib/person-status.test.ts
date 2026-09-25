import { describe, expect, it } from "vitest";

import { getPersonSignal } from "@/features/home/lib/person-status";
import type { HomePerson } from "@/features/home/types";

// 18/08/2026 às 09:00 em São Paulo (-03:00). O fuso importa: `getPersonSignal`
// converte para o fuso do app antes de comparar dia e mês.
const NOW = new Date("2026-08-18T12:00:00Z");

function person(overrides: Partial<HomePerson>): HomePerson {
  return {
    id: "p1",
    name: "Fulano",
    phone: null,
    status: "cliente",
    nextAppointmentAt: null,
    lastMessageAt: null,
    birthDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("getPersonSignal", () => {
  it("anuncia o aniversário com a idade que a pessoa completa hoje", () => {
    const signal = getPersonSignal(person({ birthDate: "2018-08-18" }), NOW);
    expect(signal.tone).toBe("birthday");
    expect(signal.label).toBe("Aniversário hoje · 8 anos");
  });

  it("mantém a sessão do dia na mesma linha do aniversário", () => {
    const signal = getPersonSignal(
      person({ birthDate: "2018-08-18", nextAppointmentAt: "2026-08-18T12:40:00Z" }),
      NOW
    );
    expect(signal.label).toBe("Aniversário hoje · 8 anos · sessão em 40 minutos");
  });

  it("não confunde o aniversário de amanhã com o de hoje", () => {
    const signal = getPersonSignal(
      person({ birthDate: "2018-08-19", nextAppointmentAt: "2026-08-20T13:00:00Z" }),
      NOW
    );
    expect(signal.tone).toBe("next");
  });

  it("segue mostrando a próxima sessão para quem não faz aniversário", () => {
    const signal = getPersonSignal(person({ nextAppointmentAt: "2026-08-19T12:00:00Z" }), NOW);
    expect(signal.tone).toBe("next");
    expect(signal.label).toBe("Próxima sessão em 1 dia");
  });
});

import { describe, expect, it } from "vitest";

import { agendaBlockCreateSchema } from "@/features/appointments/schemas/agenda-block";

const ANA = "5b0e0c2a-1d3f-4c55-9a77-0c1d2e3f4a5b";

describe("agendaBlockCreateSchema", () => {
  it("dia inteiro vai de 00:00 do 1º dia a 00:00 do dia SEGUINTE ao último, no fuso do app", () => {
    const parsed = agendaBlockCreateSchema.parse({
      all_day: true,
      start_date: "2026-12-24",
      end_date: "2026-12-25",
      reason: " Feriado ",
    });

    expect(parsed).toEqual({
      all_day: true,
      starts_at: "2026-12-24T03:00:00.000Z",
      ends_at: "2026-12-26T03:00:00.000Z",
      reason: "Feriado",
      assignee_id: undefined,
    });
  });

  it("intervalo converte data e hora locais em ISO, e liga ao técnico", () => {
    const parsed = agendaBlockCreateSchema.parse({
      all_day: false,
      starts_at: "2026-10-10T12:00",
      ends_at: "2026-10-10T13:30",
      reason: "",
      assignee_id: ANA,
    });

    expect(parsed).toEqual({
      all_day: false,
      starts_at: "2026-10-10T15:00:00.000Z",
      ends_at: "2026-10-10T16:30:00.000Z",
      reason: null,
      assignee_id: ANA,
    });
  });

  it("técnico vazio é bloqueio de todos", () => {
    const parsed = agendaBlockCreateSchema.parse({
      all_day: true,
      start_date: "2026-10-12",
      end_date: "2026-10-12",
      assignee_id: "",
    });

    expect(parsed.assignee_id).toBeUndefined();
  });

  it("recusa fim antes do começo, com o erro no campo do fim", () => {
    const allDay = agendaBlockCreateSchema.safeParse({ all_day: true, start_date: "2026-10-12", end_date: "2026-10-11" });
    const partial = agendaBlockCreateSchema.safeParse({
      all_day: false,
      starts_at: "2026-10-10T14:00",
      ends_at: "2026-10-10T14:00",
    });

    expect(allDay.success).toBe(false);
    expect(allDay.error?.issues[0]?.path).toEqual(["end_date"]);
    expect(partial.success).toBe(false);
    expect(partial.error?.issues[0]?.path).toEqual(["ends_at"]);
  });

  it("recusa data que não existe e campo estranho", () => {
    expect(agendaBlockCreateSchema.safeParse({ all_day: true, start_date: "2026-02-31", end_date: "2026-03-01" }).success).toBe(
      false
    );
    expect(
      agendaBlockCreateSchema.safeParse({
        all_day: true,
        start_date: "2026-10-12",
        end_date: "2026-10-12",
        created_by_user_id: ANA,
      }).success
    ).toBe(false);
  });

  it("recusa motivo longo demais", () => {
    expect(
      agendaBlockCreateSchema.safeParse({
        all_day: true,
        start_date: "2026-10-12",
        end_date: "2026-10-12",
        reason: "x".repeat(301),
      }).success
    ).toBe(false);
  });
});

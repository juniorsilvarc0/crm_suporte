// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  appointmentCreateSchema,
  appointmentUpdateSchema,
} from "@/features/appointments/schemas/appointment";
import { localDateTimeToIso } from "@/lib/formatters/date";

const WHEN = "2026-10-08T09:00";

describe("appointmentCreateSchema", () => {
  it("aceita o mínimo (tipo + data/hora) e converte a data para ISO", () => {
    const result = appointmentCreateSchema.safeParse({ kind: "visita_tecnica", scheduled_at: WHEN });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scheduled_at).toBe(localDateTimeToIso(WHEN));
      expect(result.data.kind).toBe("visita_tecnica");
    }
  });

  it("exige o tipo e a data/hora", () => {
    expect(appointmentCreateSchema.safeParse({ scheduled_at: WHEN }).success).toBe(false);
    expect(appointmentCreateSchema.safeParse({ kind: "treinamento" }).success).toBe(false);
  });

  it("recusa tipo e data/hora inválidos", () => {
    expect(appointmentCreateSchema.safeParse({ kind: "consulta", scheduled_at: WHEN }).success).toBe(false);
    expect(
      appointmentCreateSchema.safeParse({ kind: "treinamento", scheduled_at: "data-ruim" }).success
    ).toBe(false);
  });

  it("vínculo vazio ('') vira ausente, não erro de uuid; duração é coagida a número", () => {
    const result = appointmentCreateSchema.safeParse({
      kind: "implantacao",
      scheduled_at: WHEN,
      customer_id: "",
      ticket_id: "",
      duration_min: "90",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customer_id).toBeUndefined();
      expect(result.data.ticket_id).toBeUndefined();
      expect(result.data.duration_min).toBe(90);
    }
  });

  it("título em branco vira null; chave desconhecida é recusada (strict)", () => {
    const blank = appointmentCreateSchema.safeParse({ kind: "treinamento", scheduled_at: WHEN, title: "   " });
    expect(blank.success).toBe(true);
    if (blank.success) expect(blank.data.title).toBeNull();

    expect(
      appointmentCreateSchema.safeParse({ kind: "treinamento", scheduled_at: WHEN, lead_id: "x" }).success
    ).toBe(false);
  });

  it("recusa uuid inválido num vínculo preenchido", () => {
    expect(
      appointmentCreateSchema.safeParse({ kind: "treinamento", scheduled_at: WHEN, customer_id: "nao-uuid" })
        .success
    ).toBe(false);
  });
});

describe("appointmentUpdateSchema", () => {
  it("é parcial: um campo só basta", () => {
    expect(appointmentUpdateSchema.safeParse({ status: "realizado" }).success).toBe(true);
  });

  it("recusa o objeto vazio (nada para atualizar)", () => {
    expect(appointmentUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("recusa status inválido", () => {
    expect(appointmentUpdateSchema.safeParse({ status: "compareceu" }).success).toBe(false);
  });
});

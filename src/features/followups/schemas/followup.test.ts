// @vitest-environment node
import { describe, expect, it } from "vitest";

import { followupCreateSchema, followupUpdateSchema } from "@/features/followups/schemas/followup";
import { localDateTimeToIso } from "@/lib/formatters/date";

const TICKET = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f";
const WHEN = "2026-10-10T09:00";

describe("followupCreateSchema", () => {
  it("aceita ticket + prazo + tipo e converte o prazo para ISO", () => {
    const result = followupCreateSchema.safeParse({ ticket_id: TICKET, due_at: WHEN, kind: "retorno" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.due_at).toBe(localDateTimeToIso(WHEN));
      expect(result.data.kind).toBe("retorno");
    }
  });

  it("exige ticket, prazo e tipo", () => {
    expect(followupCreateSchema.safeParse({ due_at: WHEN, kind: "retorno" }).success).toBe(false);
    expect(followupCreateSchema.safeParse({ ticket_id: TICKET, kind: "retorno" }).success).toBe(false);
    expect(followupCreateSchema.safeParse({ ticket_id: TICKET, due_at: WHEN }).success).toBe(false);
  });

  it("recusa ticket que não é uuid, tipo inválido e prazo ruim", () => {
    expect(followupCreateSchema.safeParse({ ticket_id: "x", due_at: WHEN, kind: "retorno" }).success).toBe(false);
    expect(followupCreateSchema.safeParse({ ticket_id: TICKET, due_at: WHEN, kind: "nope" }).success).toBe(false);
    expect(followupCreateSchema.safeParse({ ticket_id: TICKET, due_at: "ruim", kind: "retorno" }).success).toBe(false);
  });

  it("não aceita status nem done_at na criação (strict)", () => {
    expect(
      followupCreateSchema.safeParse({ ticket_id: TICKET, due_at: WHEN, kind: "retorno", status: "pendente" }).success
    ).toBe(false);
    expect(
      followupCreateSchema.safeParse({ ticket_id: TICKET, due_at: WHEN, kind: "retorno", done_at: WHEN }).success
    ).toBe(false);
  });
});

describe("followupUpdateSchema", () => {
  it("é parcial: só o status basta (concluir)", () => {
    expect(followupUpdateSchema.safeParse({ status: "concluido" }).success).toBe(true);
  });

  it("recusa objeto vazio e status/tipo inválidos", () => {
    expect(followupUpdateSchema.safeParse({}).success).toBe(false);
    expect(followupUpdateSchema.safeParse({ status: "enviado" }).success).toBe(false);
    expect(followupUpdateSchema.safeParse({ kind: "nope" }).success).toBe(false);
  });

  it("não aceita trocar o ticket nem done_at (strict)", () => {
    expect(followupUpdateSchema.safeParse({ ticket_id: TICKET }).success).toBe(false);
    expect(followupUpdateSchema.safeParse({ done_at: WHEN }).success).toBe(false);
  });
});

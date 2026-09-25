import { describe, expect, it } from "vitest";

import {
  shouldStampClienteAt,
  statusTimestampColumn,
} from "@/features/leads/lib/status-timestamp";

describe("statusTimestampColumn", () => {
  it("mapeia as quatro etapas canônicas", () => {
    expect(statusTimestampColumn("qualificado")).toBe("qualificado_at");
    expect(statusTimestampColumn("agendado")).toBe("agendado_at");
    expect(statusTimestampColumn("compareceu")).toBe("compareceu_at");
    expect(statusTimestampColumn("cliente")).toBe("cliente_at");
  });

  it("etapa canônica sem coluna dedicada não carimba", () => {
    expect(statusTimestampColumn("novo")).toBeNull();
    expect(statusTimestampColumn("em_atendimento")).toBeNull();
    expect(statusTimestampColumn("recorrente")).toBeNull();
    expect(statusTimestampColumn("perdido")).toBeNull();
  });

  it("coluna customizada do board não carimba", () => {
    expect(statusTimestampColumn("em-atendimento-bruna")).toBeNull();
    expect(statusTimestampColumn("ganho-particular")).toBeNull();
  });

  it("ausência devolve null", () => {
    expect(statusTimestampColumn(null)).toBeNull();
    expect(statusTimestampColumn(undefined)).toBeNull();
    expect(statusTimestampColumn("")).toBeNull();
  });
});

describe("shouldStampClienteAt", () => {
  it("só a etapa cliente carimba cliente_at", () => {
    expect(shouldStampClienteAt("cliente")).toBe(true);
  });

  it("recorrente também é ganho, mas NÃO carimba cliente_at", () => {
    // `recorrente` tem stage_type 'won' no board; ainda assim o marco de
    // virada para cliente é só o `cliente`.
    expect(shouldStampClienteAt("recorrente")).toBe(false);
  });

  it("coluna de ganho customizada não carimba", () => {
    expect(shouldStampClienteAt("ganho-particular")).toBe(false);
  });

  it("sem etapa não carimba", () => {
    expect(shouldStampClienteAt(null)).toBe(false);
  });
});

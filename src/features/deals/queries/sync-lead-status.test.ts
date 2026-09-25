import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { syncLeadStatusFromDeals } from "@/features/deals/queries/sync-lead-status";
import type { Database } from "@/lib/supabase/types";

const LEAD_ID = "22222222-2222-2222-2222-222222222222";

type Row = Record<string, unknown>;

const COLUMNS = [
  { key: "novo", position: 0, stage_type: "open" },
  { key: "agendado", position: 5, stage_type: "open" },
  { key: "cliente", position: 7, stage_type: "won" },
];

// Fake mínimo do client que atende as chamadas da função:
//   board_columns.select()
//   deals.select().eq().is()
//   leads.select().eq().maybeSingle()
//   leads.update().eq()
function makeSupabase(opts: {
  columns?: Row[];
  deals?: Row[];
  lead?: Row | null;
  updateError?: { message: string } | null;
}) {
  // Tipado pelo genérico (e não por um parâmetro `_patch` ignorado) para o
  // `update.mock.calls[0][0]` dos testes vir como Row sem acender o lint.
  const update = vi.fn<(patch: Row) => { eq: () => Promise<{ error: unknown }> }>(() => ({
    eq: vi.fn(async () => ({ error: opts.updateError ?? null })),
  }));

  const from = vi.fn((table: string) => {
    if (table === "board_columns") {
      return { select: vi.fn(async () => ({ data: opts.columns ?? COLUMNS, error: null })) };
    }
    if (table === "deals") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(async () => ({ data: opts.deals ?? [], error: null })),
          })),
        })),
      };
    }
    if (table === "leads") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: "lead" in opts ? opts.lead : null,
              error: null,
            })),
          })),
        })),
        update,
      };
    }
    throw new Error(`tabela inesperada: ${table}`);
  });

  return {
    supabase: { from } as unknown as SupabaseClient<Database>,
    update,
  };
}

const semMarcos = {
  qualificado_at: null,
  agendado_at: null,
  compareceu_at: null,
  cliente_at: null,
};

describe("syncLeadStatusFromDeals", () => {
  it("grava a etapa do card no lead", async () => {
    const { supabase, update } = makeSupabase({
      deals: [{ stage: "agendado" }],
      lead: { status: "novo", ...semMarcos },
    });

    const result = await syncLeadStatusFromDeals(supabase, { leadId: LEAD_ID });

    expect(result).toEqual({ status: "agendado", changed: true });
    expect(update.mock.calls[0][0]).toMatchObject({ status: "agendado" });
  });

  it("carimba o marco da etapa quando ainda está nulo", async () => {
    const { supabase, update } = makeSupabase({
      deals: [{ stage: "agendado" }],
      lead: { status: "novo", ...semMarcos },
    });

    await syncLeadStatusFromDeals(supabase, { leadId: LEAD_ID });

    expect(typeof update.mock.calls[0][0].agendado_at).toBe("string");
  });

  it("NÃO sobrescreve marco já preenchido — agendado_at guarda a data da consulta", async () => {
    const jaAgendado = "2026-08-01T10:00:00.000Z";
    const { supabase, update } = makeSupabase({
      deals: [{ stage: "agendado" }],
      lead: { status: "novo", ...semMarcos, agendado_at: jaAgendado },
    });

    await syncLeadStatusFromDeals(supabase, { leadId: LEAD_ID });

    expect(update.mock.calls[0][0]).toEqual({ status: "agendado" });
  });

  it("nada a fazer quando o lead já está na etapa e o marco existe", async () => {
    const { supabase, update } = makeSupabase({
      deals: [{ stage: "agendado" }],
      lead: { status: "agendado", ...semMarcos, agendado_at: "2026-08-01T10:00:00.000Z" },
    });

    const result = await syncLeadStatusFromDeals(supabase, { leadId: LEAD_ID });

    expect(result).toEqual({ status: "agendado", changed: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("lead na etapa certa mas sem marco ainda grava o marco", async () => {
    const { supabase, update } = makeSupabase({
      deals: [{ stage: "cliente" }],
      lead: { status: "cliente", ...semMarcos },
    });

    await syncLeadStatusFromDeals(supabase, { leadId: LEAD_ID });

    expect(typeof update.mock.calls[0][0].cliente_at).toBe("string");
  });

  it("etapa customizada não carimba marco nenhum", async () => {
    const { supabase, update } = makeSupabase({
      columns: [{ key: "triagem-bruna", position: 3, stage_type: "open" }],
      deals: [{ stage: "triagem-bruna" }],
      lead: { status: "novo", ...semMarcos },
    });

    await syncLeadStatusFromDeals(supabase, { leadId: LEAD_ID });

    expect(update.mock.calls[0][0]).toEqual({ status: "triagem-bruna" });
  });

  it("lead sem card fica como está — o último card apagado não rebaixa quem já era cliente", async () => {
    const { supabase, update } = makeSupabase({
      deals: [],
      lead: { status: "cliente", ...semMarcos },
    });

    const result = await syncLeadStatusFromDeals(supabase, { leadId: LEAD_ID });

    expect(result).toEqual({ status: null, changed: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("lead inexistente não quebra", async () => {
    const { supabase, update } = makeSupabase({ deals: [{ stage: "agendado" }], lead: null });

    const result = await syncLeadStatusFromDeals(supabase, { leadId: LEAD_ID });

    expect(result).toEqual({ status: null, changed: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("falha ao gravar não lança — o card já se moveu", async () => {
    const { supabase } = makeSupabase({
      deals: [{ stage: "agendado" }],
      lead: { status: "novo", ...semMarcos },
      updateError: { message: "boom" },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await syncLeadStatusFromDeals(supabase, { leadId: LEAD_ID });

    expect(result).toEqual({ status: "agendado", changed: false });
    spy.mockRestore();
  });
});

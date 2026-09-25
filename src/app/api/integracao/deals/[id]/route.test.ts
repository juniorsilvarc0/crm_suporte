import { afterEach, describe, expect, it, vi } from "vitest";

// Mesma fronteira mockada de src/app/api/integracao/deals/route.test.ts: só a
// autorização (já coberta por verify-webhook.test.ts), mantendo ok/fail reais.
const { authorizeIntegrationMock } = vi.hoisted(() => ({
  authorizeIntegrationMock: vi.fn(),
}));

vi.mock("@/features/integrations/lib/authorize-integration", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/integrations/lib/authorize-integration")>();
  return { ...actual, authorizeIntegration: authorizeIntegrationMock };
});

// Projeção do card sobre o lead: coberta em features/deals/lib/lead-status.test.ts.
// Aqui só interessa que a rota a chame ao mover ou remover um card.
const { syncLeadStatusMock } = vi.hoisted(() => ({
  syncLeadStatusMock: vi.fn(async () => ({ status: null, changed: false })),
}));

vi.mock("@/features/deals/queries/sync-lead-status", () => ({
  syncLeadStatusFromDeals: syncLeadStatusMock,
}));

import { DELETE, PATCH } from "@/app/api/integracao/deals/[id]/route";

type Row = Record<string, unknown>;
type Result = { data: Row | null; error: { message: string } | null };

const VALID_ID = "11111111-1111-1111-1111-111111111111";
const LEAD_ID = "22222222-2222-2222-2222-222222222222";

// Fake mínimo do client Supabase que atende as chamadas de PATCH/DELETE:
//   board_columns.select().eq().maybeSingle()                (valida a etapa destino)
//   deals.update().eq().is().select().maybeSingle()           (PATCH)
//   deals.update().eq().select().maybeSingle()                (soft DELETE)
function makeSupabase(opts: {
  columnRow?: Row | null;
  updateResult?: Result;
  deleteError?: { message: string } | null;
  deleteRow?: Row | null;
}) {
  const columnsMaybeSingle = vi.fn(async () => ({ data: opts.columnRow ?? null, error: null }));
  const columnsEq = vi.fn(() => ({ maybeSingle: columnsMaybeSingle }));
  const columnsSelect = vi.fn(() => ({ eq: columnsEq }));

  const updateResult: Result = opts.updateResult ?? { data: null, error: null };
  const updateMaybeSingle = vi.fn(async () => updateResult);
  const updateSelect = vi.fn(() => ({ maybeSingle: updateMaybeSingle }));
  const updateIs = vi.fn(() => ({ select: updateSelect }));
  const updateEq = vi.fn(() => ({ is: updateIs }));

  const deleteMaybeSingle = vi.fn(async () => ({
    data: opts.deleteRow ?? null,
    error: opts.deleteError ?? null,
  }));
  const deleteSelect = vi.fn(() => ({ maybeSingle: deleteMaybeSingle }));
  const deleteEq = vi.fn(() => ({ select: deleteSelect }));
  const update = vi.fn((patch: Row) =>
    "removed_at" in patch ? { eq: deleteEq } : { eq: updateEq }
  );

  const from = vi.fn((table: string) => {
    if (table === "board_columns") return { select: columnsSelect };
    if (table === "deals") return { update };
    throw new Error(`tabela inesperada: ${table}`);
  });

  return { from, columnsEq, update, updateEq, deleteEq };
}

function authorize(supabase: unknown) {
  authorizeIntegrationMock.mockResolvedValue({ supabase });
}

function patchRequest(body: unknown) {
  return new Request("http://x", { method: "PATCH", body: JSON.stringify(body) });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/integracao/deals/[id]", () => {
  it("retorna 400 id_invalido quando o id não é um UUID", async () => {
    authorize({ from: vi.fn() });

    const res = await PATCH(patchRequest({ notes: "x" }), {
      params: Promise.resolve({ id: "nao-e-um-uuid" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "id_invalido" });
  });

  it("retorna 400 nada_para_atualizar quando o patch vem vazio", async () => {
    authorize({ from: vi.fn() });

    const res = await PATCH(patchRequest({}), { params: Promise.resolve({ id: VALID_ID }) });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "nada_para_atualizar" });
  });

  it("retorna 400 stage_invalido quando a etapa de destino não existe em board_columns", async () => {
    const { from } = makeSupabase({ columnRow: null });
    authorize({ from });

    const res = await PATCH(patchRequest({ stage: "etapa-fantasma" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "stage_invalido" });
  });

  it("carimba won_at e zera lost_at ao mover para uma coluna com stage_type 'won'", async () => {
    const { from, update } = makeSupabase({
      columnRow: { key: "ganho", stage_type: "won" },
      updateResult: { data: { id: VALID_ID, stage: "ganho" }, error: null },
    });
    authorize({ from });

    const res = await PATCH(patchRequest({ stage: "ganho" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    const patch = update.mock.calls[0][0];
    expect(patch).toMatchObject({ stage: "ganho", lost_at: null });
    expect(typeof patch.won_at).toBe("string");
  });

  it("carimba lost_at e zera won_at ao mover para uma coluna com stage_type 'lost'", async () => {
    const { from, update } = makeSupabase({
      columnRow: { key: "perdido", stage_type: "lost" },
      updateResult: { data: { id: VALID_ID, stage: "perdido" }, error: null },
    });
    authorize({ from });

    const res = await PATCH(patchRequest({ stage: "perdido" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(res.status).toBe(200);
    const patch = update.mock.calls[0][0];
    expect(patch).toMatchObject({ stage: "perdido", won_at: null });
    expect(typeof patch.lost_at).toBe("string");
  });

  it("zera won_at e lost_at ao mover para uma coluna aberta (stage_type diferente de won/lost)", async () => {
    const { from, update } = makeSupabase({
      columnRow: { key: "novo", stage_type: "open" },
      updateResult: { data: { id: VALID_ID, stage: "novo" }, error: null },
    });
    authorize({ from });

    await PATCH(patchRequest({ stage: "novo" }), { params: Promise.resolve({ id: VALID_ID }) });

    expect(update.mock.calls[0][0]).toMatchObject({ stage: "novo", won_at: null, lost_at: null });
  });

  it("não mexe em won_at/lost_at quando o patch não move de etapa", async () => {
    const { from, update, columnsEq } = makeSupabase({
      updateResult: { data: { id: VALID_ID, notes: "novo texto" }, error: null },
    });
    authorize({ from });

    const res = await PATCH(patchRequest({ notes: "novo texto" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(res.status).toBe(200);
    expect(columnsEq).not.toHaveBeenCalled();
    expect(update.mock.calls[0][0]).toEqual({ notes: "novo texto" });
  });

  it("reprojeta o status do lead ao mover o card de etapa", async () => {
    const { from } = makeSupabase({
      columnRow: { key: "agendado", stage_type: "open" },
      updateResult: { data: { id: VALID_ID, lead_id: LEAD_ID }, error: null },
    });
    authorize({ from });

    await PATCH(patchRequest({ stage: "agendado" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(syncLeadStatusMock).toHaveBeenCalledWith(expect.anything(), { leadId: LEAD_ID });
  });

  it("edição que não mexe na etapa não reprojeta o lead", async () => {
    const { from } = makeSupabase({
      updateResult: { data: { id: VALID_ID, lead_id: LEAD_ID }, error: null },
    });
    authorize({ from });

    await PATCH(patchRequest({ notes: "x" }), { params: Promise.resolve({ id: VALID_ID }) });

    expect(syncLeadStatusMock).not.toHaveBeenCalled();
  });

  it("retorna 404 deal_not_found quando não existe deal com o id informado", async () => {
    const { from } = makeSupabase({ updateResult: { data: null, error: null } });
    authorize({ from });

    const res = await PATCH(patchRequest({ notes: "x" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: "deal_not_found" });
  });
});

describe("DELETE /api/integracao/deals/[id]", () => {
  it("retorna 400 id_invalido quando o id não é um UUID", async () => {
    authorize({ from: vi.fn() });

    const res = await DELETE(new Request("http://x", { method: "DELETE" }), {
      params: Promise.resolve({ id: "nao-e-um-uuid" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "id_invalido" });
  });

  it("remove o deal e retorna { deleted: true }", async () => {
    const { from, deleteEq } = makeSupabase({ deleteError: null });
    authorize({ from });

    const res = await DELETE(new Request("http://x", { method: "DELETE" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, deleted: true, removed: true, id: VALID_ID });
    expect(deleteEq).toHaveBeenCalledWith("id", VALID_ID);
  });

  it("reprojeta o lead com os cards que sobraram", async () => {
    const { from } = makeSupabase({ deleteRow: { lead_id: LEAD_ID } });
    authorize({ from });

    await DELETE(new Request("http://x", { method: "DELETE" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(syncLeadStatusMock).toHaveBeenCalledWith(expect.anything(), { leadId: LEAD_ID });
  });

  it("retorna 500 com a mensagem de erro quando o Supabase falha ao excluir", async () => {
    const { from } = makeSupabase({ deleteError: { message: "boom" } });
    authorize({ from });

    const res = await DELETE(new Request("http://x", { method: "DELETE" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, error: "boom" });
  });
});

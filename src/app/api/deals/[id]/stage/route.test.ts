import { afterEach, describe, expect, it, vi } from "vitest";

// Fronteiras externas mockadas: o factory do client admin do Supabase e o
// revalidatePath do Next (efeito colateral de cache, não é lógica da rota).
const {
  hasSupabaseAdminEnvMock,
  createSupabaseAdminClientMock,
  revalidatePathMock,
  syncLeadStatusMock,
} = vi.hoisted(() => ({
  hasSupabaseAdminEnvMock: vi.fn(() => true),
  createSupabaseAdminClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  syncLeadStatusMock: vi.fn(async () => ({ status: null, changed: false })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: hasSupabaseAdminEnvMock,
  createSupabaseAdminClient: createSupabaseAdminClientMock,
}));

// Projeção do card sobre o lead: tem teste próprio em features/deals/lib e em
// features/deals/queries. Aqui só interessa que a rota a chame.
vi.mock("@/features/deals/queries/sync-lead-status", () => ({
  syncLeadStatusFromDeals: syncLeadStatusMock,
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { PATCH } from "@/app/api/deals/[id]/stage/route";

type Row = Record<string, unknown>;
type Result = { data: Row | null; error: { message: string } | null };

const VALID_ID = "11111111-1111-1111-1111-111111111111";
const LEAD_ID = "22222222-2222-2222-2222-222222222222";

// Fake mínimo do client Supabase que atende as chamadas da rota:
//   board_columns.select().eq().maybeSingle()
//   deals.update().eq().is().select().maybeSingle()
function makeSupabase(opts: { columnRow?: Row | null; updateResult?: Result }) {
  const columnsMaybeSingle = vi.fn(async () => ({ data: opts.columnRow ?? null, error: null }));
  const columnsEq = vi.fn(() => ({ maybeSingle: columnsMaybeSingle }));
  const columnsSelect = vi.fn(() => ({ eq: columnsEq }));

  const updateResult: Result = opts.updateResult ?? { data: null, error: null };
  const updateMaybeSingle = vi.fn(async () => updateResult);
  const updateSelect = vi.fn(() => ({ maybeSingle: updateMaybeSingle }));
  const updateIs = vi.fn(() => ({ select: updateSelect }));
  const updateEq = vi.fn(() => ({ is: updateIs }));
  const update = vi.fn<(patch: Row) => { eq: typeof updateEq }>(() => ({ eq: updateEq }));

  const from = vi.fn((table: string) => {
    if (table === "board_columns") return { select: columnsSelect };
    if (table === "deals") return { update };
    throw new Error(`tabela inesperada: ${table}`);
  });

  return { from, update };
}

function patchRequest(body: unknown) {
  return new Request("http://x", { method: "PATCH", body: JSON.stringify(body) });
}

afterEach(() => {
  vi.clearAllMocks();
  hasSupabaseAdminEnvMock.mockReturnValue(true);
});

describe("PATCH /api/deals/[id]/stage", () => {
  it("retorna 400 quando o id não é um UUID", async () => {
    const res = await PATCH(patchRequest({ stage: "novo" }), {
      params: Promise.resolve({ id: "nao-e-um-uuid" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, message: "Card inválido." });
  });

  it("retorna 500 quando o Supabase admin não está configurado no ambiente", async () => {
    hasSupabaseAdminEnvMock.mockReturnValue(false);

    const res = await PATCH(patchRequest({ stage: "novo" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(res.status).toBe(500);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o corpo não é um JSON válido", async () => {
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: "{invalido" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, message: "JSON inválido." });
  });

  it("retorna 400 quando stage vem vazio", async () => {
    const res = await PATCH(patchRequest({ stage: "" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, message: "Etapa inválida." });
  });

  it("retorna 400 categoria inexistente quando o stage não existe em board_columns", async () => {
    const { from } = makeSupabase({ columnRow: null });
    createSupabaseAdminClientMock.mockReturnValue({ from });

    const res = await PATCH(patchRequest({ stage: "etapa-fantasma" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, message: "Categoria inexistente." });
  });

  it("carimba won_at e zera lost_at ao mover para uma coluna com stage_type 'won'", async () => {
    const { from, update } = makeSupabase({
      columnRow: { key: "ganho", stage_type: "won" },
      updateResult: { data: { id: VALID_ID }, error: null },
    });
    createSupabaseAdminClientMock.mockReturnValue({ from });

    const res = await PATCH(patchRequest({ stage: "ganho" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, message: "Etapa atualizada." });
    const patch = update.mock.calls[0][0];
    expect(patch).toMatchObject({ stage: "ganho", lost_at: null });
    expect(typeof patch.won_at).toBe("string");
    expect(revalidatePathMock).toHaveBeenCalledWith("/app/funil");
    expect(revalidatePathMock).toHaveBeenCalledWith("/app");
  });

  it("carimba lost_at e zera won_at ao mover para uma coluna com stage_type 'lost'", async () => {
    const { from, update } = makeSupabase({
      columnRow: { key: "perdido", stage_type: "lost" },
      updateResult: { data: { id: VALID_ID }, error: null },
    });
    createSupabaseAdminClientMock.mockReturnValue({ from });

    await PATCH(patchRequest({ stage: "perdido" }), { params: Promise.resolve({ id: VALID_ID }) });

    const patch = update.mock.calls[0][0];
    expect(patch).toMatchObject({ stage: "perdido", won_at: null });
    expect(typeof patch.lost_at).toBe("string");
  });

  it("retorna 404 quando o card não existe", async () => {
    const { from } = makeSupabase({
      columnRow: { key: "novo", stage_type: "open" },
      updateResult: { data: null, error: null },
    });
    createSupabaseAdminClientMock.mockReturnValue({ from });

    const res = await PATCH(patchRequest({ stage: "novo" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, message: "Card não encontrado." });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("reprojeta o status do lead depois de mover o card", async () => {
    const { from } = makeSupabase({
      columnRow: { key: "agendado", stage_type: "open" },
      updateResult: { data: { id: VALID_ID, lead_id: LEAD_ID }, error: null },
    });
    createSupabaseAdminClientMock.mockReturnValue({ from });

    const res = await PATCH(patchRequest({ stage: "agendado" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(res.status).toBe(200);
    expect(syncLeadStatusMock).toHaveBeenCalledWith(expect.anything(), { leadId: LEAD_ID });
    // A lista de leads mostra o status projetado; sem revalidar, fica velha.
    expect(revalidatePathMock).toHaveBeenCalledWith("/app/leads");
  });

  it("card órfão (sem lead) não tenta reprojetar", async () => {
    const { from } = makeSupabase({
      columnRow: { key: "novo", stage_type: "open" },
      updateResult: { data: { id: VALID_ID, lead_id: null }, error: null },
    });
    createSupabaseAdminClientMock.mockReturnValue({ from });

    await PATCH(patchRequest({ stage: "novo" }), { params: Promise.resolve({ id: VALID_ID }) });

    expect(syncLeadStatusMock).not.toHaveBeenCalled();
  });

  it("retorna 500 com a mensagem de erro quando o Supabase falha ao atualizar", async () => {
    const { from } = makeSupabase({
      columnRow: { key: "novo", stage_type: "open" },
      updateResult: { data: null, error: { message: "boom" } },
    });
    createSupabaseAdminClientMock.mockReturnValue({ from });

    const res = await PATCH(patchRequest({ stage: "novo" }), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, message: "boom" });
  });
});

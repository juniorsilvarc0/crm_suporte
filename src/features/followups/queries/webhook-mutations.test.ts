import { describe, expect, it, vi } from "vitest";

import { createFollowupFromWebhook } from "@/features/followups/queries/webhook-mutations";

type Row = Record<string, unknown>;
type Result = { data: Row | null; error: { message: string } | null };
type Payload = Parameters<typeof createFollowupFromWebhook>[1];

// Payload base já "parseado" (defaults do zod aplicados). Cada teste sobrescreve
// só o que interessa. `payload: {}` satisfaz o campo do schema (não é usado aqui).
function payload(over: Partial<Payload>): Payload {
  return {
    phone: "5586999998888",
    step: "48h",
    replied: false,
    recovered: false,
    payload: {},
    ...over,
  } as Payload;
}

// Fake mínimo do client que atende às três chamadas possíveis da função:
//   followups.select("id").eq().maybeSingle()      (busca por idempotency_key)
//   followups.update(patch).eq().select().single() (2º evento / retry)
//   followups.insert(row).select().single()        (primeira gravação)
function makeClient(opts: {
  existing?: Row | null;
  insertResult?: Result;
  updateResult?: Result;
}) {
  const existing = opts.existing ?? null;
  const insertResult = opts.insertResult ?? { data: { id: "fu-1" }, error: null };
  const updateResult = opts.updateResult ?? { data: { id: "fu-1" }, error: null };

  const maybeSingle = vi.fn(async () => ({ data: existing, error: null }));
  const findEq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: findEq }));

  const updateSingle = vi.fn(async () => updateResult);
  const updateSelect = vi.fn(() => ({ single: updateSingle }));
  const updateEq = vi.fn(() => ({ select: updateSelect }));
  const update = vi.fn((_patch: Row) => ({ eq: updateEq }));

  const insertSingle = vi.fn(async () => insertResult);
  const insertSelect = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn((_row: Row) => ({ select: insertSelect }));

  const from = vi.fn((table: string) => {
    if (table !== "followups") throw new Error(`tabela inesperada: ${table}`);
    return { select, update, insert };
  });

  return { client: { from } as never, insert, update, maybeSingle };
}

describe("createFollowupFromWebhook", () => {
  it("evento de ENVIO (chave nova) insere a linha completa com as colunas dedicadas", async () => {
    const { client, insert, update } = makeClient({ existing: null });

    await createFollowupFromWebhook(
      client,
      payload({
        leadId: "lead-1",
        step: "48h",
        message: "Oi! Vi que você não agendou ainda...",
        sent_at: "2026-07-23T13:00:00.000Z",
        idempotency_key: "fu-1",
      })
    );

    expect(update).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({
      lead_id: "lead-1",
      status: "enviado",
      step: "48h",
      message: "Oi! Vi que você não agendou ainda...",
      sent_at: "2026-07-23T13:00:00.000Z",
      scheduled_for: "2026-07-23T13:00:00.000Z",
      replied: false,
      recovered: false,
      replied_at: null,
      idempotency_key: "fu-1",
    });
  });

  it("evento de RESPOSTA (mesma chave) atualiza só replied/recovered/replied_at, sem apagar message/sent_at", async () => {
    const { client, insert, update } = makeClient({ existing: { id: "fu-1" } });

    await createFollowupFromWebhook(
      client,
      payload({
        step: "48h",
        replied: true,
        recovered: true,
        replied_at: "2026-07-23T15:30:00.000Z",
        idempotency_key: "fu-1",
        // sem message, sem sent_at (é o payload real do evento de resposta)
      })
    );

    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    // toEqual: garante que NENHUMA outra coluna (message/sent_at/scheduled_for)
    // entrou no patch — o texto e o horário reais do envio ficam intactos.
    expect(update.mock.calls[0][0]).toEqual({
      step: "48h",
      replied: true,
      recovered: true,
      replied_at: "2026-07-23T15:30:00.000Z",
    });
  });

  it("retry do ENVIO (replied/recovered false) não escreve essas colunas — recuperação já registrada é sticky", async () => {
    const { client, update } = makeClient({ existing: { id: "fu-1" } });

    await createFollowupFromWebhook(
      client,
      payload({
        step: "48h",
        message: "texto reenviado",
        sent_at: "2026-07-23T13:00:00.000Z",
        replied: false,
        recovered: false,
        idempotency_key: "fu-1",
      })
    );

    const patch = update.mock.calls[0][0] as Row;
    // não reverte: as chaves replied/recovered nem aparecem no patch.
    expect(patch).not.toHaveProperty("replied");
    expect(patch).not.toHaveProperty("recovered");
    expect(patch).toMatchObject({
      step: "48h",
      message: "texto reenviado",
      sent_at: "2026-07-23T13:00:00.000Z",
      scheduled_for: "2026-07-23T13:00:00.000Z",
    });
  });

  it("edge resposta-antes-do-envio: insere com scheduled_for ancorado em replied_at e sent_at nulo", async () => {
    const { client, insert } = makeClient({ existing: null });

    await createFollowupFromWebhook(
      client,
      payload({
        leadId: "lead-1",
        step: "48h",
        replied: true,
        recovered: true,
        replied_at: "2026-07-23T15:30:00.000Z",
        idempotency_key: "fu-2",
      })
    );

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({
      scheduled_for: "2026-07-23T15:30:00.000Z",
      sent_at: null,
      replied: true,
      recovered: true,
      replied_at: "2026-07-23T15:30:00.000Z",
    });
  });

  it("sem idempotency_key insere direto, sem buscar linha existente", async () => {
    const { client, insert, maybeSingle } = makeClient({ existing: null });

    await createFollowupFromWebhook(
      client,
      payload({ step: "48h", message: "manual", sent_at: "2026-07-23T13:00:00.000Z" })
    );

    expect(maybeSingle).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({ idempotency_key: null });
  });

  it("message guarda o texto humano (message tem prioridade sobre reason), sem marcadores", async () => {
    const { client, insert } = makeClient({ existing: null });

    await createFollowupFromWebhook(
      client,
      payload({ step: "5d", reason: "sem resposta", idempotency_key: "fu-3" })
    );

    // sem `message`, cai para `reason`; e nunca concatena "[step]"/"(recuperado)".
    expect(insert.mock.calls[0][0]).toMatchObject({ message: "sem resposta", step: "5d" });
  });

  it("propaga o erro do Supabase (rejeita a Promise)", async () => {
    const { client } = makeClient({
      existing: null,
      insertResult: { data: null, error: { message: "boom" } },
    });

    await expect(
      createFollowupFromWebhook(client, payload({ idempotency_key: "fu-4" }))
    ).rejects.toMatchObject({ message: "boom" });
  });
});

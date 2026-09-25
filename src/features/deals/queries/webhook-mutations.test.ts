import { describe, expect, it, vi } from "vitest";

import {
  createDealForAppointment,
  createDealFromWebhook,
} from "@/features/deals/queries/webhook-mutations";

type Row = Record<string, unknown>;
type Result = { data: Row | null; error: { message: string } | null };

// Mock mínimo do client Supabase que atende as chamadas destas funções:
//   deals.insert().select().single()  ou  deals.upsert(_, opts).select().single()
function makeClient(result: Result) {
  const single = vi.fn(async () => result);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn((_row: Row) => ({ select }));
  const upsert = vi.fn((_row: Row, _opts: Record<string, unknown>) => ({ select }));
  const from = vi.fn((table: string) => {
    if (table !== "deals") throw new Error(`tabela inesperada: ${table}`);
    return { insert, upsert };
  });
  return { client: { from } as never, insert, upsert };
}

describe("createDealFromWebhook", () => {
  it("insere um novo deal (sem idempotency_key) com source default 'agent'", async () => {
    const { client, insert, upsert } = makeClient({
      data: { id: "deal-1" },
      error: null,
    });

    const deal = await createDealFromWebhook(client, {
      phone: "27999990000",
      leadId: "lead-1",
      stage: "novo",
    });

    expect(deal).toEqual({ id: "deal-1" });
    expect(upsert).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({
      lead_id: "lead-1",
      stage: "novo",
      source: "agent",
      idempotency_key: null,
    });
  });

  it("preenche os campos opcionais ausentes com null", async () => {
    const { client, insert } = makeClient({ data: { id: "deal-1" }, error: null });

    await createDealFromWebhook(client, { phone: "27999990000", leadId: "lead-1", stage: "novo" });

    expect(insert.mock.calls[0][0]).toMatchObject({
      tipo_ensaio: null,
      valor: null,
      scheduled_at: null,
      title: null,
      notes: null,
    });
  });

  it("usa upsert com onConflict 'idempotency_key' quando a chave é informada", async () => {
    const { client, insert, upsert } = makeClient({ data: { id: "deal-1" }, error: null });

    await createDealFromWebhook(client, {
      phone: "27999990000",
      leadId: "lead-1",
      stage: "novo",
      idempotency_key: "chave-123",
    });

    expect(insert).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      idempotency_key: "chave-123",
    });
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: "idempotency_key" });
  });

  it("respeita o source explícito informado no payload (ex.: source diferente de 'agent')", async () => {
    const { client, insert } = makeClient({ data: { id: "deal-1" }, error: null });

    await createDealFromWebhook(client, {
      phone: "27999990000",
      leadId: "lead-1",
      stage: "novo",
      source: "manual",
    });

    expect(insert.mock.calls[0][0]).toMatchObject({ source: "manual" });
  });

  it("propaga o erro do Supabase (rejeita a Promise)", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });

    await expect(
      createDealFromWebhook(client, { phone: "27999990000", leadId: "lead-1", stage: "novo" })
    ).rejects.toMatchObject({ message: "boom" });
  });
});

describe("createDealForAppointment", () => {
  it("faz upsert com onConflict 'appointment_id', stage 'agendado' e source 'appointment'", async () => {
    const { client, upsert } = makeClient({
      data: { id: "deal-1", stage: "agendado" },
      error: null,
    });

    const deal = await createDealForAppointment(client, {
      leadId: "lead-1",
      appointmentId: "appt-1",
      tipo_ensaio: "gestante",
      scheduled_at: "2026-08-01T10:00:00.000Z",
    });

    expect(deal).toEqual({ id: "deal-1", stage: "agendado" });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      lead_id: "lead-1",
      appointment_id: "appt-1",
      stage: "agendado",
      source: "appointment",
      tipo_ensaio: "gestante",
      scheduled_at: "2026-08-01T10:00:00.000Z",
    });
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: "appointment_id" });
  });

  it("preenche tipo_ensaio e scheduled_at com null quando ausentes", async () => {
    const { client, upsert } = makeClient({ data: { id: "deal-1" }, error: null });

    await createDealForAppointment(client, { leadId: "lead-1", appointmentId: "appt-1" });

    expect(upsert.mock.calls[0][0]).toMatchObject({ tipo_ensaio: null, scheduled_at: null });
  });

  it("propaga o erro do Supabase (rejeita a Promise)", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });

    await expect(
      createDealForAppointment(client, { leadId: "lead-1", appointmentId: "appt-1" })
    ).rejects.toMatchObject({ message: "boom" });
  });
});

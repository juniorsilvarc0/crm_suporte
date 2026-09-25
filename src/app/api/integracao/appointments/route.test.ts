import { afterEach, describe, expect, it, vi } from "vitest";

// Mesma fronteira mockada dos demais testes de /api/integracao/*: só a
// autorização (já coberta por verify-webhook.test.ts), mantendo ok/fail reais.
const { authorizeIntegrationMock } = vi.hoisted(() => ({
  authorizeIntegrationMock: vi.fn(),
}));

vi.mock("@/features/integrations/lib/authorize-integration", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/integrations/lib/authorize-integration")>();
  return { ...actual, authorizeIntegration: authorizeIntegrationMock };
});

import { POST } from "@/app/api/integracao/appointments/route";

type Row = Record<string, unknown>;
type Result = { data: Row | null; error: { message: string } | null };

// Fake mínimo do client Supabase que atende ao POST (findLeadByPhone +
// upsertAppointmentFromWebhook + createDealForAppointment):
//   lead_phone_identities.select().eq().maybeSingle()
//   appointments.insert()/upsert().select().single()
//   deals.upsert().select().single()
function makeSupabase(opts: { leadRow?: Row | null; appointmentResult?: Result }) {
  const identitiesMaybeSingle = vi.fn(async () => ({
    data: opts.leadRow ? { lead: opts.leadRow } : null,
    error: null,
  }));
  const identitiesEq = vi.fn(() => ({ maybeSingle: identitiesMaybeSingle }));
  const identitiesSelect = vi.fn(() => ({ eq: identitiesEq }));

  const appointmentResult: Result = opts.appointmentResult ?? {
    data: { id: "appt-1", scheduled_at: "2026-08-01T10:00:00.000Z", tipo_ensaio: "gestante" },
    error: null,
  };
  const apptSingle = vi.fn(async () => appointmentResult);
  const apptSelect = vi.fn(() => ({ single: apptSingle }));
  const apptInsert = vi.fn(() => ({ select: apptSelect }));
  const apptUpsert = vi.fn(() => ({ select: apptSelect }));

  const dealResult: Result = { data: { id: "deal-1", stage: "agendado" }, error: null };
  const dealSingle = vi.fn(async () => dealResult);
  const dealSelect = vi.fn(() => ({ single: dealSingle }));
  const dealUpsert = vi.fn(() => ({ select: dealSelect }));

  const from = vi.fn((table: string) => {
    if (table === "lead_phone_identities") return { select: identitiesSelect };
    if (table === "appointments") return { insert: apptInsert, upsert: apptUpsert };
    if (table === "deals") return { upsert: dealUpsert };
    throw new Error(`tabela inesperada: ${table}`);
  });

  return { from, apptInsert, dealUpsert };
}

function authorize(supabase: unknown) {
  authorizeIntegrationMock.mockResolvedValue({ supabase });
}

function postRequest(body: unknown) {
  return new Request("http://x/api/integracao/appointments", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const validPayload = {
  phone: "27999990000",
  scheduled_at: "2026-08-01T10:00:00.000Z",
  tipo_ensaio: "gestante",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/integracao/appointments", () => {
  it("retorna 422 invalid_payload quando falta um campo obrigatório", async () => {
    authorize({ from: vi.fn() });

    const res = await POST(postRequest({ scheduled_at: "2026-08-01T10:00:00.000Z" }));

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: "invalid_payload" });
  });

  it("cria o appointment e também cria (idempotente, via upsert) o deal do funil quando o telefone tem lead vinculado", async () => {
    const { from, dealUpsert } = makeSupabase({ leadRow: { id: "lead-1" } });
    authorize({ from });

    const res = await POST(postRequest(validPayload));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.appointment).toMatchObject({ id: "appt-1" });
    expect(body.deal).toMatchObject({ id: "deal-1", stage: "agendado" });

    // A idempotência em si (não duplicar em retries) é garantida pelo upsert
    // com onConflict 'appointment_id' — coberta em webhook-mutations.test.ts.
    expect(dealUpsert).toHaveBeenCalledTimes(1);
  });

  it("cria o appointment mas NÃO cria deal quando o telefone não corresponde a nenhum lead", async () => {
    const { from, dealUpsert } = makeSupabase({ leadRow: null });
    authorize({ from });

    const res = await POST(postRequest(validPayload));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.appointment).toMatchObject({ id: "appt-1" });
    expect(body.deal).toBeNull();
    expect(dealUpsert).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  appointmentSingleMock,
  getViewerMock,
  setStatusMock,
  syncAttendanceMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  appointmentSingleMock: vi.fn(),
  getViewerMock: vi.fn(),
  setStatusMock: vi.fn(),
  syncAttendanceMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/auth/require-dashboard-session", () => ({
  getDashboardViewer: getViewerMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table !== "appointments") throw new Error(`tabela inesperada: ${table}`);
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({ single: appointmentSingleMock })),
        })),
      };
    },
  }),
}));
vi.mock("@/features/leads/queries/resolve-lead-identity", () => ({
  resolveLeadIdentity: vi.fn(),
}));
vi.mock("@/features/leads/queries/set-lead-status", () => ({
  isAmbiguousLeadStatusError: (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "21000",
  setLeadStatusFromSingleDeal: setStatusMock,
}));
vi.mock("@/features/deals/queries/sync-attendance", () => ({
  syncDealsOnAttendance: syncAttendanceMock,
}));

import { POST } from "@/app/api/appointments/route";

const LEAD_ID = "8f9bc40b-8b1c-4b17-bbb8-fb6d00fc9c07";

function request() {
  return new Request("http://x/api/appointments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_mode: "existing",
      lead_id: LEAD_ID,
      scheduled_at: "2026-08-12T10:00",
      duration_min: 60,
      status: "agendado",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getViewerMock.mockResolvedValue({ id: "a2cb8c1e-3d34-4a8a-a2b3-724272e5d374" });
  appointmentSingleMock.mockResolvedValue({ data: { id: "appointment-1" }, error: null });
  setStatusMock.mockResolvedValue({ leadId: LEAD_ID, dealId: "deal-1", status: "agendado" });
});

describe("POST /api/appointments", () => {
  it("não muda Lead/Funil quando a inserção do agendamento falha", async () => {
    appointmentSingleMock.mockResolvedValue({
      data: null,
      error: { message: "violação de chave estrangeira" },
    });

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(setStatusMock).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("não induz retry duplicado quando há mais de uma oportunidade ativa", async () => {
    setStatusMock.mockRejectedValue({ code: "21000" });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true });
    expect(body.message).toContain("Agendamento criado");
    expect(body.message).toContain("mova o card correto");
    expect(syncAttendanceMock).not.toHaveBeenCalled();
  });
});

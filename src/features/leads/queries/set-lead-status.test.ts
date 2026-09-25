import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  isAmbiguousLeadStatusError,
  setLeadStatusFromSingleDeal,
} from "@/features/leads/queries/set-lead-status";
import type { Database } from "@/lib/supabase/types";

function clientWithRpc(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient<Database>;
}

describe("setLeadStatusFromSingleDeal", () => {
  it("move pessoa e oportunidade pela RPC atômica", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { leadId: "lead-1", dealId: "deal-1", status: "qualificado" },
      error: null,
    });

    const result = await setLeadStatusFromSingleDeal(clientWithRpc(rpc), {
      leadId: "lead-1",
      status: "qualificado",
      occurredAt: "2026-08-09T12:00:00.000Z",
      leadPatch: { name: "João", phone: "+55 86 99999-9999" },
    });

    expect(result).toEqual({
      leadId: "lead-1",
      dealId: "deal-1",
      status: "qualificado",
    });
    expect(rpc).toHaveBeenCalledWith("set_lead_status_from_single_deal", {
      p_lead_id: "lead-1",
      p_status: "qualificado",
      p_occurred_at: "2026-08-09T12:00:00.000Z",
      p_lead_patch: { name: "João", phone: "+55 86 99999-9999" },
    });
  });

  it("propaga conflito de múltiplas oportunidades sem escolher card", async () => {
    const error = { code: "21000", message: "multiple_active_deals_requires_deal_id" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });

    await expect(
      setLeadStatusFromSingleDeal(clientWithRpc(rpc), {
        leadId: "lead-1",
        status: "cliente",
      })
    ).rejects.toBe(error);
    expect(isAmbiguousLeadStatusError(error)).toBe(true);
  });
});

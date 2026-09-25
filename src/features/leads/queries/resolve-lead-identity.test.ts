import { describe, expect, it, vi } from "vitest";

import { resolveLeadIdentity } from "@/features/leads/queries/resolve-lead-identity";
import type { Database } from "@/lib/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

function clientWithRpc(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient<Database>;
}

describe("resolveLeadIdentity", () => {
  it("envia formatos equivalentes para a mesma resolução canônica", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        leadId: "lead-1",
        normalizedPhone: "86999999999",
        created: false,
        initialDealId: null,
      },
      error: null,
    });

    const result = await resolveLeadIdentity(clientWithRpc(rpc), {
      phone: "+55 86 99999-9999",
      name: "João",
      source: "whatsapp",
      createInitialDeal: true,
      lastInteractionAt: "2026-08-09T10:00:00.000Z",
    });

    expect(result).toEqual({
      leadId: "lead-1",
      normalizedPhone: "86999999999",
      created: false,
      initialDealId: null,
    });
    expect(rpc).toHaveBeenCalledWith("resolve_lead_identity", {
      p_phone: "+55 86 99999-9999",
      p_name: "João",
      p_source: "whatsapp",
      p_create_initial_deal: true,
      p_last_interaction_at: "2026-08-09T10:00:00.000Z",
      p_reactivate: true,
    });
  });

  it("recusa telefone inválido antes de acessar o banco", async () => {
    const rpc = vi.fn();

    await expect(
      resolveLeadIdentity(clientWithRpc(rpc), { phone: "sem telefone" })
    ).rejects.toThrow("invalid_normalized_phone");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recusa contrato inesperado da RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { leadId: "lead-1" }, error: null });

    await expect(
      resolveLeadIdentity(clientWithRpc(rpc), { phone: "86999999999" })
    ).rejects.toThrow("invalid_lead_identity_response");
  });
});

import { describe, expect, it, vi } from "vitest";

import { resolveContactIdentity } from "@/features/contacts/queries/resolve-contact-identity";
import type { Database } from "@/lib/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

function clientWithRpc(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient<Database>;
}

describe("resolveContactIdentity", () => {
  it("envia formatos equivalentes para a mesma resolução canônica", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        contactId: "contato-1",
        normalizedPhone: "86999999999",
        created: false,
      },
      error: null,
    });

    const result = await resolveContactIdentity(clientWithRpc(rpc), {
      phone: "+55 86 99999-9999",
      name: "João",
      source: "whatsapp",
      lastInteractionAt: "2026-08-09T10:00:00.000Z",
    });

    expect(result).toEqual({
      contactId: "contato-1",
      normalizedPhone: "86999999999",
      created: false,
    });
    expect(rpc).toHaveBeenCalledWith("resolve_contact_identity", {
      p_phone: "+55 86 99999-9999",
      p_name: "João",
      p_source: "whatsapp",
      p_last_interaction_at: "2026-08-09T10:00:00.000Z",
      p_reactivate: true,
    });
  });

  it("omite nome e interação ausentes para valer o default da RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { contactId: "contato-1", normalizedPhone: "86999999999", created: true },
      error: null,
    });

    await resolveContactIdentity(clientWithRpc(rpc), {
      phone: "86999999999",
      name: null,
      reactivate: false,
    });

    expect(rpc).toHaveBeenCalledWith("resolve_contact_identity", {
      p_phone: "86999999999",
      p_name: undefined,
      p_source: "whatsapp",
      p_last_interaction_at: undefined,
      p_reactivate: false,
    });
  });

  it("recusa telefone inválido antes de acessar o banco", async () => {
    const rpc = vi.fn();

    await expect(
      resolveContactIdentity(clientWithRpc(rpc), { phone: "sem telefone" })
    ).rejects.toThrow("invalid_normalized_phone");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recusa contrato inesperado da RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { contactId: "contato-1" }, error: null });

    await expect(
      resolveContactIdentity(clientWithRpc(rpc), { phone: "86999999999" })
    ).rejects.toThrow("invalid_contact_identity_response");
  });
});

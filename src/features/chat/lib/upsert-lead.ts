import {
  resolveLeadIdentity,
  type LeadIdentityResolution,
} from "@/features/leads/queries/resolve-lead-identity";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

// Resolve a PESSOA de uma mensagem inbound. A RPC serializa eventos concorrentes,
// preserva aliases e cria a oportunidade inicial somente no primeiro inbound.
export async function upsertLeadFromInbound(
  supabase: Admin,
  input: { phone: string; name: string | null }
): Promise<LeadIdentityResolution> {
  return resolveLeadIdentity(supabase, {
    phone: input.phone,
    name: input.name,
    source: "whatsapp",
    // A mensagem ainda pode ser um retry. O trigger de INSERT real é quem
    // atualiza a interação e cria/restaura a oportunidade sem efeito duplicado.
    createInitialDeal: false,
    lastInteractionAt: null,
    reactivate: false,
  });
}

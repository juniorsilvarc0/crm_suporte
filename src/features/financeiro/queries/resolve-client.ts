import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve o cliente vinculado a uma venda.
 * - Se vier `leadId`, usa o cliente existente.
 * - Se vier `newClientName`, cria um lead mínimo (somente nome) e devolve o id.
 *   `normalized_phone` é nullable, então o cliente sem telefone é válido.
 */
export async function resolveContractLeadId(
  supabase: SupabaseClient,
  {
    leadId,
    newClientName,
  }: { leadId?: string | null; newClientName?: string | null },
): Promise<{ leadId: string | null } | { error: string }> {
  if (leadId) return { leadId };

  const name = newClientName?.trim();
  if (!name) return { leadId: null };

  const { data, error } = await supabase
    .from("leads")
    .insert({
      name,
      source: "particular",
      status: "cliente",
      cliente_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { leadId: data.id as string };
}

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

/**
 * A pessoa deste número, SEM criar: primeiro o alias (um número antigo
 * continua levando à pessoa), depois a coluna do próprio contato. É a ordem de
 * `resolve_contact_identity`, sem a escrita. Igualdade exata com o número já
 * normalizado (sem nono dígito, D11).
 *
 * Devolve o id mesmo de contato arquivado ou anonimizado: o filtro é de quem
 * chama. LANÇA em erro: "não achei" e "não consegui ler" não podem se confundir.
 */
export async function findContactIdByPhone(
  supabase: SupabaseClient<Database>,
  normalizedPhone: string
): Promise<string | null> {
  const alias = await supabase
    .from("contact_phone_identities")
    .select("contact_id")
    .eq("normalized_phone", normalizedPhone)
    .maybeSingle();
  if (alias.error) throw new Error(`contact_phone_identities: ${alias.error.message}`);
  if (alias.data) return alias.data.contact_id;

  const contact = await supabase
    .from("contacts")
    .select("id")
    .eq("normalized_phone", normalizedPhone)
    .maybeSingle();
  if (contact.error) throw new Error(`contacts: ${contact.error.message}`);
  return contact.data?.id ?? null;
}

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveCustomerByPhone } from "@/features/customer-source/resolve-by-phone";
import { storeExternalContracts } from "@/features/customers/server/external-contracts";
import { normalizeCnpj } from "@/lib/formatters/cnpj";
import type { Database } from "@/lib/supabase/types";

type Admin = SupabaseClient<Database>;

export type EnrichContactResult =
  // Vinculado a uma empresa (criada ou reusada), com os contratos espelhados.
  | { state: "linked"; created: boolean; customerId: string }
  // A fonte não tem este número: o contato fica SEM empresa (já existe).
  | { state: "not_found" }
  // A fonte casou mais de um cadastro (409): não dá para escolher.
  | { state: "ambiguous" }
  // Cliente pessoa física (CPF): não vira empresa; contato sem empresa.
  | { state: "skipped_pf" }
  | { state: "not_configured" }
  | { state: "unavailable" }
  | { state: "error" };

/**
 * Enriquece UM contato a partir da fonte externa (TCBX): procura o cliente pelo
 * telefone e, se achar uma empresa (PJ com CNPJ), cria/reusa a empresa, vincula
 * o contato (só se ainda estiver sem empresa) e espelha os contratos. Se o
 * número não estiver na base — ou for PF —, NÃO cria nem vincula empresa: o
 * contato segue como está (ele já foi criado pelo fluxo de quem chamou).
 *
 * Mesma lógica do cadastro em massa (backfill), para UM contato e sob demanda —
 * é o que roda no 1º contato pelo WhatsApp. **Nunca lança**: é best-effort,
 * chamado de dentro do webhook por `after()`, e uma falha aqui não pode afetar a
 * mensagem. O desfecho vai para o log.
 */
export async function enrichContactFromSource(
  supabase: Admin,
  input: { contactId: string; phone: string; createdBy?: string | null }
): Promise<EnrichContactResult> {
  try {
    const result = await resolveCustomerByPhone(input.phone);
    if (result.state !== "ok") {
      // not_found | ambiguous | not_configured | unavailable: nada a vincular.
      return { state: result.state };
    }

    const cnpj = normalizeCnpj(result.context.documento);
    if (!/^[0-9]{14}$/.test(cnpj)) {
      // Pessoa física (CPF) ou documento inesperado: não vira empresa.
      return { state: "skipped_pf" };
    }

    const { data: existing, error: existingError } = await supabase
      .from("customers")
      .select("id")
      .eq("cnpj", cnpj)
      .is("archived_at", null)
      .maybeSingle();
    if (existingError) {
      console.error("enrichContactFromSource: empresa existente", existingError.code, existingError.message);
      return { state: "error" };
    }

    let customerId = existing?.id ?? null;
    let created = false;
    if (!customerId) {
      const legalName = (result.context.razaoSocial ?? result.context.nomeFantasia ?? cnpj)
        .trim()
        .slice(0, 200);
      const { data: inserted, error: insertError } = await supabase
        .from("customers")
        .insert({
          legal_name: legalName,
          trade_name: result.context.nomeFantasia ?? null,
          cnpj,
          created_by_user_id: input.createdBy ?? null,
        })
        .select("id")
        .single();
      if (insertError || !inserted) {
        // Corrida pelo mesmo CNPJ (customers_cnpj_active_uidx) ou erro: desiste
        // desta vez; a próxima mensagem, ou a reconciliação, liga depois.
        console.error("enrichContactFromSource: criar empresa", insertError?.code, insertError?.message);
        return { state: "error" };
      }
      customerId = inserted.id;
      created = true;
    }

    // Vincula só se o contato ainda estiver SEM empresa: nunca sobrescreve um
    // vínculo que alguém já fez à mão.
    const { error: linkError } = await supabase
      .from("contacts")
      .update({ customer_id: customerId })
      .eq("id", input.contactId)
      .is("customer_id", null);
    if (linkError) {
      console.error("enrichContactFromSource: vincular contato", linkError.code, linkError.message);
      return { state: "error" };
    }

    // Reaproveita o contexto já buscado: sem 2ª chamada à fonte.
    await storeExternalContracts(supabase, customerId, result.context.contratos);

    return { state: "linked", created, customerId };
  } catch (error) {
    console.error("enrichContactFromSource", error);
    return { state: "error" };
  }
}

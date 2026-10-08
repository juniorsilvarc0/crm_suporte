import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveCustomerByPhone } from "@/features/customer-source/resolve-by-phone";
import { storeExternalContracts } from "@/features/customers/server/external-contracts";
import type { BackfillReport } from "@/features/customers/types";
import { normalizeCnpj } from "@/lib/formatters/cnpj";
import type { Database } from "@/lib/supabase/types";

export type { BackfillReport };

// Cadastro em massa de empresas a partir da fonte externa (TCBX), por CONTATO:
// para cada contato SEM empresa, resolve o cliente pelo TELEFONE (tentando as
// variações canônicas do número) e, se achar um PJ (com CNPJ), cria a empresa
// (ou reusa a que já tem o CNPJ) e vincula o contato.
//
// Avança por CURSOR (id do contato), não por "quem ainda falta vincular": os que
// não resolvem (ambíguo/não encontrado/PF) ficam sem empresa, então filtrar por
// isso os reprocessaria em laço. O cursor passa por cima deles. `apply: false` é
// o ensaio (não grava).

type Admin = SupabaseClient<Database>;

const DEFAULT_BATCH = 50;
const MAX_BATCH = 200;

const empty = (): BackfillReport => ({
  processed: 0,
  created: 0,
  reused: 0,
  linked: 0,
  notFound: 0,
  ambiguous: 0,
  skippedPf: 0,
  errors: 0,
  cursor: null,
  done: true,
});

export async function backfillExternalCustomers(
  supabase: Admin,
  options: { apply: boolean; limit?: number; after?: string | null; createdBy: string }
): Promise<BackfillReport> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_BATCH, 1), MAX_BATCH);
  const report = empty();

  // Contatos sem empresa, ativos, em ordem de id a partir do cursor. `limit + 1`
  // só para saber se ainda há mais (não processa o extra).
  let query = supabase
    .from("contacts")
    .select("id, phone")
    .is("customer_id", null)
    .is("archived_at", null)
    .order("id", { ascending: true })
    .limit(limit + 1);
  if (options.after) query = query.gt("id", options.after);

  const { data, error } = await query;
  if (error) throw new Error(`contacts: ${error.message}`);

  const rows = data ?? [];
  const batch = rows.slice(0, limit);
  report.done = rows.length <= limit;
  report.cursor = batch.length > 0 ? batch[batch.length - 1].id : (options.after ?? null);

  // No ensaio, guarda os CNPJs que "criaria" para não contar o mesmo duas vezes.
  const wouldCreate = new Set<string>();

  for (const contact of batch) {
    report.processed += 1;
    if (!contact.phone) {
      report.notFound += 1;
      continue;
    }

    const result = await resolveCustomerByPhone(contact.phone);
    if (result.state === "not_found") {
      report.notFound += 1;
      continue;
    }
    if (result.state === "ambiguous") {
      report.ambiguous += 1;
      continue;
    }
    if (result.state !== "ok") {
      // unavailable / not_configured: a fonte está fora ou desligada.
      report.errors += 1;
      continue;
    }

    const cnpj = normalizeCnpj(result.context.documento);
    if (!/^[0-9]{14}$/.test(cnpj)) {
      // Pessoa física (CPF) ou documento inesperado: não vira empresa.
      report.skippedPf += 1;
      continue;
    }

    const { data: existing, error: existingError } = await supabase
      .from("customers")
      .select("id")
      .eq("cnpj", cnpj)
      .is("archived_at", null)
      .maybeSingle();
    if (existingError) {
      report.errors += 1;
      continue;
    }

    let customerId = existing?.id ?? null;
    if (customerId) {
      report.reused += 1;
    } else if (options.apply) {
      const legalName = (result.context.razaoSocial ?? result.context.nomeFantasia ?? cnpj).trim().slice(0, 200);
      const { data: inserted, error: insertError } = await supabase
        .from("customers")
        .insert({
          legal_name: legalName,
          trade_name: result.context.nomeFantasia ?? null,
          cnpj,
          created_by_user_id: options.createdBy,
        })
        .select("id")
        .single();
      if (insertError || !inserted) {
        report.errors += 1;
        continue;
      }
      customerId = inserted.id;
      report.created += 1;
    } else {
      // Ensaio: contaria como criação só uma vez por CNPJ.
      if (!wouldCreate.has(cnpj)) {
        wouldCreate.add(cnpj);
        report.created += 1;
      } else {
        report.reused += 1;
      }
    }

    if (options.apply) {
      const { error: linkError } = await supabase
        .from("contacts")
        .update({ customer_id: customerId })
        .eq("id", contact.id)
        .is("customer_id", null);
      if (linkError) {
        report.errors += 1;
        continue;
      }

      // A empresa nova já nasce com os contratos da TCBX: reaproveita o contexto
      // que a resolução por telefone JÁ trouxe (sem uma 2ª chamada à fonte).
      // Best-effort: falha aqui não desfaz o vínculo (storeExternalContracts loga).
      if (customerId) {
        await storeExternalContracts(supabase, customerId, result.context.contratos);
      }
    }
    report.linked += 1;
  }

  return report;
}

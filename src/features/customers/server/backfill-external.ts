import type { SupabaseClient } from "@supabase/supabase-js";

import { getCustomerContext } from "@/features/customer-source/get-customer-context";
import type { BackfillReport } from "@/features/customers/types";
import { normalizeCnpj } from "@/lib/formatters/cnpj";
import type { Database } from "@/lib/supabase/types";

export type { BackfillReport };

// Cadastro em massa de empresas a partir da fonte externa (TCBX), por CONTATO:
// para cada contato SEM empresa vinculada, consulta a fonte pelo telefone; se
// achar um cliente PJ (com CNPJ), cria a empresa (ou reusa a que já tem o CNPJ)
// e vincula o contato. Idempotente: roda em levas e, repetindo, só pega quem
// ainda não foi vinculado. `apply: false` é o ensaio (não grava): diz o que
// faria. Chave por telefone: cada contato tem um número, então não há a
// ambiguidade do CNPJ solto em mensagem.

type Admin = SupabaseClient<Database>;

const DEFAULT_BATCH = 50;
const MAX_BATCH = 200;

const empty = (): BackfillReport => ({
  processed: 0,
  created: 0,
  reused: 0,
  linked: 0,
  notFound: 0,
  skippedPf: 0,
  errors: 0,
  remaining: 0,
});

export async function backfillExternalCustomers(
  supabase: Admin,
  options: { apply: boolean; limit?: number; createdBy: string }
): Promise<BackfillReport> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_BATCH, 1), MAX_BATCH);
  const report = empty();

  // Contatos sem empresa, ativos, mais recentes primeiro. `limit + 1` só para
  // saber se ainda sobra (não processa o extra).
  const { data, error } = await supabase
    .from("contacts")
    .select("id, phone")
    .is("customer_id", null)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit + 1);
  if (error) throw new Error(`contacts: ${error.message}`);

  const rows = data ?? [];
  const batch = rows.slice(0, limit);
  report.remaining = Math.max(rows.length - limit, 0);

  // No ensaio (apply=false), guarda os CNPJs que "criaria" para não contar o
  // mesmo duas vezes quando dois contatos são da mesma empresa.
  const wouldCreate = new Set<string>();

  for (const contact of batch) {
    report.processed += 1;
    if (!contact.phone) {
      report.notFound += 1;
      continue;
    }

    let result: Awaited<ReturnType<typeof getCustomerContext>>;
    try {
      result = await getCustomerContext({ telefone: contact.phone });
    } catch {
      report.errors += 1;
      continue;
    }
    if (result.state === "not_found") {
      report.notFound += 1;
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

    // Empresa ativa com esse CNPJ já existe?
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
    }
    report.linked += 1;
  }

  return report;
}

import { z } from "zod";

import { CONTRACT_STATUSES, contractSealLabel, type ContractStatus } from "@/features/contracts/lib/contract-status";
import { isActiveContract } from "@/features/customer-source/active-contract";
import { contactRole, financialSituation, invoiceTotal } from "@/features/customer-source/financial";
import type { CustomerContext, CustomerOpenInvoice } from "@/features/customer-source/types";

// A situação do cliente para a IA de triagem (GET /api/v1/contacts/{id}/financial):
// quem é (documento, nomes), os selos da empresa e da pessoa e os títulos em
// aberto, separados em vencidos e a vencer. Vem da TCBX, ao vivo; o CRM não
// guarda os títulos. Escopo próprio (`financial:read`): o resto da v1 não mostra
// valor nenhum.

export const COMPANY_BADGES = [...CONTRACT_STATUSES, "ativo_tcbx", "sem_contrato", "sem_empresa"] as const;
export type CompanyBadge = (typeof COMPANY_BADGES)[number];

/**
 * O selo da empresa, a mesma precedência da tela (#53, painel do chat): o
 * contrato interno; senão, contrato ativo na TCBX; senão, sem contrato. Sem
 * empresa no CRM e sem cadastro na TCBX: sem_empresa.
 */
export function companyBadge(
  customer: { contract_status: ContractStatus | null } | null,
  context: CustomerContext | null
): CompanyBadge {
  if (customer?.contract_status) return customer.contract_status;
  if (context?.contratos.some(isActiveContract)) return "ativo_tcbx";
  if (customer || context) return "sem_contrato";
  return "sem_empresa";
}

export function companyBadgeLabel(badge: CompanyBadge): string {
  if (badge === "ativo_tcbx") return "Contrato ativo (TCBX)";
  if (badge === "sem_empresa") return "Sem empresa";
  return contractSealLabel(badge === "sem_contrato" ? null : badge);
}

const invoiceSchema = z.strictObject({
  id: z.number().int(),
  description: z.string().nullable(),
  contract_number: z.string().nullable(),
  due_date: z.string().nullable().describe("Vencimento, YYYY-MM-DD."),
  amount: z.number().describe("O que o cliente deve no título: principal + multa + juros, em reais."),
  installment: z.string().nullable().describe('Parcela, como "4/7"; null quando a TCBX não diz.'),
});

export const contactFinancialSchema = z.strictObject({
  found: z
    .boolean()
    .describe("true = o cliente foi achado na TCBX: pelo CNPJ da empresa do contato ou, sem empresa, pelo telefone."),
  not_found_reason: z
    .enum(["not_found", "ambiguous"])
    .nullable()
    .describe("Com `found` false: sem cadastro na TCBX, ou vários cadastros com este telefone."),
  document: z
    .string()
    .nullable()
    .describe("CNPJ (ou CPF) do cliente: o da TCBX, ou o da empresa no CRM quando a TCBX não achou."),
  trade_name: z.string().nullable().describe("Nome fantasia."),
  legal_name: z.string().nullable().describe("Razão social."),
  client_status: z.string().nullable().describe("Situação do cliente na TCBX (ex.: ativo)."),
  company_badge: z
    .enum(COMPANY_BADGES)
    .describe(
      "Selo da empresa, a regra da tela: o contrato interno; senão, contrato ativo na TCBX (ativo_tcbx); senão, " +
        "sem_contrato. Sem empresa no CRM e sem cadastro na TCBX: sem_empresa."
    ),
  company_badge_label: z.string().describe('O selo como a tela mostra (ex.: "Contrato ativo (TCBX)").'),
  contact_role: z
    .string()
    .nullable()
    .describe(
      "Selo da pessoa: o papel dela no cliente, na TCBX (dono, financeiro, operacional, gerente, outro). null = o " +
        "telefone do contato não está entre os contatos da TCBX."
    ),
  overdue: z.boolean().describe("true = há título vencido (vencimento antes de hoje, no fuso do Brasil)."),
  invoices_overdue: z.array(invoiceSchema).describe("Vencidos, do mais antigo para o mais recente."),
  invoices_upcoming: z.array(invoiceSchema).describe("A vencer, do mais próximo para o mais distante."),
  total_overdue: z.number(),
  total_upcoming: z.number(),
  oldest_overdue_date: z.string().nullable().describe("O vencimento mais antigo entre os vencidos."),
  checked_at: z.string().describe("Quando a TCBX foi consultada (ISO)."),
});

export type ContactFinancial = z.infer<typeof contactFinancialSchema>;

const money = (value: number) => Math.round(value * 100) / 100;

function toApiInvoice(invoice: CustomerOpenInvoice): z.infer<typeof invoiceSchema> {
  return {
    id: invoice.id,
    description: invoice.descricao,
    contract_number: invoice.contratoNumero,
    due_date: invoice.dataVencimento ? invoice.dataVencimento.slice(0, 10) : null,
    amount: money(invoiceTotal(invoice)),
    installment: invoice.parcelaN && invoice.parcelaDe ? `${invoice.parcelaN}/${invoice.parcelaDe}` : null,
  };
}

type CrmCustomer = {
  cnpj: string | null;
  legal_name: string | null;
  trade_name: string | null;
  contract_status: ContractStatus | null;
};

/** Monta a resposta. `context` null = a TCBX não achou (`notFoundReason` diz por quê). */
export function toContactFinancial(input: {
  customer: CrmCustomer | null;
  context: CustomerContext | null;
  notFoundReason: "not_found" | "ambiguous" | null;
  phone: string | null;
  today: string;
  checkedAt: string;
}): ContactFinancial {
  const { customer, context, today } = input;
  const situation = context ? financialSituation(context, today) : null;
  const badge = companyBadge(customer, context);
  return {
    found: context !== null,
    not_found_reason: context ? null : input.notFoundReason,
    document: context?.documento ?? customer?.cnpj ?? null,
    trade_name: context?.nomeFantasia ?? customer?.trade_name ?? null,
    legal_name: context?.razaoSocial ?? customer?.legal_name ?? null,
    client_status: context?.status ?? null,
    company_badge: badge,
    company_badge_label: companyBadgeLabel(badge),
    contact_role: context ? contactRole(context, input.phone) : null,
    overdue: (situation?.overdue.length ?? 0) > 0,
    invoices_overdue: (situation?.overdue ?? []).map(toApiInvoice),
    invoices_upcoming: (situation?.upcoming ?? []).map(toApiInvoice),
    total_overdue: money(situation?.totalOverdue ?? 0),
    total_upcoming: money(situation?.totalUpcoming ?? 0),
    oldest_overdue_date: situation?.oldestOverdue ?? null,
    checked_at: input.checkedAt,
  };
}

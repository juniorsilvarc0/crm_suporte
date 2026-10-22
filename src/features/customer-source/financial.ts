import { normalizePhone } from "@/lib/formatters/phone";

import type { CustomerContext, CustomerOpenInvoice } from "./types";

// A situação financeira do cliente na fonte (TCBX), para o alerta do chat e para
// a IA de triagem (API v1). Lógica pura, sem formatação: a tela e a rota formatam.
//
// Vencido = título em aberto com vencimento ANTES de hoje (no fuso do app). O do
// dia ainda está a vencer: ninguém está em atraso no dia do vencimento.

export type FinancialSituation = {
  /** Vencidos, do mais antigo para o mais recente. */
  overdue: CustomerOpenInvoice[];
  /** A vencer (hoje em diante, ou sem data), do mais próximo para o mais distante. */
  upcoming: CustomerOpenInvoice[];
  totalOverdue: number;
  totalUpcoming: number;
  /** O vencimento mais antigo entre os vencidos (YYYY-MM-DD), ou null. */
  oldestOverdue: string | null;
  /** O próximo vencimento entre os a vencer, ou null. */
  nextDue: string | null;
};

/** O que o cliente deve no título: principal + multa + juros. */
export function invoiceTotal(invoice: CustomerOpenInvoice): number {
  return (invoice.valorPrincipal ?? 0) + (invoice.multaValor ?? 0) + (invoice.jurosValor ?? 0);
}

const dueKey = (invoice: CustomerOpenInvoice) => (invoice.dataVencimento ?? "").slice(0, 10);

/** `today`: o dia de hoje no fuso do app, YYYY-MM-DD (getTodayAppDateKey). */
export function financialSituation(context: CustomerContext, today: string): FinancialSituation {
  const overdue: CustomerOpenInvoice[] = [];
  const upcoming: CustomerOpenInvoice[] = [];
  for (const invoice of context.titulosEmAberto) {
    const key = dueKey(invoice);
    (key && key < today ? overdue : upcoming).push(invoice);
  }
  // Sem data vai para o fim dos a vencer: não dá para dizer quando vence.
  const byDue = (a: CustomerOpenInvoice, b: CustomerOpenInvoice) =>
    (dueKey(a) || "9999-99-99").localeCompare(dueKey(b) || "9999-99-99") || a.id - b.id;
  overdue.sort(byDue);
  upcoming.sort(byDue);
  const sum = (list: CustomerOpenInvoice[]) => list.reduce((total, invoice) => total + invoiceTotal(invoice), 0);

  return {
    overdue,
    upcoming,
    totalOverdue: sum(overdue),
    totalUpcoming: sum(upcoming),
    oldestOverdue: overdue.length > 0 ? dueKey(overdue[0]) : null,
    nextDue: upcoming.find((invoice) => dueKey(invoice))?.dataVencimento?.slice(0, 10) ?? null,
  };
}

/**
 * A chave de um telefone para comparar cadastros: DDD + 8 últimos dígitos, sem
 * o 55 e sem o 9 extra (a mesma regra de phoneLookupCandidates). null = curto
 * demais para ser um telefone com DDD.
 */
export function phoneKey(value: string | null | undefined): string | null {
  const national = normalizePhone(value ?? "");
  if (national.length < 10) return null;
  return `${national.slice(0, 2)}${national.slice(2).slice(-8)}`;
}

/**
 * O papel (o "selo") da pessoa no cliente, na fonte: o `tipo` do contato cujo
 * WhatsApp ou telefone é o deste número. null = o número não está entre os
 * contatos da fonte.
 */
export function contactRole(context: CustomerContext, phone: string | null | undefined): string | null {
  const key = phoneKey(phone);
  if (!key) return null;
  const person = context.contatos.find(
    (contact) => phoneKey(contact.whatsapp) === key || phoneKey(contact.telefone) === key
  );
  const role = person?.tipo?.trim();
  return role ? role : null;
}

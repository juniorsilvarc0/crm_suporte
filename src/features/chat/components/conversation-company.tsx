import Link from "next/link";
import { Building2Icon, UserIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ContractStatusBadge } from "@/features/contracts/components/contract-status-badge";
import { isActiveContract } from "@/features/customer-source/active-contract";
import { contactRole } from "@/features/customer-source/financial";
import { companySeals, contactRoleLabel, type CompanySealTone } from "@/features/customer-source/seals";
import type { CustomerContextResult } from "@/features/customer-source/types";
import { ExternalContractBadge } from "@/features/customers/components/external-contract-badge";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import type { CustomerSummary } from "@/features/customers/types";
import { normalizeCnpj } from "@/lib/formatters/cnpj";
import { cn } from "@/lib/utils";

// Cor do selo da empresa pelo nível. Sempre com o texto do selo (UI §1.4).
const TONE_CLASS: Record<CompanySealTone, string> = {
  diamante: "bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  platina: "bg-slate-500/10 text-slate-700 dark:bg-slate-400/15 dark:text-slate-200",
  ouro: "bg-amber-500/15 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
  prata: "bg-zinc-500/10 text-zinc-700 dark:bg-zinc-400/15 dark:text-zinc-200",
  bronze: "bg-orange-500/10 text-orange-800 dark:bg-orange-400/15 dark:text-orange-300",
  outro: "bg-muted text-muted-foreground",
};

/**
 * A empresa do contato no cabeçalho da conversa, com os selos: o do contrato
 * (o mesmo do painel e da ficha), o nível na TCBX (Ouro, Diamante…, quando o
 * sistema contratado traz) e o papel da pessoa no cliente (Dono, Financeiro…).
 * Sem empresa ligada, nada.
 *
 * O nome e o contrato interno vêm do NOSSO cadastro e aparecem mesmo com a TCBX
 * fora; os selos da TCBX, só quando ela confirmou ESTA empresa (UI §1: a tela
 * não inventa). O nome é link para a ficha da empresa — destino diferente do da
 * foto/nome do contato, que abrem o painel. A partir de `xl`: no celular e na
 * coluna estreita, nada novo no cabeçalho (a empresa segue no painel do contato).
 */
export function ConversationCompany({
  customer,
  context,
  phone,
}: {
  customer: CustomerSummary | null;
  context: CustomerContextResult | null;
  phone: string | null;
}) {
  if (!customer) return null;

  const name = customerDisplayName(customer);
  // Os selos são da empresa LIGADA: só com a resposta da TCBX para o CNPJ dela.
  // Logo depois de trocar a empresa, a resposta ainda é a da anterior; e empresa
  // sem CNPJ é consultada pelo telefone, que pode achar outro cliente da TCBX.
  const confirmed =
    context?.state === "ok" &&
    customer.cnpj &&
    normalizeCnpj(context.context.documento) === normalizeCnpj(customer.cnpj)
      ? context.context
      : null;
  const seals = confirmed ? companySeals(confirmed) : [];
  const role = confirmed ? contactRole(confirmed, phone) : null;
  // O selo do contrato, com a precedência do painel e da ficha (#53): o contrato
  // interno; sem ele, o contrato ativo na TCBX. Sem nenhum dos dois, nada — o
  // "Sem contrato" do painel não vem para o cabeçalho.
  const contractSeal = customer.contract_status ? (
    <ContractStatusBadge status={customer.contract_status} />
  ) : confirmed?.contratos.some(isActiveContract) ? (
    <ExternalContractBadge />
  ) : null;

  return (
    // `shrink-3`: com a coluna apertada, a empresa cede antes do nome do contato.
    <div
      data-conversation-company
      className="hidden min-w-0 max-w-[20rem] shrink-3 items-center gap-2 border-s border-[var(--wa-panel-border)] ps-3 xl:flex"
    >
      <Building2Icon className="size-4 shrink-0 text-[var(--wa-meta)]" aria-hidden />
      <span className="min-w-0">
        <Link
          href={`/app/clientes/${customer.id}`}
          title={customer.legal_name}
          aria-label={`Abrir empresa ${name}`}
          className="block truncate rounded-sm text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {name}
        </Link>
        {contractSeal || seals.length > 0 || role || customer.archived_at ? (
          <span data-company-seals className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden">
            {contractSeal}
            {seals.map((seal) => (
              <Badge key={seal.label} className={cn("border-transparent", TONE_CLASS[seal.tone])} title={seal.systems.join(" · ")}>
                <span className="sr-only">Selo da empresa: </span>
                {seal.label}
              </Badge>
            ))}
            {role ? (
              <Badge variant="outline" className="text-muted-foreground" title="Papel desta pessoa no cliente, na TCBX">
                <UserIcon data-icon="inline-start" aria-hidden />
                <span className="sr-only">Papel na empresa: </span>
                {contactRoleLabel(role)}
              </Badge>
            ) : null}
            {customer.archived_at ? (
              <Badge variant="outline" title="Empresa arquivada" className="text-muted-foreground">
                Arquivada
              </Badge>
            ) : null}
          </span>
        ) : null}
      </span>
    </div>
  );
}

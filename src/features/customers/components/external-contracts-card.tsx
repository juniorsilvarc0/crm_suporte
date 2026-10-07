"use client";

import { useId, type ReactNode } from "react";
import { RotateCwIcon } from "lucide-react";

import { EmptyState } from "@/components/data-display/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isActiveContract } from "@/features/customer-source/active-contract";
import type { CustomerContract } from "@/features/customer-source/types";
import { useExternalContext } from "@/features/customer-source/use-external-context";
import { formatDate } from "@/lib/formatters/date";

/**
 * Contratos ATIVOS do cliente na fonte externa (TCBX), buscados sob demanda pela
 * rota da empresa (GET /api/customers/[id]/external-context). Somente leitura: a
 * TCBX não traz valor nem produto, e o nosso `support_contracts` é o contrato
 * interno da casa — por isso estes NÃO viram contrato nosso, só aparecem aqui.
 *
 * Cada estado é explícito (UI.md §1): carregando, indisponível (com "Tentar de
 * novo") e sem cadastro. Sem CNPJ não há chave de consulta e a integração
 * desligada (`not_configured`) somem por completo — nem o título aparece.
 */
export function ExternalContractsCard({
  customerId,
  hasCnpj,
}: {
  customerId: string;
  hasCnpj: boolean;
}) {
  const titleId = useId();
  const { loading, result, retry } = useExternalContext(
    hasCnpj ? `/api/customers/${customerId}/external-context` : null,
    hasCnpj
  );

  // Sem CNPJ não dá para consultar: nada a mostrar (nem título).
  if (!hasCnpj) return null;

  if (loading && !result) {
    return (
      <Section titleId={titleId}>
        <div className="space-y-2 rounded-xl border border-border/60 bg-card p-4 shadow-soft">
          <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      </Section>
    );
  }

  // Integração desligada: o bloco some inteiro (CRM sem fonte externa roda igual).
  if (!result || result.state === "not_configured") return null;

  if (result.state === "unavailable") {
    return (
      <Section titleId={titleId}>
        <EmptyState>
          <div className="grid justify-items-center gap-3">
            <p>Não foi possível consultar a TCBX.</p>
            <Button type="button" variant="outline" onClick={retry} className="h-11 sm:h-9">
              <RotateCwIcon data-icon="inline-start" />
              Tentar de novo
            </Button>
          </div>
        </EmptyState>
      </Section>
    );
  }

  if (result.state === "not_found" || result.state === "ambiguous") {
    return (
      <Section titleId={titleId}>
        <EmptyState>
          {result.state === "ambiguous"
            ? "Vários cadastros na TCBX com este CNPJ."
            : "Sem cadastro na TCBX."}
        </EmptyState>
      </Section>
    );
  }

  const active = result.context.contratos.filter(isActiveContract);
  return (
    <Section titleId={titleId}>
      {active.length === 0 ? (
        <EmptyState>Nenhum contrato ativo na TCBX.</EmptyState>
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card shadow-soft">
          {active.map((contract) => (
            <ExternalContractRow key={contract.id} contract={contract} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function ExternalContractRow({ contract }: { contract: CustomerContract }) {
  const title = contract.numero ? `Contrato ${contract.numero}` : `Contrato #${contract.id}`;
  const period = contract.dataFim
    ? `${formatDate(contract.dataInicio)} até ${formatDate(contract.dataFim)}`
    : contract.dataInicio
      ? `Desde ${formatDate(contract.dataInicio)}`
      : null;

  return (
    <li className="min-w-0 px-3 py-2.5 sm:px-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium">{title}</p>
        <Badge
          variant="outline"
          className="shrink-0 border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
        >
          Ativo
        </Badge>
      </div>
      {contract.modalidade ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{contract.modalidade}</p>
      ) : null}
      {period ? <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{period}</p> : null}
      {contract.vencimentoDia ? (
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          Vencimento: dia {contract.vencimentoDia}
        </p>
      ) : null}
    </li>
  );
}

function Section({ titleId, children }: { titleId: string; children: ReactNode }) {
  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <h2
        id={titleId}
        className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Contratos (TCBX)
      </h2>
      {children}
    </section>
  );
}

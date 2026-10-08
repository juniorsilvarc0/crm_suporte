"use client";

import { useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, RotateCwIcon } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/data-display/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isActiveContract } from "@/features/customer-source/active-contract";
import type { StoredExternalContract } from "@/features/customers/types";
import { formatDate, formatDateTime } from "@/lib/formatters/date";

/**
 * Contratos do cliente na fonte externa (TCBX), ESPELHADOS no banco e mostrados
 * READ-ONLY na ficha. A TCBX é a fonte da verdade; o CRM não cria nem edita —
 * por isso NÃO vão para o `support_contracts` (contrato interno, com valor e
 * fila). O admin pode reconsultar a fonte com "Atualizar da TCBX".
 *
 * Esconde-se quando não há nada a mostrar e nada a fazer (sem contrato espelhado
 * e sem botão): numa empresa sem CNPJ, ou num CRM sem a integração, o bloco some.
 */
export function ExternalContractsCard({
  customerId,
  contracts,
  canSync,
}: {
  customerId: string;
  contracts: StoredExternalContract[];
  /** Admin de empresa com CNPJ: pode disparar a sincronização. */
  canSync: boolean;
}) {
  const titleId = useId();
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  if (contracts.length === 0 && !canSync) return null;

  async function sync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const response = await fetch(`/api/customers/${customerId}/sync-contracts`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        result?: { state?: string };
      };
      if (!response.ok || !body.ok) {
        toast.error(body.message ?? "Não foi possível atualizar da TCBX.");
        return;
      }
      const state = body.result?.state;
      if (state === "not_configured") toast.error("A integração com a TCBX está desligada.");
      else if (state === "unavailable") toast.error("Não foi possível consultar a TCBX agora.");
      else if (state === "ambiguous") toast.error("Vários cadastros na TCBX com este CNPJ.");
      else if (state === "skipped") toast.error("A empresa não tem CNPJ para consultar.");
      else {
        toast.success(state === "not_found" ? "Sem cadastro na TCBX." : "Contratos atualizados.");
        router.refresh();
      }
    } catch {
      toast.error("Não foi possível atualizar da TCBX.");
    } finally {
      setSyncing(false);
    }
  }

  const syncedAt = contracts.reduce<string | null>(
    (latest, contract) => (latest && latest >= contract.syncedAt ? latest : contract.syncedAt),
    null
  );

  const action = canSync ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={syncing}
      onClick={() => void sync()}
      className="h-11 sm:h-8"
    >
      {syncing ? (
        <Loader2Icon className="animate-spin" data-icon="inline-start" />
      ) : (
        <RotateCwIcon data-icon="inline-start" />
      )}
      Atualizar da TCBX
    </Button>
  ) : null;

  return (
    <Section titleId={titleId} action={action} syncedAt={syncedAt}>
      {contracts.length === 0 ? (
        <EmptyState>Nenhum contrato da TCBX para esta empresa.</EmptyState>
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card shadow-soft">
          {contracts.map((contract) => (
            <ExternalContractRow key={contract.id} contract={contract} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function ExternalContractRow({ contract }: { contract: StoredExternalContract }) {
  const title = contract.numero ? `Contrato ${contract.numero}` : "Contrato";
  const active = isActiveContract(contract);
  const statusLabel = contract.statusVigencia ?? contract.status;
  const period = contract.dataFim
    ? `${formatDate(contract.dataInicio)} até ${formatDate(contract.dataFim)}`
    : contract.dataInicio
      ? `Desde ${formatDate(contract.dataInicio)}`
      : null;

  return (
    <li className="min-w-0 px-3 py-2.5 sm:px-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium">{title}</p>
        {active ? (
          <Badge
            variant="outline"
            className="shrink-0 border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
          >
            Ativo
          </Badge>
        ) : statusLabel ? (
          <Badge variant="outline" className="shrink-0 capitalize text-muted-foreground">
            {statusLabel}
          </Badge>
        ) : null}
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

function Section({
  titleId,
  action,
  syncedAt,
  children,
}: {
  titleId: string;
  action: ReactNode;
  syncedAt: string | null;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
        <h2
          id={titleId}
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Contratos (TCBX)
        </h2>
        {action}
      </div>
      {children}
      {syncedAt ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Atualizado da TCBX em {formatDateTime(syncedAt)}
        </p>
      ) : null}
    </section>
  );
}

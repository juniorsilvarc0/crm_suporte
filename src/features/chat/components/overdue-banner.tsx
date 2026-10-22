"use client";

import { TriangleAlertIcon } from "lucide-react";

import type { UseCustomerContext } from "@/features/chat/hooks/use-customer-context";
import { financialSituation } from "@/features/customer-source/financial";
import { formatDate, getTodayAppDateKey } from "@/lib/formatters/date";
import { formatMoney } from "@/lib/formatters/money";

/**
 * Alerta no topo da conversa quando o cliente tem título VENCIDO na TCBX: o
 * atendente sabe do atraso antes de responder. Em dia, sem cadastro, TCBX fora
 * ou integração desligada: nada aparece — o alerta só afirma o que a fonte
 * confirmou. O detalhe fica no painel do contato ("Ver detalhes").
 */
export function OverdueBanner({
  state,
  onOpenDetails,
}: {
  state: UseCustomerContext;
  onOpenDetails: () => void;
}) {
  const { result } = state;
  if (result?.state !== "ok") return null;

  const situation = financialSituation(result.context, getTodayAppDateKey());
  const count = situation.overdue.length;
  if (count === 0) return null;

  return (
    <div
      role="status"
      className="shrink-0 border-b border-[var(--wa-panel-border)] bg-[var(--wa-panel)]"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
        <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">
          <span className="font-medium">Cliente em atraso:</span>{" "}
          {count} {count === 1 ? "título vencido" : "títulos vencidos"} · {formatMoney(situation.totalOverdue)}
          {situation.oldestOverdue ? (
            <>
              {" "}
              · {count === 1 ? "venceu" : "o mais antigo venceu"} em {formatDate(situation.oldestOverdue)}
            </>
          ) : null}
          .
        </p>
        <button
          type="button"
          onClick={onOpenDetails}
          className="min-h-9 shrink-0 rounded-md px-2 font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Ver detalhes
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, MoreHorizontalIcon, PencilIcon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  contractStatusLabel,
  paymentMethodLabel,
} from "@/features/financeiro/schemas/labels";
import type { LeadSale } from "@/features/financeiro/types";
import { formatDate } from "@/lib/formatters/date";
import { formatMoneyExact } from "@/lib/formatters/money";
import { cn } from "@/lib/utils";

/**
 * Vendas do lead, com editar e cancelar.
 *
 * Existe porque registrar uma venda não mostrava nada em lugar nenhum — o dado
 * entrava e só reaparecia somado num KPI do dashboard. E porque, sem editar e
 * cancelar aqui, uma venda errada só se corrigia direto no banco.
 */
export function LeadSalesBlock({
  sales,
  onEdit,
}: {
  sales: LeadSale[];
  /**
   * Quem renderiza o bloco decide onde o formulário aparece. Dentro do modal do
   * lead ele TROCA o conteúdo em vez de abrir outro Dialog — empilhar modal dá
   * dois backdrops e dois focus traps.
   */
  onEdit?: (sale: LeadSale) => void;
}) {
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  if (sales.length === 0) return null;

  async function cancelSale(sale: LeadSale) {
    setCancellingId(sale.id);
    try {
      const response = await fetch(`/api/financeiro/sales/${sale.id}/cancel`, {
        method: "POST",
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível cancelar a venda.");
        return;
      }
      // O card do funil não volta sozinho: para onde ele deveria voltar não é
      // derivável. Dizer isso é melhor que mover por conta própria.
      toast.success("Venda cancelada. O card do funil continua onde está.");
      setConfirmingId(null);
      router.refresh();
    } catch {
      toast.error("Não foi possível cancelar a venda.");
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <>
      <ul className="grid gap-2">
        {sales.map((sale) => {
          const cancelled = sale.status === "cancelado";
          const confirming = confirmingId === sale.id;
          const busy = cancellingId === sale.id;

          return (
            <li
              key={sale.id}
              className={cn(
                "grid gap-1.5 rounded-lg border border-border/70 bg-card p-3",
                cancelled && "opacity-60"
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span
                  className={cn(
                    "min-w-0 truncate text-sm font-medium",
                    cancelled && "line-through"
                  )}
                >
                  {sale.procedureName ?? "Venda"}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatMoneyExact(sale.netAmount)}
                  </span>
                  {!cancelled ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="size-11 text-muted-foreground sm:size-8"
                            aria-label={`Ações da venda ${sale.procedureName ?? ""}`}
                          />
                        }
                      >
                        <MoreHorizontalIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          className="min-h-11 sm:min-h-8"
                          onClick={() => onEdit?.(sale)}
                        >
                          <PencilIcon />
                          Editar venda
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="min-h-11 sm:min-h-8"
                          variant="destructive"
                          onClick={() => setConfirmingId(sale.id)}
                        >
                          <XCircleIcon />
                          Cancelar venda
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-sm border px-1.5 py-0 text-[10px] font-medium",
                    sale.status === "quitado"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : cancelled
                        ? "border-border text-muted-foreground"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  )}
                >
                  {contractStatusLabel[sale.status]}
                </Badge>
                <span className="tabular-nums">{formatDate(sale.createdAt)}</span>
                {sale.method ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{paymentMethodLabel[sale.method]}</span>
                  </>
                ) : null}
                {sale.discount > 0 ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">
                      desconto {formatMoneyExact(sale.discount)}
                    </span>
                  </>
                ) : null}
              </div>

              {/* Confirmação inline, o padrão do repo para ação destrutiva. */}
              {confirming ? (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/70 pt-2">
                  <p className="mr-auto text-xs text-muted-foreground">
                    Cancelar esta venda? Ela sai das métricas.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirmingId(null)}
                  >
                    Voltar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void cancelSale(sale)}
                  >
                    {busy ? (
                      <Loader2Icon className="animate-spin" data-icon="inline-start" />
                    ) : null}
                    Cancelar venda
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

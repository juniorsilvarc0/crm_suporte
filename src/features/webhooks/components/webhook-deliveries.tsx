"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2Icon, RotateCcwIcon, RotateCwIcon } from "lucide-react";
import { toast } from "sonner";

import { FilterField } from "@/components/data-display/data-toolbar";
import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isWebhookEvent, webhookEventLabel } from "@/features/webhooks/catalog";
import {
  WEBHOOK_DELIVERY_STATUSES,
  webhookDeliveryStatusLabel,
  webhookDeliveryStatusTone,
} from "@/features/webhooks/lib/webhook-display";
import type { WebhookDelivery, WebhookDeliveryStatus, WebhookSubscription } from "@/features/webhooks/types";
import { formatDateTime, formatTime } from "@/lib/formatters/date";

const ALL = "all";
const READ_FAILED = "Não foi possível ler as entregas.";

type Filter = { subscription: string | null; status: WebhookDeliveryStatus | null };
type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; deliveries: WebhookDelivery[] };

/** Uma leitura. Nunca rejeita: a falha vira o estado de erro. */
async function fetchDeliveries(filter: Filter): Promise<Load> {
  const params = new URLSearchParams();
  if (filter.subscription) params.set("subscription", filter.subscription);
  if (filter.status) params.set("status", filter.status);
  try {
    const res = await fetch(`/api/webhooks/deliveries?${params.toString()}`, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; deliveries?: WebhookDelivery[] } | null;
    if (!res.ok || !body?.ok || !body.deliveries) return { state: "error", message: body?.message ?? READ_FAILED };
    return { state: "ok", deliveries: body.deliveries };
  } catch {
    return { state: "error", message: READ_FAILED };
  }
}

/** O que aconteceu com a entrega, além do status. */
function deliveryDetail(delivery: WebhookDelivery): string | null {
  const http = delivery.httpStatus ? `HTTP ${delivery.httpStatus}` : null;
  switch (delivery.status) {
    case "sent":
      return [http, delivery.deliveredAt ? `entregue às ${formatTime(delivery.deliveredAt)}` : null].filter(Boolean).join(" · ") || null;
    case "retry":
      return [delivery.error, `próxima tentativa às ${formatTime(delivery.nextAttemptAt)}`].filter(Boolean).join(" · ");
    case "dead_letter":
    case "skipped":
      return delivery.error;
    default:
      return null;
  }
}

/**
 * As entregas mais recentes (até 50), lidas ao abrir a aba e no Atualizar.
 * Uma entrega esgotada pode ser reenviada: volta à fila com as tentativas
 * zeradas, e o worker a entrega no próximo ciclo (até 20 s).
 */
export function WebhookDeliveries({ subscriptions }: { subscriptions: WebhookSubscription[] }) {
  const [filter, setFilter] = useState<Filter>({ subscription: null, status: null });
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(true);
  const [requeuing, setRequeuing] = useState<string | null>(null);
  // Cada leitura leva um número: a resposta de um filtro antigo é descartada.
  const latest = useRef(0);
  const mounted = useRef(false);

  const read = useCallback((next: Filter) => {
    const ticket = ++latest.current;
    setRefreshing(true);
    void fetchDeliveries(next).then((result) => {
      if (!mounted.current || ticket !== latest.current) return;
      setLoad(result);
      setRefreshing(false);
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    const ticket = ++latest.current;
    void fetchDeliveries({ subscription: null, status: null }).then((result) => {
      if (!mounted.current || ticket !== latest.current) return;
      setLoad(result);
      setRefreshing(false);
    });
    return () => {
      mounted.current = false;
    };
  }, []);

  function change(patch: Partial<Filter>) {
    const next = { ...filter, ...patch };
    setFilter(next);
    read(next);
  }

  async function requeue(delivery: WebhookDelivery) {
    setRequeuing(delivery.id);
    try {
      const res = await fetch(`/api/webhooks/deliveries/${delivery.id}/requeue`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !body.ok) {
        toast.error(body.message ?? "Não foi possível reenviar.");
      } else {
        toast.success("Entrega de volta à fila: sai no próximo ciclo.");
      }
    } catch {
      toast.error("Não foi possível reenviar.");
    } finally {
      setRequeuing(null);
      read(filter);
    }
  }

  const names = new Map(subscriptions.map((subscription) => [subscription.id, subscription.name]));
  const filtered = filter.subscription !== null || filter.status !== null;

  return (
    <section className="grid min-w-0 gap-3" aria-busy={refreshing}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Entregas recentes</h3>
          <p className="text-sm text-muted-foreground">As 50 mais recentes, da mais nova para a mais antiga.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <FilterField label="Destino">
            <FormSelect
              aria-label="Filtrar entregas por destino"
              value={filter.subscription ?? ALL}
              onValueChange={(value) => change({ subscription: names.has(value) ? value : null })}
              options={[{ value: ALL, label: "Todos" }, ...subscriptions.map((s) => ({ value: s.id, label: s.name }))]}
            />
          </FilterField>
          <FilterField label="Status">
            <FormSelect
              aria-label="Filtrar entregas por status"
              value={filter.status ?? ALL}
              onValueChange={(value) =>
                change({ status: WEBHOOK_DELIVERY_STATUSES.find((status) => status === value) ?? null })
              }
              options={[
                { value: ALL, label: "Todos" },
                ...WEBHOOK_DELIVERY_STATUSES.map((status) => ({ value: status, label: webhookDeliveryStatusLabel[status] })),
              ]}
            />
          </FilterField>
          <Button type="button" variant="outline" onClick={() => read(filter)} disabled={refreshing} className="h-11 sm:h-9">
            {refreshing ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <RotateCwIcon data-icon="inline-start" />}
            Atualizar
          </Button>
        </div>
      </div>

      {load.state === "loading" ? (
        <div className="grid gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-soft">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : load.state === "error" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-4 text-sm shadow-soft">
          <span className="text-amber-600 dark:text-amber-400">{load.message}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => read(filter)} className="h-11 sm:h-8">
            Tentar de novo
          </Button>
        </div>
      ) : load.deliveries.length === 0 ? (
        <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground shadow-soft">
          {filtered ? "Nenhuma entrega com esses filtros." : "Nenhuma entrega ainda. Elas aparecem aqui quando um ticket muda."}
        </p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border/70 overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
          {load.deliveries.map((delivery) => {
            const detail = deliveryDetail(delivery);
            const event = delivery.event && isWebhookEvent(delivery.event) ? webhookEventLabel[delivery.event] : delivery.event ?? "—";
            const name = delivery.subscriptionId ? names.get(delivery.subscriptionId) ?? "Destino excluído" : "—";
            return (
              <li key={delivery.id} className="flex min-w-0 flex-col gap-2 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium">{event}</span>
                    <span className={webhookDeliveryStatusTone[delivery.status]}>
                      {webhookDeliveryStatusLabel[delivery.status]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {delivery.attempts === 1 ? "1 tentativa" : `${delivery.attempts} tentativas`}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {name} · {formatDateTime(delivery.createdAt)}
                  </p>
                  {detail ? <p className="break-words text-xs text-muted-foreground">{detail}</p> : null}
                </div>
                {delivery.status === "dead_letter" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 self-start sm:h-8 sm:self-center"
                    disabled={requeuing === delivery.id}
                    onClick={() => void requeue(delivery)}
                  >
                    {requeuing === delivery.id ? (
                      <Loader2Icon className="animate-spin" data-icon="inline-start" />
                    ) : (
                      <RotateCcwIcon data-icon="inline-start" />
                    )}
                    Reenviar
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

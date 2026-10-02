"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock3Icon, Loader2Icon, RotateCwIcon } from "lucide-react";
import { toast } from "sonner";

import {
  ActiveFilters,
  DataToolbar,
  FilterButton,
  FilterField,
  ToolbarSearch,
} from "@/components/data-display/data-toolbar";
import { EmptyState } from "@/components/data-display/empty-state";
import { FormSelect } from "@/components/forms/form-select";
import { Status, StatusIndicator, StatusLabel } from "@/components/kibo-ui/status";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DEFAULT_INTEGRATION_LOG_FILTERS,
  integrationLogSearch,
  isRequestIdLike,
} from "@/features/integrations/lib/log-filters";
import {
  INTEGRATION_LOG_PERIOD_LABELS,
  INTEGRATION_PROVIDER_LABELS,
  integrationActionLabel,
  integrationLogAuthor,
  integrationProviderLabel,
} from "@/features/integrations/lib/log-labels";
import { integrationStatusLabel } from "@/features/integrations/schemas/status";
import {
  INTEGRATION_LOG_ACTIONS,
  INTEGRATION_LOG_PERIODS,
  INTEGRATION_LOG_PROVIDERS,
  type IntegrationLogAction,
  type IntegrationLogFilters,
  type IntegrationLogItem,
  type IntegrationLogsPage,
} from "@/features/integrations/types";
import { formatDateTime } from "@/lib/formatters/date";

const BASE_PATH = "/app/conexao";
const TAB = "registros";
const SEARCH_DEBOUNCE_MS = 300;
const ALL = "all";
const KNOWN_ACTIONS: readonly IntegrationLogAction[] = Object.values(INTEGRATION_LOG_ACTIONS).flat();

export type IntegrationLogTokenOption = { id: string; name: string };

/** A URL da aba com os filtros. O cursor nunca vai para a URL da página. */
export function integrationLogsHref(filters: IntegrationLogFilters): string {
  return `${BASE_PATH}?${new URLSearchParams({ aba: TAB, ...integrationLogSearch(filters) }).toString()}`;
}

function LogStatus({ log }: { log: IntegrationLogItem }) {
  const label = log.status ? integrationStatusLabel[log.status] : "—";
  const variant = log.status === "ok" ? "online" : log.status === "error" ? "offline" : "maintenance";
  return (
    <Status status={variant}>
      <StatusIndicator />
      <StatusLabel>
        {label}
        {log.http_status ? ` · ${log.http_status}` : ""}
      </StatusLabel>
    </Status>
  );
}

/** A ação, e embaixo o que explica a linha: a rota da API e o erro, quando há. */
function ActionCell({ log }: { log: IntegrationLogItem }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <span>{integrationActionLabel(log.action)}</span>
      {log.route ? <span className="truncate font-mono text-xs text-muted-foreground">{log.route}</span> : null}
      {log.error ? (
        <span className="truncate text-xs text-rose-600 dark:text-rose-400" title={log.error}>
          {log.error}
        </span>
      ) : null}
    </div>
  );
}

function latency(log: IntegrationLogItem): string {
  return log.latency_ms === null ? "—" : `${log.latency_ms} ms`;
}

/**
 * Aba Registros de Integrações. A URL é a fonte da verdade dos filtros: a
 * página lê a 1ª página no servidor (`getIntegrationLogs`), e esta tela só
 * mostra o que veio, sem filtro local por cima. "Carregar mais" pede as
 * seguintes a `GET /api/connection/logs` com o cursor, que não vai para a URL.
 */
export function IntegrationLogsTable({
  page,
  filters,
  tokens,
}: {
  page: IntegrationLogsPage;
  filters: IntegrationLogFilters;
  tokens: IntegrationLogTokenOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // As páginas seguintes, pedidas aqui. Página nova do servidor (filtro, ou
  // releitura) zera o que tinha sido carregado em cima da anterior.
  const firstItems = page.state === "ok" ? page.items : [];
  const [seenPage, setSeenPage] = useState(page);
  const [more, setMore] = useState<IntegrationLogItem[]>([]);
  const [cursor, setCursor] = useState(page.state === "ok" ? page.nextCursor : null);
  const [loadingMore, setLoadingMore] = useState(false);
  if (page !== seenPage) {
    setSeenPage(page);
    setMore([]);
    setCursor(page.state === "ok" ? page.nextCursor : null);
  }
  // O pedido de "mais" em curso quando a página trocou não entra na lista nova.
  const pageToken = useRef(page);
  useEffect(() => {
    pageToken.current = page;
  }, [page]);

  // O campo do id do pedido vai para a URL depois da pausa de digitação. O que
  // a própria tela pediu não sobrescreve o campo quando a URL chega: a pessoa
  // pode ter continuado digitando.
  const urlPedido = filters.pedido ?? "";
  const [pedido, setPedido] = useState(urlPedido);
  const [seenUrlPedido, setSeenUrlPedido] = useState(urlPedido);
  const [requestedPedido, setRequestedPedido] = useState(urlPedido);
  if (urlPedido !== seenUrlPedido) {
    setSeenUrlPedido(urlPedido);
    if (urlPedido !== requestedPedido) setPedido(urlPedido);
  }

  function navigate(next: IntegrationLogFilters) {
    setRequestedPedido(next.pedido ?? "");
    startTransition(() => router.replace(integrationLogsHref(next), { scroll: false }));
  }

  const typedPedido = pedido.trim();
  const typedIsValid = typedPedido === "" || isRequestIdLike(typedPedido);
  useEffect(() => {
    if (!typedIsValid) return;
    const wanted = typedPedido || null;
    if (wanted === filters.pedido) return;
    const timeout = window.setTimeout(() => {
      setRequestedPedido(wanted ?? "");
      startTransition(() => router.replace(integrationLogsHref({ ...filters, pedido: wanted }), { scroll: false }));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [typedPedido, typedIsValid, filters, router]);

  function change(patch: Partial<IntegrationLogFilters>) {
    navigate({ ...filters, ...patch });
  }

  function changeProvider(value: string) {
    const integracao = INTEGRATION_LOG_PROVIDERS.find((provider) => provider === value) ?? null;
    // A ação de uma integração não existe na outra; o token só existe na API.
    const actions: readonly string[] = integracao ? INTEGRATION_LOG_ACTIONS[integracao] : [];
    change({
      integracao,
      acao: integracao && filters.acao && !actions.includes(filters.acao) ? null : filters.acao,
      token: integracao === "relay" ? null : filters.token,
    });
  }

  function clearFilters() {
    setPedido("");
    navigate(DEFAULT_INTEGRATION_LOG_FILTERS);
  }

  async function loadMore() {
    if (!cursor || loadingMore) return;
    const requestedFor = page;
    setLoadingMore(true);
    try {
      const search = new URLSearchParams({ ...integrationLogSearch(filters), cursor });
      const res = await fetch(`/api/connection/logs?${search.toString()}`, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; items: IntegrationLogItem[]; nextCursor: string | null }
        | { ok: false; message?: string }
        | null;
      if (pageToken.current !== requestedFor) return;
      if (!res.ok || !body || !body.ok) {
        toast.error((body && !body.ok && body.message) || "Não foi possível carregar mais registros.");
        return;
      }
      setMore((list) => [...list, ...body.items]);
      setCursor(body.nextCursor);
    } catch {
      if (pageToken.current === requestedFor) toast.error("Não foi possível carregar mais registros.");
    } finally {
      setLoadingMore(false);
    }
  }

  const logs = [...firstItems, ...more];
  const activeCount = [
    filters.integracao,
    filters.status,
    filters.acao,
    filters.token,
    filters.periodo !== DEFAULT_INTEGRATION_LOG_FILTERS.periodo ? filters.periodo : null,
  ].filter(Boolean).length;
  const anyFilter = activeCount > 0 || Boolean(filters.pedido);

  const actionOptions = (filters.integracao ? [filters.integracao] : INTEGRATION_LOG_PROVIDERS).flatMap(
    (provider) =>
      INTEGRATION_LOG_ACTIONS[provider].map((action) => ({
        value: action,
        label: filters.integracao
          ? integrationActionLabel(action)
          : `${INTEGRATION_PROVIDER_LABELS[provider]}: ${integrationActionLabel(action)}`,
      }))
  );

  return (
    <div className="min-w-0">
      <DataToolbar>
        <ToolbarSearch
          aria-label="Buscar pelo id do pedido"
          placeholder="Id do pedido (request_id)…"
          value={pedido}
          onChange={(event) => setPedido(event.target.value)}
        />
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <FilterButton activeCount={activeCount}>
            <FilterField label="Integração">
              <FormSelect
                aria-label="Filtrar por integração"
                value={filters.integracao ?? ALL}
                onValueChange={changeProvider}
                options={[
                  { value: ALL, label: "Todas" },
                  ...INTEGRATION_LOG_PROVIDERS.map((provider) => ({
                    value: provider,
                    label: INTEGRATION_PROVIDER_LABELS[provider],
                  })),
                ]}
              />
            </FilterField>
            <FilterField label="Ação">
              <FormSelect
                aria-label="Filtrar por ação"
                value={filters.acao ?? ALL}
                onValueChange={(value) => change({ acao: KNOWN_ACTIONS.find((action) => action === value) ?? null })}
                options={[{ value: ALL, label: "Todas" }, ...actionOptions]}
              />
            </FilterField>
            <FilterField label="Status">
              <FormSelect
                aria-label="Filtrar por status"
                value={filters.status ?? ALL}
                onValueChange={(value) => change({ status: value === "ok" || value === "error" ? value : null })}
                options={[
                  { value: ALL, label: "Todos" },
                  { value: "ok", label: integrationStatusLabel.ok },
                  { value: "error", label: integrationStatusLabel.error },
                ]}
              />
            </FilterField>
            {filters.integracao === "relay" ? null : (
              <FilterField label="Token">
                <FormSelect
                  aria-label="Filtrar por token"
                  value={filters.token ?? ALL}
                  onValueChange={(value) => change({ token: tokens.some((token) => token.id === value) ? value : null })}
                  options={[{ value: ALL, label: "Todos" }, ...tokens.map((token) => ({ value: token.id, label: token.name }))]}
                />
              </FilterField>
            )}
            <FilterField label="Período">
              <FormSelect
                aria-label="Filtrar por período"
                value={filters.periodo}
                onValueChange={(value) =>
                  change({ periodo: INTEGRATION_LOG_PERIODS.find((period) => period === value) ?? DEFAULT_INTEGRATION_LOG_FILTERS.periodo })
                }
                options={INTEGRATION_LOG_PERIODS.map((period) => ({ value: period, label: INTEGRATION_LOG_PERIOD_LABELS[period] }))}
              />
            </FilterField>
          </FilterButton>
          <ActiveFilters count={activeCount + (filters.pedido ? 1 : 0)} onClear={clearFilters} />
        </div>
      </DataToolbar>

      {!typedIsValid ? (
        <p className="pt-2 text-xs text-amber-600 dark:text-amber-400">
          O id do pedido tem só letras, números e os sinais . _ : @ -, até 128 caracteres.
        </p>
      ) : filters.pedido ? (
        <p className="pt-2 text-xs text-muted-foreground">A busca pelo id do pedido vale para todo o registro, fora do período.</p>
      ) : null}

      {page.state === "unavailable" ? (
        <EmptyState>
          <div className="grid justify-items-center gap-3">
            <p>Não foi possível carregar os registros.</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => startTransition(() => router.refresh())}
              disabled={isPending}
              className="h-11 sm:h-9"
            >
              {isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <RotateCwIcon data-icon="inline-start" />}
              Tentar de novo
            </Button>
          </div>
        </EmptyState>
      ) : (
        <div aria-busy={isPending}>
          <div className="flex h-10 items-center text-xs text-muted-foreground" aria-live="polite">
            {logs.length === 1 ? "1 registro" : `${logs.length} registros`}
            {cursor ? ", e há mais" : ""}
            {filters.pedido ? "" : ` · ${INTEGRATION_LOG_PERIOD_LABELS[filters.periodo].toLocaleLowerCase("pt-BR")}`}
          </div>
          {logs.length === 0 ? (
            <EmptyState>
              {anyFilter ? "Nenhum registro com esses filtros." : "Nenhum registro de integração no período."}
            </EmptyState>
          ) : (
            <>
              <div className="hidden overflow-x-auto rounded-xl border border-border/60 bg-muted/20 px-2 pb-2 shadow-soft md:block">
                <Table variant="cards">
                  <TableHeader>
                    <TableRow variant="cards-header">
                      <TableHead>Quando</TableHead>
                      <TableHead>Integração</TableHead>
                      <TableHead>Ação</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Quem</TableHead>
                      <TableHead>Pedido</TableHead>
                      <TableHead className="text-right">Tempo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id} variant="card">
                        <TableCell className="whitespace-nowrap font-mono text-xs">{formatDateTime(log.created_at)}</TableCell>
                        <TableCell>{integrationProviderLabel(log.provider)}</TableCell>
                        <TableCell className="max-w-72">
                          <ActionCell log={log} />
                        </TableCell>
                        <TableCell>
                          <LogStatus log={log} />
                        </TableCell>
                        <TableCell className="max-w-48 truncate">{integrationLogAuthor(log) ?? "—"}</TableCell>
                        <TableCell className="max-w-40 truncate font-mono text-xs" title={log.request_id ?? undefined}>
                          {log.request_id ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{latency(log)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft md:hidden">
                {logs.map((log) => (
                  <article key={log.id} className="grid gap-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-medium">{integrationProviderLabel(log.provider)}</h3>
                        <div className="mt-1 text-sm text-muted-foreground">
                          <ActionCell log={log} />
                        </div>
                      </div>
                      <LogStatus log={log} />
                    </div>
                    {integrationLogAuthor(log) ? <p className="truncate text-sm">{integrationLogAuthor(log)}</p> : null}
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Clock3Icon className="size-3.5" aria-hidden />
                        {formatDateTime(log.created_at)}
                      </span>
                      <span>{latency(log)}</span>
                      {log.request_id ? <span className="truncate">{log.request_id}</span> : null}
                    </p>
                  </article>
                ))}
              </div>
            </>
          )}
          {cursor ? (
            <div className="flex justify-center pt-4">
              <Button type="button" variant="outline" onClick={loadMore} disabled={loadingMore} className="h-11 sm:h-9">
                {loadingMore ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
                Carregar mais
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

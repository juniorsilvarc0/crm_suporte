"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckIcon, Loader2Icon, SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ContractStatusBadge } from "@/features/contracts/components/contract-status-badge";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import type { CustomerSummary } from "@/features/customers/types";
import { formatCnpj } from "@/lib/formatters/cnpj";
import { cn } from "@/lib/utils";

export const CUSTOMER_SEARCH_DEBOUNCE_MS = 300;
// Mesmo teto de GET /api/customers (MAX_OPTIONS): pedir explícito deixa a tela
// saber quando a lista foi cortada.
export const CUSTOMER_SEARCH_LIMIT = 20;

/** Resultado de UMA busca; `key` diz a qual termo (e tentativa) ele responde. */
type SearchResult =
  | { key: string; status: "ready"; items: CustomerSummary[] }
  | { key: string; status: "failed" };

type Appearance = "chat" | "app";

// O painel do chat tem superfície própria (`--wa-info-*`, UI.md §5.7.12); fora
// dele, os tokens semânticos do app. Os alvos ficam em 48px nos dois: aqui não
// se reduz a densidade em `sm`.
const STYLES: Record<
  Appearance,
  { root: string; field: string; card: string; row: string; muted: string; action: string; skeleton: string }
> = {
  chat: {
    root: "flex flex-col gap-3 px-4 py-4",
    field:
      "h-11 rounded-xl border-transparent bg-[var(--wa-info-card)] pl-9 md:text-[15px] dark:bg-[var(--wa-info-card)]",
    card: "divide-y divide-[var(--wa-info-divider)] overflow-hidden rounded-xl bg-[var(--wa-info-card)]",
    row: "hover:bg-[var(--wa-info-active)]",
    muted: "text-[var(--wa-info-label)]",
    action: "text-[var(--wa-green-deep)] hover:bg-[var(--wa-info-active)]",
    skeleton: "bg-[var(--wa-info-active)]",
  },
  app: {
    root: "flex flex-col gap-3",
    field: "h-11 rounded-full pl-9 md:text-[15px]",
    card: "divide-y divide-border overflow-hidden rounded-xl border border-border bg-card",
    row: "hover:bg-muted",
    muted: "text-muted-foreground",
    action: "text-primary hover:bg-muted",
    skeleton: "",
  },
};

/**
 * Escolher a empresa de um contato: busca, lista e "Desligar".
 *
 * ⚠️ É **conteúdo**, não camada — mesmo desenho do `ConversationTagsPicker`.
 * No painel do contato do chat ele troca o miolo do sheet (um popup de
 * combobox iria para o `body`, fora do painel); em Contatos, mora dentro do
 * diálogo que já está aberto. Quem monta decide a casca e o que fazer com a
 * escolha — este componente não grava nada.
 *
 * A busca vai a `GET /api/customers` (só empresas ATIVAS) com debounce e
 * `AbortController`: a resposta de um termo velho nunca pinta por cima da do
 * termo novo.
 */
export function CustomerPicker({
  appearance,
  currentCustomerId,
  currentCustomerName,
  busyId,
  onPick,
  onUnlink,
}: {
  appearance: Appearance;
  /** Empresa ligada hoje: aparece com ✓ "Atual" e não é escolhível. */
  currentCustomerId: string | null;
  /** Nome de exibição da empresa atual, para "Desligar de X". */
  currentCustomerName?: string | null;
  /**
   * Escrita em voo: o id da empresa escolhida, ou `currentCustomerId` enquanto
   * desliga. Trava a lista inteira — o contato tem uma empresa só.
   */
  busyId: string | null;
  onPick: (customer: CustomerSummary) => void;
  /** Sem ela (ou sem vínculo), a linha "Desligar" não aparece. */
  onUnlink?: () => void;
}) {
  const styles = STYLES[appearance];
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  /** Incrementar busca de novo — é o "Tentar de novo". */
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<SearchResult | null>(null);

  const requestKey = `${attempt}:${debouncedQuery}`;

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedQuery(query.trim()),
      CUSTOMER_SEARCH_DEBOUNCE_MS
    );
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const key = `${attempt}:${debouncedQuery}`;
    const params = new URLSearchParams({ limit: String(CUSTOMER_SEARCH_LIMIT) });
    if (debouncedQuery) params.set("q", debouncedQuery);

    async function load() {
      try {
        const response = await fetch(`/api/customers?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean;
          items?: CustomerSummary[];
        } | null;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.items)) {
          throw new Error(`HTTP ${response.status}`);
        }
        setResult({ key, status: "ready", items: payload.items });
      } catch {
        // `abort` é troca de termo ou desmonte, não falha.
        if (controller.signal.aborted) return;
        setResult({ key, status: "failed" });
      }
    }

    // O `setState` mora depois do `await`: o carregando é derivado da chave,
    // sem setState síncrono no corpo do efeito.
    void load();
    return () => controller.abort();
  }, [debouncedQuery, attempt]);

  // Resposta de outro termo (ou tentativa) = ainda carregando este.
  const current = result?.key === requestKey ? result : null;
  const busy = busyId !== null;
  const unlinkBusy = busy && busyId === currentCustomerId;
  const items = current?.status === "ready" ? current.items : [];

  // A contagem aparece; falha e lista vazia já estão escritas na lista, então
  // no anúncio do leitor de tela elas vão só como texto oculto.
  let countText = "";
  let announceOnly = "";
  if (current?.status === "failed") {
    announceOnly = "Não foi possível buscar as empresas.";
  } else if (current?.status === "ready" && items.length === 0) {
    announceOnly = "Nenhuma empresa encontrada.";
  } else if (current?.status === "ready") {
    countText =
      items.length >= CUSTOMER_SEARCH_LIMIT
        ? `Mostrando as ${CUSTOMER_SEARCH_LIMIT} primeiras. Refine a busca.`
        : items.length === 1
          ? "1 empresa"
          : `${items.length} empresas`;
  }

  return (
    <div className={styles.root}>
      <label className="relative block">
        <span className="sr-only">Buscar empresa</span>
        <SearchIcon
          aria-hidden
          className={cn("pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2", styles.muted)}
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nome ou CNPJ"
          autoComplete="off"
          spellCheck={false}
          className={styles.field}
        />
      </label>

      <p aria-live="polite" className={cn("min-h-5 px-1 text-[13px]", styles.muted)}>
        {countText}
        <span className="sr-only">{announceOnly}</span>
      </p>

      {/* Teto próprio, não `flex-1`: a casca do chat e a do diálogo dão alturas
          diferentes ao filho (mesmo motivo do ConversationTagsPicker). */}
      <div
        aria-busy={current === null || undefined}
        className="max-h-[min(50dvh,22rem)] overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
      >
        <div className={styles.card}>
          {current === null ? (
            <>
              <div className="flex min-h-12 items-center px-4">
                <Skeleton className={cn("h-4 w-2/5", styles.skeleton)} />
              </div>
              <div className="flex min-h-12 items-center px-4">
                <Skeleton className={cn("h-4 w-1/3", styles.skeleton)} />
              </div>
            </>
          ) : current.status === "failed" ? (
            <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
              <span className={cn("min-w-0 text-[15px]", styles.muted)}>
                Não foi possível buscar as empresas.
              </span>
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
                className={cn(
                  "min-h-11 shrink-0 rounded-lg px-3 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  styles.action
                )}
              >
                Tentar de novo
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
              <span className={cn("min-w-0 text-[15px]", styles.muted)}>
                Nenhuma empresa encontrada.
              </span>
              <Link
                href="/app/clientes"
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  styles.action
                )}
              >
                Cadastrar em Clientes
              </Link>
            </div>
          ) : (
            items.map((customer) => {
              const isCurrent = customer.id === currentCustomerId;
              const displayName = customerDisplayName(customer);
              const secondary = [
                customer.legal_name !== displayName ? customer.legal_name : null,
                customer.cnpj ? formatCnpj(customer.cnpj) : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={customer.id}
                  type="button"
                  disabled={isCurrent || busy}
                  onClick={() => onPick(customer)}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default",
                    !isCurrent && "disabled:opacity-60",
                    !isCurrent && styles.row
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] text-foreground">{displayName}</span>
                    {secondary ? (
                      <span className={cn("truncate text-[13px] tabular-nums", styles.muted)}>
                        {secondary}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-2">
                    <ContractStatusBadge status={customer.contract_status} />
                    {busyId === customer.id ? (
                      <Loader2Icon aria-hidden className={cn("size-[18px] shrink-0 animate-spin", styles.muted)} />
                    ) : isCurrent ? (
                      <span className={cn("flex shrink-0 items-center gap-1 text-[13px]", styles.muted)}>
                        <CheckIcon aria-hidden className="size-[18px]" />
                        Atual
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {onUnlink && currentCustomerId ? (
        <div className={styles.card}>
          <button
            type="button"
            disabled={busy}
            onClick={onUnlink}
            className={cn(
              "flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-[15px] text-destructive transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60",
              styles.row
            )}
          >
            <span className="min-w-0 truncate">
              {currentCustomerName ? `Desligar de ${currentCustomerName}` : "Desligar da empresa"}
            </span>
            {unlinkBusy ? <Loader2Icon aria-hidden className="size-[18px] shrink-0 animate-spin" /> : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}

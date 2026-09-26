"use client";

import {
  useEffect,
  useOptimistic,
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { RotateCwIcon, XIcon } from "lucide-react";

import {
  ActiveFilters,
  DataToolbar,
  FilterButton,
  FilterField,
  ToolbarSearch,
} from "@/components/data-display/data-toolbar";
import { EmptyState } from "@/components/data-display/empty-state";
import { FormSelect } from "@/components/forms/form-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ContractStatusBadge } from "@/features/contracts/components/contract-status-badge";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import {
  CUSTOMER_SITUATIONS,
  type CustomerListItem,
  type CustomerListParams,
  type CustomerSituation,
  type CustomersPage,
} from "@/features/customers/types";
import { formatCnpj } from "@/lib/formatters/cnpj";
import { formatDate } from "@/lib/formatters/date";
import { cn } from "@/lib/utils";

const SEARCH_DEBOUNCE_MS = 300;
// Mesmo teto de parseCustomerListParams: o termo que a URL devolve é o termo
// que foi digitado, e o campo não "pula" quando a busca chega.
const SEARCH_MAX_LENGTH = 100;

const SITUATION_LABEL: Record<CustomerSituation, string> = {
  todas: "Todas",
  ativo: "Contrato ativo",
  suspenso: "Contrato suspenso",
  encerrado: "Contrato encerrado",
  sem: "Sem contrato",
  arquivadas: "Arquivadas",
};

const SITUATION_OPTIONS = CUSTOMER_SITUATIONS.map((value) => ({
  value,
  label: SITUATION_LABEL[value],
}));

function toSituation(value: string): CustomerSituation {
  return CUSTOMER_SITUATIONS.find((situation) => situation === value) ?? "todas";
}

/** URL da lista com os filtros; sem `page` — filtro novo volta à página 1. */
function customersHref(
  pathname: string,
  { q, situacao }: { q: string; situacao: CustomerSituation }
): string {
  const search = new URLSearchParams();
  if (q) search.set("q", q);
  if (situacao !== "todas") search.set("situacao", situacao);
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function customerHref(customer: CustomerListItem): string {
  return `/app/clientes/${customer.id}`;
}

/**
 * Lista de empresas. A URL é a fonte da verdade (`q`, `situacao`, `page`): o
 * servidor filtra e pagina, e esta tela só escreve a URL — não há filtro local
 * repetindo o do servidor, que divergiria dele fora da página em tela.
 *
 * Nenhum valor de contrato aqui: a lista lê só customers, e o selo é o
 * `contract_status` que o banco deriva.
 */
export function CustomersTable({
  page,
  params,
  actions,
}: {
  page: CustomersPage;
  params: CustomerListParams;
  /** Ação primária da barra ("Nova empresa"). */
  actions?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNavigation] = useTransition();
  // O Select mostra a escolha na hora; a URL confirma quando a lista chega.
  const [situation, setOptimisticSituation] = useOptimistic(params.situacao);

  const [searchQuery, setSearchQuery] = useState(params.q);
  // Último termo que ESTA tela pediu à URL.
  const [requestedQuery, setRequestedQuery] = useState(params.q);
  // A URL mudou. Se foi esta tela que pediu, o campo já mostra isso (ou algo
  // mais novo que a pessoa continuou digitando) e não é tocado. Se veio de
  // fora — "Clientes" no menu, voltar do navegador —, o campo segue a URL; sem
  // isso, a busca antiga voltaria para a URL 300ms depois. Ajuste durante o
  // render, mesmo padrão do primitivo `Dialog`.
  const [urlQuery, setUrlQuery] = useState(params.q);
  if (params.q !== urlQuery) {
    setUrlQuery(params.q);
    if (params.q !== requestedQuery) {
      setSearchQuery(params.q);
      setRequestedQuery(params.q);
    }
  }

  function navigate(next: { q: string; situacao: CustomerSituation }) {
    setRequestedQuery(next.q);
    startNavigation(() => {
      setOptimisticSituation(next.situacao);
      router.replace(customersHref(pathname, next), { scroll: false });
    });
  }

  // O termo vai para a URL (é o servidor que pagina), mas só depois da pausa de
  // digitação — sem isso cada tecla viraria uma navegação.
  useEffect(() => {
    const query = searchQuery.trim();
    if (query === requestedQuery) return;

    const timeout = window.setTimeout(() => {
      setRequestedQuery(query);
      startNavigation(() => {
        // `situation`, não a URL: um filtro escolhido agora e ainda a caminho
        // não é desfeito pela busca que chega depois dele.
        router.replace(customersHref(pathname, { q: query, situacao: situation }), {
          scroll: false,
        });
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [pathname, requestedQuery, router, searchQuery, situation]);

  function clearFilters() {
    setSearchQuery("");
    navigate({ q: "", situacao: "todas" });
  }

  function retry() {
    startNavigation(() => router.refresh());
  }

  // Linha inteira clicável no desktop. O nome é o link de verdade (teclado,
  // leitor de tela, abrir em nova aba); o resto da linha é atalho de mouse.
  function openFromRow(event: MouseEvent<HTMLTableRowElement>, href: string) {
    if (event.target instanceof Element && event.target.closest("a, button")) return;
    // Arrastar para copiar o CNPJ também termina num clique: não navega.
    if (window.getSelection()?.toString()) return;
    router.push(href);
  }

  const situationActive = Number(situation !== "todas");
  const activeCount = situationActive + Number(searchQuery.trim() !== "");
  // O que a lista em tela reflete é a URL, não o que ainda está sendo digitado.
  const filtered = params.q !== "" || params.situacao !== "todas";
  const { items, total } = page;

  const countLabel = page.failed
    ? ""
    : filtered
      ? `${total} ${total === 1 ? "empresa encontrada" : "empresas encontradas"}`
      : `${total} ${total === 1 ? "empresa" : "empresas"}`;

  let content: ReactNode;
  if (page.failed) {
    content = (
      <EmptyState>
        <span className="flex flex-col items-center gap-3">
          <span>Não foi possível carregar as empresas.</span>
          <Button
            type="button"
            variant="outline"
            onClick={retry}
            disabled={navigating}
            className="h-11 sm:h-9"
          >
            <RotateCwIcon data-icon="inline-start" className={cn(navigating && "animate-spin")} />
            Tentar de novo
          </Button>
        </span>
      </EmptyState>
    );
  } else if (items.length === 0 && !filtered) {
    // ⚠️ A barra continua acima: vazio é justamente onde "Nova empresa"
    // precisa estar (UI.md §5.1).
    content = (
      <EmptyState>
        <span className="flex flex-col items-center gap-3">
          <span>Nenhuma empresa cadastrada.</span>
          {actions}
        </span>
      </EmptyState>
    );
  } else if (items.length === 0) {
    content = (
      <EmptyState>
        <span className="flex flex-col items-center gap-3">
          <span>Nenhuma empresa encontrada.</span>
          <Button type="button" variant="outline" onClick={clearFilters} className="h-11 sm:h-9">
            <XIcon data-icon="inline-start" />
            Limpar filtros
          </Button>
        </span>
      </EmptyState>
    );
  } else {
    content = (
      // Linha = cartão, como na Equipe (UI.md §3.3): o leito tingido é o que
      // faz o cartão branco existir.
      <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/20 shadow-soft">
        <div className="hidden px-2 pb-2 md:block">
          <Table variant="cards" className="table-fixed">
            <TableHeader>
              <TableRow variant="cards-header">
                <TableHead className="pl-3 sm:pl-4">Empresa</TableHead>
                <TableHead className="w-48">CNPJ</TableHead>
                <TableHead className="w-44">Contrato</TableHead>
                <TableHead className="w-32 pr-4 text-right">Cadastrada em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((customer) => {
                const href = customerHref(customer);
                return (
                  <TableRow
                    key={customer.id}
                    variant="card"
                    onClick={(event) => openFromRow(event, href)}
                    className="cursor-pointer"
                  >
                    <TableCell className="max-w-0 py-3 pl-3 sm:pl-4">
                      <CustomerIdentity customer={customer} href={href} />
                    </TableCell>
                    <TableCell className="py-3 font-mono text-xs tabular-nums">
                      {customer.cnpj ? formatCnpj(customer.cnpj) : <NoData />}
                    </TableCell>
                    <TableCell className="max-w-0 py-3">
                      <ContractStatusBadge status={customer.contract_status} />
                    </TableCell>
                    <TableCell className="py-3 pr-4 text-right text-sm tabular-nums text-muted-foreground">
                      {formatDate(customer.created_at)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* No celular a lista é uma pilha de cartões; o cartão inteiro é o link. */}
        <div className="grid gap-2 p-2 md:hidden">
          {items.map((customer) => (
            <article
              key={customer.id}
              // ⚠️ Grid sem coluna declarada gera trilha implícita com piso no
              // min-content, e o cartão fica mais largo que o celular. O
              // `<article>` não tem `overflow-hidden`, então quem recorta é o
              // painel de fora — o efeito visível é a data de cadastro sumindo
              // na borda. `grid-cols-[minmax(0,1fr)]` é o remédio.
              className="relative grid min-h-16 w-full grid-cols-[minmax(0,1fr)] gap-2 rounded-xl border border-border/70 bg-card px-4 py-3 transition-colors hover:bg-muted/40"
            >
              {/* ⚠️ `min-w-0` porque a linha é item de grid: `min-width: auto` só
                  vira 0 quando a trilha não tem mínimo `auto`, e depender dessa
                  sutileza deixou o texto estourando no Safari mesmo com o
                  cartão já certo. */}
              <div className="flex min-w-0 items-start justify-between gap-3">
                <CustomerIdentity customer={customer} href={customerHref(customer)} stretched />
                <div className="min-w-0 max-w-[50%] shrink-0 text-right">
                  <ContractStatusBadge status={customer.contract_status} />
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="min-w-0 truncate font-mono tabular-nums">
                  {customer.cnpj ? formatCnpj(customer.cnpj) : "Sem CNPJ"}
                </span>
                <span className="shrink-0 tabular-nums">
                  Cadastrada em {formatDate(customer.created_at)}
                </span>
              </div>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="customers-title" className="space-y-3">
      <div>
        <h1 id="customers-title" className="font-display text-2xl font-semibold tracking-tight">
          Clientes
        </h1>
        {/* `aria-live`: o número é a única confirmação de que a busca pegou
            para quem não vê a lista. */}
        <p aria-live="polite" className="min-h-5 text-sm tabular-nums text-muted-foreground">
          {countLabel}
        </p>
      </div>

      <DataToolbar>
        <ToolbarSearch
          aria-label="Buscar empresa por nome ou CNPJ"
          placeholder="Buscar por nome ou CNPJ…"
          autoComplete="off"
          maxLength={SEARCH_MAX_LENGTH}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <FilterButton activeCount={situationActive}>
            <FilterField label="Situação">
              <FormSelect
                aria-label="Situação"
                value={situation}
                onValueChange={(value) =>
                  navigate({ q: searchQuery.trim(), situacao: toSituation(value) })
                }
                options={SITUATION_OPTIONS}
              />
            </FilterField>
          </FilterButton>
          <ActiveFilters count={activeCount} onClear={clearFilters} />
          {actions}
        </div>
      </DataToolbar>

      <div
        aria-busy={navigating || undefined}
        className={cn(
          "transition-opacity motion-reduce:transition-none",
          navigating && "opacity-60"
        )}
      >
        {content}
      </div>
    </section>
  );
}

/**
 * Nome de exibição (fantasia, ou a razão social) e, abaixo, a razão social
 * quando ela é outra. `stretched` estica o link por cima do cartão inteiro.
 */
function CustomerIdentity({
  customer,
  href,
  stretched = false,
}: {
  customer: CustomerListItem;
  href: string;
  stretched?: boolean;
}) {
  const name = customerDisplayName(customer);

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={href}
          title={name}
          className={cn(
            "min-w-0 truncate rounded-sm font-semibold outline-none underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
            stretched &&
              "after:absolute after:inset-0 after:rounded-xl hover:no-underline focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
          )}
        >
          {name}
        </Link>
        {customer.archived_at ? (
          <Badge variant="outline" className="shrink-0 text-muted-foreground">
            Arquivada
          </Badge>
        ) : null}
      </div>
      {name !== customer.legal_name ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={customer.legal_name}>
          {customer.legal_name}
        </p>
      ) : null}
    </div>
  );
}

function NoData() {
  return <span className="text-muted-foreground">—</span>;
}

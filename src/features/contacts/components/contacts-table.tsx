"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRightIcon,
  Building2Icon,
  ChevronRightIcon,
  CopyIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  UnlinkIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { AvatarInitials } from "@/components/data-display/avatar-initials";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";
import { useStartConversation } from "@/features/chat/hooks/use-start-conversation";
import { LinkCustomerDialog } from "@/features/contacts/components/link-customer-dialog";
import { linkContactToCustomer } from "@/features/contacts/lib/link-customer";
import {
  CONTACT_COMPANY_FILTERS,
  type ContactCompanyFilter,
  type ContactListItem,
  type ContactListParams,
  type ContactsPage,
} from "@/features/contacts/types";
import { ContractStatusBadge } from "@/features/contracts/components/contract-status-badge";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import type { CustomerSummary } from "@/features/customers/types";
import { formatDateTime } from "@/lib/formatters/date";
import { formatPhone } from "@/lib/formatters/phone";
import { cn } from "@/lib/utils";

const BASE_PATH = "/app/contatos";
const SEARCH_DEBOUNCE_MS = 300;
// Mesmo teto de parseContactListParams: o que passa disso o servidor corta.
const MAX_QUERY_LENGTH = 100;

const COMPANY_FILTER_OPTIONS: ReadonlyArray<{ value: ContactCompanyFilter; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "com", label: "Com empresa" },
  { value: "sem", label: "Sem empresa" },
];

function toCompanyFilter(value: string): ContactCompanyFilter {
  return CONTACT_COMPANY_FILTERS.find((filter) => filter === value) ?? "todos";
}

/** URL da lista com os filtros; `page` sempre sai — filtro novo volta à página 1. */
function contactsHref(q: string, empresa: ContactCompanyFilter): string {
  const search = new URLSearchParams();
  if (q) search.set("q", q);
  if (empresa !== "todos") search.set("empresa", empresa);
  const query = search.toString();
  return query ? `${BASE_PATH}?${query}` : BASE_PATH;
}

function contactName(contact: ContactListItem): string | null {
  return contact.name?.trim() || null;
}

/** Como o contato é chamado em rótulos e mensagens: o nome, ou o telefone. */
function contactLabel(contact: ContactListItem): string {
  return contactName(contact) ?? formatPhone(contact.phone);
}

/**
 * Lista de contatos. A página é do servidor (`count` + `range`) e a URL é a
 * fonte da verdade: busca e filtro viram `?q=` e `?empresa=`, e a tabela só
 * mostra o que o servidor devolveu — sem filtro local repetido por cima.
 *
 * Sem ação em massa: vincular é uma decisão por pessoa.
 */
export function ContactsTable({
  page,
  params,
}: {
  page: ContactsPage;
  params: ContactListParams;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { startConversation, checkingPhone } = useStartConversation();

  const currentHref = contactsHref(params.q, params.empresa);
  const [query, setQuery] = useState(params.q);
  const [empresa, setEmpresa] = useState<ContactCompanyFilter>(params.empresa);
  // Navegações pedidas por esta tela que a URL ainda não refletiu, em ordem.
  const [pushed, setPushed] = useState<string[]>([]);
  const [seenHref, setSeenHref] = useState(currentHref);

  // A URL mudou. Se foi esta tela que pediu, o campo já está certo — ou até à
  // frente, com o que a pessoa digitou enquanto a página carregava; sobrescrever
  // apagaria essas letras. Se veio de fora (o item "Contatos" do menu, com a
  // lista já aberta), o campo e o filtro acompanham a URL — senão a busca
  // abaixo empurraria a URL de volta para o termo antigo.
  if (currentHref !== seenHref) {
    setSeenHref(currentHref);
    const index = pushed.indexOf(currentHref);
    if (index >= 0) {
      setPushed(pushed.slice(index + 1));
    } else {
      setPushed([]);
      setQuery(params.q);
      setEmpresa(params.empresa);
    }
  }

  const navigate = useCallback(
    (href: string) => {
      setPushed((list) => [...list, href]);
      // Transição: `isPending` segura o `aria-busy` da lista até a página nova
      // chegar do servidor.
      startTransition(() => router.replace(href, { scroll: false }));
    },
    [router]
  );

  // Para onde a URL vai: a última navegação pedida, ou a atual.
  const targetHref = pushed.length > 0 ? pushed[pushed.length - 1] : currentHref;
  const desiredHref = contactsHref(query.trim(), empresa);

  // O termo vai para a URL só depois da pausa de digitação — sem isso cada
  // tecla viraria uma navegação.
  useEffect(() => {
    if (desiredHref === targetHref) return;
    const timeout = window.setTimeout(() => navigate(desiredHref), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [desiredHref, navigate, targetHref]);

  function changeCompanyFilter(value: string) {
    const next = toCompanyFilter(value);
    setEmpresa(next);
    const href = contactsHref(query.trim(), next);
    if (href !== targetHref) navigate(href);
  }

  function clearFilters() {
    setQuery("");
    setEmpresa("todos");
    if (targetHref !== BASE_PATH) navigate(BASE_PATH);
  }

  function retry() {
    startTransition(() => router.refresh());
  }

  // Dois estados, `linkOpen` e o contato: fechar não zera o contato, senão o
  // conteúdo do diálogo sumiria no meio da animação de saída.
  const [linkTarget, setLinkTarget] = useState<ContactListItem | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  function openLink(contact: ContactListItem) {
    setLinkTarget(contact);
    setLinkOpen(true);
  }

  // Desvincular é reversível (é só vincular de novo): sem confirmação.
  async function unlink(contact: ContactListItem) {
    const customer = contact.customer;
    if (!customer || unlinkingId) return;
    setUnlinkingId(contact.id);
    const result = await linkContactToCustomer(contact.id, null);
    setUnlinkingId(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Contato desvinculado de ${customerDisplayName(customer)}.`);
    startTransition(() => router.refresh());
  }

  async function copyPhone(phone: string) {
    try {
      await navigator.clipboard.writeText(phone);
      toast.success("Telefone copiado.");
    } catch {
      toast.error("Não foi possível copiar o telefone.");
    }
  }

  const filtered = params.q !== "" || params.empresa !== "todos";
  const activeFilterCount = Number(empresa !== "todos");
  const { items, total } = page;

  let countText = "";
  if (!page.failed) {
    countText = filtered
      ? `${total} ${total === 1 ? "contato encontrado" : "contatos encontrados"}`
      : `${total} ${total === 1 ? "contato" : "contatos"}`;
  }

  const rowActions = (contact: ContactListItem) => (
    <div className="flex shrink-0 items-center justify-end gap-1">
      <OpenChatButton
        contact={contact}
        pending={checkingPhone === contact.phone}
        disabled={checkingPhone !== null}
        onOpen={() => void startConversation(contact.phone, contactName(contact) ?? undefined)}
      />
      <ContactRowMenu
        contact={contact}
        unlinking={unlinkingId === contact.id}
        onLink={() => openLink(contact)}
        onUnlink={() => void unlink(contact)}
        onCopyPhone={() => void copyPhone(contact.phone)}
      />
    </div>
  );

  return (
    <section aria-labelledby="contacts-title" className="space-y-3">
      <div>
        <h1 id="contacts-title" className="font-display text-2xl font-semibold tracking-tight">
          Contatos
        </h1>
        <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground tabular-nums">
          {countText}
        </p>
      </div>

      {/* A barra nunca some: nem na base vazia, nem na lista que falhou. */}
      <DataToolbar>
        <ToolbarSearch
          type="search"
          enterKeyHint="search"
          aria-label="Buscar contato por nome ou telefone"
          placeholder="Nome ou telefone"
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_QUERY_LENGTH}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <FilterButton activeCount={activeFilterCount}>
            <FilterField label="Empresa">
              <FormSelect
                aria-label="Filtrar por empresa"
                value={empresa}
                onValueChange={changeCompanyFilter}
                options={COMPANY_FILTER_OPTIONS}
              />
            </FilterField>
          </FilterButton>
          <ActiveFilters
            count={activeFilterCount + Number(query.trim() !== "")}
            onClear={clearFilters}
          />
        </div>
      </DataToolbar>

      <div
        aria-busy={isPending || undefined}
        className={cn("transition-opacity", isPending && "opacity-60")}
      >
        {page.failed ? (
          <EmptyState>
            <span className="flex flex-col items-center gap-3">
              <span>Não foi possível carregar os contatos.</span>
              <Button
                type="button"
                variant="outline"
                onClick={retry}
                disabled={isPending}
                className="h-11 sm:h-9"
              >
                {isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
                Tentar de novo
              </Button>
            </span>
          </EmptyState>
        ) : items.length === 0 ? (
          <EmptyState>
            {filtered ? (
              <span className="flex flex-col items-center gap-3">
                <span>Nenhum contato encontrado.</span>
                <Button type="button" variant="outline" onClick={clearFilters} className="h-11 sm:h-9">
                  <XIcon data-icon="inline-start" />
                  Limpar
                </Button>
              </span>
            ) : (
              "Nenhum contato ainda. Contatos nascem quando alguém escreve no WhatsApp."
            )}
          </EmptyState>
        ) : (
          // Linha = cartão (UI.md §3.3). O leito tingido é o que faz o cartão
          // branco existir, na tabela e na pilha do celular.
          <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/20 shadow-soft">
            <div className="hidden px-2 pb-2 md:block">
              <Table variant="cards" className="table-fixed">
                <TableHeader>
                  <TableRow variant="cards-header">
                    <TableHead className="pl-3 sm:pl-4">Contato</TableHead>
                    <TableHead className="w-40">Telefone</TableHead>
                    <TableHead className="w-[30%]">Empresa</TableHead>
                    <TableHead className="hidden w-40 lg:table-cell">Última mensagem</TableHead>
                    <TableHead className="w-28">
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((contact) => (
                    <TableRow
                      key={contact.id}
                      variant="card"
                      className={cn(unlinkingId === contact.id && "opacity-60")}
                    >
                      <TableCell className="max-w-0 py-3 pl-3 sm:pl-4">
                        <ContactIdentity contact={contact} />
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">{formatPhone(contact.phone)}</TableCell>
                      <TableCell className="max-w-0 py-3">
                        <CustomerCell customer={contact.customer} />
                      </TableCell>
                      <TableCell className="hidden text-sm tabular-nums text-muted-foreground lg:table-cell">
                        {contact.last_message_at ? formatDateTime(contact.last_message_at) : "—"}
                      </TableCell>
                      <TableCell className="pr-2">{rowActions(contact)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-2 p-2 md:hidden">
              {items.map((contact) => (
                <article
                  key={contact.id}
                  // ⚠️ `grid-cols-[minmax(0,1fr)]` NÃO é enfeite: grid sem
                  // coluna declarada cria trilha implícita `auto`, com piso no
                  // min-content do conteúdo. Com `truncate` (nowrap), selo
                  // `shrink-0` e botões de 44px, a trilha passa da largura do
                  // celular e o texto vaza em vez de truncar.
                  className={cn(
                    "grid w-full grid-cols-[minmax(0,1fr)] gap-2 rounded-xl border border-border/70 bg-card px-4 py-3",
                    unlinkingId === contact.id && "opacity-60"
                  )}
                >
                  {/* ⚠️ `min-w-0` também nas linhas do cartão: são itens de
                      grid, e `min-width: auto` só vira 0 quando a trilha não
                      tem mínimo `auto`. Depender dessa sutileza deixou texto
                      estourando no Safari do iPhone com o cartão já certo. */}
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <ContactIdentity contact={contact} showPhone />
                    {rowActions(contact)}
                  </div>
                  <MobileCustomerRow customer={contact.customer} />
                  <p className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">
                    Última mensagem{" "}
                    {contact.last_message_at ? formatDateTime(contact.last_message_at) : "—"}
                  </p>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>

      <LinkCustomerDialog contact={linkTarget} open={linkOpen} onOpenChange={setLinkOpen} />
    </section>
  );
}

function ContactIdentity({
  contact,
  showPhone = false,
}: {
  contact: ContactListItem;
  showPhone?: boolean;
}) {
  const name = contactName(contact);
  return (
    // Pessoa antes de dado: a inicial dá âncora para varrer a lista. Tom neutro
    // — matiz por pessoa seria decoração sem significado (UI.md §9).
    <div className="flex min-w-0 items-center gap-3">
      <AvatarInitials name={name} />
      <div className="min-w-0">
        <p className={cn("truncate text-sm", name ? "font-medium" : "text-muted-foreground")}>
          {name ?? "Sem nome"}
        </p>
        {showPhone ? (
          <p className="truncate text-xs text-muted-foreground tabular-nums">
            {formatPhone(contact.phone)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ArchivedBadge() {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Arquivada
    </Badge>
  );
}

function CustomerCell({ customer }: { customer: CustomerSummary | null }) {
  if (!customer) return <span className="text-sm text-muted-foreground">—</span>;
  const name = customerDisplayName(customer);
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
      <Link
        href={`/app/clientes/${customer.id}`}
        title={name}
        className="truncate text-sm font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {name}
      </Link>
      {/* O selo é `shrink-0` no primitivo: o `div min-w-0` é quem deixa o
          texto dele truncar numa coluna estreita (UI.md §5.6.1). */}
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="min-w-0">
          <ContractStatusBadge status={customer.contract_status} />
        </div>
        {customer.archived_at ? <ArchivedBadge /> : null}
      </div>
    </div>
  );
}

function MobileCustomerRow({ customer }: { customer: CustomerSummary | null }) {
  if (!customer) {
    return <p className="text-sm text-muted-foreground">Sem empresa</p>;
  }
  const name = customerDisplayName(customer);
  return (
    // A linha inteira é o link da ficha: alvo de 44px no toque.
    <Link
      href={`/app/clientes/${customer.id}`}
      className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg bg-muted/40 px-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Building2Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
      <span className="flex min-w-0 max-w-[55%] items-center gap-1.5">
        <span className="min-w-0">
          <ContractStatusBadge status={customer.contract_status} />
        </span>
        {customer.archived_at ? <ArchivedBadge /> : null}
      </span>
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function OpenChatButton({
  contact,
  pending,
  disabled,
  onOpen,
}: {
  contact: ContactListItem;
  pending: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      aria-busy={pending || undefined}
      aria-label={`Conversar com ${contactLabel(contact)} no WhatsApp`}
      title="Conversar no WhatsApp"
      // Círculo verde: a cor da própria marca diz o que o botão faz, e o
      // círculo marca ação de contato, não item de barra (UI.md §3.3).
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 outline-none transition-colors hover:bg-emerald-500/20 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 sm:size-9 dark:text-emerald-400"
    >
      {pending ? (
        <Loader2Icon aria-hidden className="size-4 animate-spin" />
      ) : (
        <WhatsAppIcon className="size-[18px]" />
      )}
    </button>
  );
}

function ContactRowMenu({
  contact,
  unlinking,
  onLink,
  onUnlink,
  onCopyPhone,
}: {
  contact: ContactListItem;
  unlinking: boolean;
  onLink: () => void;
  onUnlink: () => void;
  onCopyPhone: () => void;
}) {
  const linked = contact.customer !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={unlinking}
            aria-busy={unlinking || undefined}
            className="size-11 text-muted-foreground sm:size-8"
            aria-label={`Ações de ${contactLabel(contact)}`}
          />
        }
      >
        {unlinking ? <Loader2Icon className="animate-spin" /> : <MoreHorizontalIcon />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 p-1.5">
        <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={onLink}>
          {linked ? <ArrowLeftRightIcon /> : <Building2Icon />}
          {linked ? "Trocar empresa" : "Vincular à empresa"}
        </DropdownMenuItem>
        {linked ? (
          <DropdownMenuItem variant="destructive" className="min-h-11 sm:min-h-8" onClick={onUnlink}>
            <UnlinkIcon />
            Desvincular
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={onCopyPhone}>
          <CopyIcon />
          Copiar telefone
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

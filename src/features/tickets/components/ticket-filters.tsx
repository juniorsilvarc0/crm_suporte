"use client";

import { FilterField } from "@/components/data-display/data-toolbar";
import { FormSelect } from "@/components/forms/form-select";
import { ticketStatusLabel } from "@/features/tickets/lib/ticket-actions";
import type { TicketListFilters } from "@/features/tickets/lib/ticket-list-url";
import {
  isTicketPriority,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABEL,
} from "@/features/tickets/lib/ticket-priority";
import { isTicketStatus, TICKET_STATUS_KEYS } from "@/features/tickets/lib/ticket-status";
import {
  TICKET_LIST_ORDERS,
  TICKET_LIST_SLA_FILTERS,
  TICKET_LIST_STATUS_GROUPS,
  type TicketListItem,
  type TicketListOrder,
  type TicketListSlaFilter,
  type TicketListStatusFilter,
  type TicketListStatusGroup,
  type TicketStatusOption,
} from "@/features/tickets/types";

// O painel "Filtros" e a ordem da lista /app/tickets. Só lê e devolve valores
// da allowlist de parseTicketListParams: quem escreve a URL é a lista.

/** Quem pode ser filtrado como responsável. A página manda só id, nome e se está ativo. */
export type TicketFilterUser = { id: string; name: string; is_active: boolean };

/** Fila oferecida no filtro (as ativas do catálogo). */
export type TicketFilterQueue = { id: string; name: string };

type Option = { value: string; label: string };

const STATUS_GROUP_LABEL: Record<TicketListStatusGroup, string> = {
  ativos: "Ativos",
  todos: "Todos",
  encerrados: "Encerrados",
  resolvidos: "Resolvidos",
  pendentes: "Pendentes",
};

const SLA_FILTER_LABEL: Record<TicketListSlaFilter, string> = {
  estourado: "Estourado",
  risco: "Em risco",
  pausado: "Pausado",
};

const ORDER_LABEL: Record<TicketListOrder, string> = {
  prazo: "Por prazo",
  recentes: "Mais recentes",
  atualizados: "Atualizados por último",
};

const ORDER_OPTIONS: Option[] = TICKET_LIST_ORDERS.map((value) => ({
  value,
  label: ORDER_LABEL[value],
}));

// Da mais urgente para a menos: é a ordem em que se procura.
const PRIORITY_OPTIONS: Option[] = [...TICKET_PRIORITIES]
  .reverse()
  .map((value) => ({ value, label: TICKET_PRIORITY_LABEL[value] }));

const SLA_OPTIONS: Option[] = TICKET_LIST_SLA_FILTERS.map((value) => ({
  value,
  label: SLA_FILTER_LABEL[value],
}));

function isStatusGroup(value: string): value is TicketListStatusGroup {
  return TICKET_LIST_STATUS_GROUPS.some((group) => group === value);
}

function toStatusFilter(value: string): TicketListStatusFilter {
  return isStatusGroup(value) || isTicketStatus(value) ? value : "ativos";
}

function toSlaFilter(value: string): TicketListSlaFilter | null {
  return TICKET_LIST_SLA_FILTERS.find((filter) => filter === value) ?? null;
}

function toOrder(value: string): TicketListOrder {
  return TICKET_LIST_ORDERS.find((order) => order === value) ?? "prazo";
}

/**
 * O valor da URL que não está entre as opções (fila arquivada, responsável que
 * saiu da lista) entra como opção própria: sem isso o select mostraria o uuid.
 * O nome vem do que a própria página trouxe; sem ele, um rótulo genérico.
 */
function withCurrent(options: Option[], current: string | null, label: string | undefined, fallback: string) {
  if (!current || options.some((option) => option.value === current)) return options;
  return [...options, { value: current, label: label ?? fallback }];
}

/**
 * Status: os grupos e, depois, cada status com o rótulo do catálogo. O grupo
 * "resolvidos" é o mesmo recorte do status Resolvido, e "pendentes" é o recorte
 * da fila do Início (o "Ver todos" de lá): cada um só vira opção quando a URL o
 * traz, para a lista não oferecer duas vezes a mesma coisa.
 */
function statusOptions(statuses: TicketStatusOption[] | null, current: TicketListStatusFilter): Option[] {
  const groups: TicketListStatusGroup[] = ["ativos", "todos", "encerrados"];
  if (current === "resolvidos" || current === "pendentes") groups.push(current);
  return [
    ...groups.map((value) => ({ value, label: STATUS_GROUP_LABEL[value] })),
    ...TICKET_STATUS_KEYS.map((key) => ({ value: key, label: ticketStatusLabel(key, statuses) })),
  ];
}

function userOptions(users: readonly TicketFilterUser[], viewerId: string): Option[] {
  const others = users
    .filter((user) => user.id !== viewerId)
    .sort(
      (a, b) =>
        Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name, "pt-BR")
    );
  return others.map((user) => ({
    value: user.id,
    label: user.is_active ? user.name : `${user.name} (inativo)`,
  }));
}

/**
 * Campos do popover "Filtros": Status, Prioridade, Fila, Responsável e SLA.
 * Cada troca devolve só o campo que mudou; quem chama navega.
 */
export function TicketFilterFields({
  filters,
  onChange,
  statuses,
  queues,
  users,
  viewerId,
  items,
  protocolSearch,
}: {
  filters: TicketListFilters;
  onChange: (patch: Partial<TicketListFilters>) => void;
  statuses: TicketStatusOption[] | null;
  /** `null` = o catálogo de filas não carregou: sobram "Todas" e "Sem fila". */
  queues: TicketFilterQueue[] | null;
  /** `null` = a equipe não carregou: sobram "Eu" e "Sem responsável", com o aviso. */
  users: readonly TicketFilterUser[] | null;
  viewerId: string;
  /** Os tickets em tela: dão nome à fila e ao responsável da URL fora das opções. */
  items: readonly TicketListItem[];
  /** A busca é um protocolo: o servidor ignora o status. */
  protocolSearch: boolean;
}) {
  const queueName = items.find((item) => item.product?.id === filters.fila)?.product?.name;
  const assigneeName = items.find((item) => item.assignee?.id === filters.responsavel)?.assignee?.name;

  const queueOptions = withCurrent(
    [
      { value: "sem", label: "Sem fila" },
      ...(queues ?? []).map((queue) => ({ value: queue.id, label: queue.name })),
    ],
    filters.fila,
    queueName,
    "Outra fila"
  );
  const assigneeOptions = withCurrent(
    [
      { value: "eu", label: "Eu" },
      { value: "nenhum", label: "Sem responsável" },
      ...userOptions(users ?? [], viewerId),
    ],
    filters.responsavel,
    assigneeName,
    "Outro responsável"
  );

  return (
    <>
      <FilterField label="Status">
        <FormSelect
          aria-label="Status"
          value={filters.status}
          onValueChange={(value) => onChange({ status: toStatusFilter(value) })}
          options={statusOptions(statuses, filters.status)}
        />
        {protocolSearch ? (
          <p className="text-xs text-muted-foreground">A busca por protocolo ignora o status.</p>
        ) : null}
      </FilterField>
      <FilterField label="Prioridade">
        <FormSelect
          aria-label="Prioridade"
          value={filters.prioridade ?? ""}
          emptyLabel="Todas"
          onValueChange={(value) => onChange({ prioridade: isTicketPriority(value) ? value : null })}
          options={PRIORITY_OPTIONS}
        />
      </FilterField>
      <FilterField label="Fila">
        <FormSelect
          aria-label="Fila"
          value={filters.fila ?? ""}
          emptyLabel="Todas"
          onValueChange={(value) => onChange({ fila: value || null })}
          options={queueOptions}
        />
      </FilterField>
      <FilterField label="Responsável">
        <FormSelect
          aria-label="Responsável"
          value={filters.responsavel ?? ""}
          emptyLabel="Todos"
          onValueChange={(value) => onChange({ responsavel: value || null })}
          options={assigneeOptions}
        />
        {/* Sem a equipe, a lista curta não pode parecer "ninguém mais". */}
        {users === null ? (
          <p className="text-xs text-muted-foreground">
            Não foi possível carregar a equipe. Recarregue a página.
          </p>
        ) : null}
      </FilterField>
      <FilterField label="SLA">
        <FormSelect
          aria-label="SLA"
          value={filters.sla ?? ""}
          emptyLabel="Todos"
          onValueChange={(value) => onChange({ sla: toSlaFilter(value) })}
          options={SLA_OPTIONS}
        />
      </FilterField>
    </>
  );
}

/** A ordem da lista, na barra (UI.md §4.2: busca → filtros → ordenação → ações). */
export function TicketOrderSelect({
  value,
  onChange,
}: {
  value: TicketListOrder;
  onChange: (order: TicketListOrder) => void;
}) {
  return (
    <FormSelect
      aria-label="Ordenar por"
      value={value}
      onValueChange={(next) => onChange(toOrder(next))}
      options={ORDER_OPTIONS}
      className="w-auto min-w-44 sm:h-9"
    />
  );
}

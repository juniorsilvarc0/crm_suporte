"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  Building2Icon,
  CheckIcon,
  ContactRoundIcon,
  FolderTreeIcon,
  GaugeIcon,
  LayersIcon,
  Loader2Icon,
  LogInIcon,
  RotateCcwIcon,
  RotateCwIcon,
  UserRoundIcon,
} from "lucide-react";

import { AvatarInitials } from "@/components/data-display/avatar-initials";
import { CatalogCombobox } from "@/components/forms/catalog-combobox";
import type { CatalogOption } from "@/components/forms/catalog-options";
import { FormSelect } from "@/components/forms/form-select";
import { ModalShell } from "@/components/layout/modal-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DetailRow } from "@/features/contracts/components/contract-card";
import { ContractStatusBadge } from "@/features/contracts/components/contract-status-badge";
import { CustomerPicker } from "@/features/customers/components/customer-picker";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import type { CustomerSummary } from "@/features/customers/types";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { ticketUrl } from "@/features/tickets/components/ticket-detail-header";
import type { TicketMutation } from "@/features/tickets/hooks/use-ticket-mutation";
import { formatProtocol } from "@/features/tickets/lib/protocol";
import {
  isTicketPriority,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABEL,
} from "@/features/tickets/lib/ticket-priority";
import type {
  TicketCatalog,
  TicketCategoryOption,
  TicketChangeData,
  TicketDetail,
  TicketPriority,
  TicketSlaPolicy,
  TicketSource,
  TicketTeamMember,
} from "@/features/tickets/types";
import { formatPhone } from "@/lib/formatters/phone";
import { cn } from "@/lib/utils";

const PRIORITY_OPTIONS = TICKET_PRIORITIES.map((priority) => ({
  value: priority,
  label: TICKET_PRIORITY_LABEL[priority],
}));

// `busyId` do CustomerPicker que não é empresa nenhuma: trava a lista sem
// spinner em linha.
const REFRESHING_ID = "__refreshing__";

export type TicketDetailSidebarProps = {
  ticket: TicketDetail;
  catalog: Pick<TicketCatalog, "products" | "categories" | "priorities">;
  mutation: TicketMutation;
  /** Abre o diálogo "Atribuir" (o mesmo do menu ⋯ do cabeçalho). */
  onAssign: () => void;
};

/**
 * Minutos de SLA por extenso e exatos ("1 dia 4 h", "90 min" vira "1 h 30
 * min"): a dica não arredonda o prazo que o admin configurou.
 */
export function formatSlaMinutes(minutes: number): string {
  if (!Number.isSafeInteger(minutes) || minutes <= 0) return "";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return [
    days ? `${days} ${days === 1 ? "dia" : "dias"}` : null,
    hours ? `${hours} h` : null,
    rest ? `${rest} min` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Os prazos de uma prioridade, em minutos: o snapshot do ticket ou a política do catálogo. */
type SlaMinutes = Pick<TicketSlaPolicy, "first_response_minutes" | "resolution_minutes">;

/** A dica da prioridade: os prazos que a tela recebeu, sem inventar. */
export function prioritySlaHint(
  priority: TicketPriority,
  sla: SlaMinutes | null | undefined
): string | null {
  if (!sla) return null;
  const first = formatSlaMinutes(sla.first_response_minutes);
  const resolution = formatSlaMinutes(sla.resolution_minutes);
  if (!first || !resolution) return null;
  return `${TICKET_PRIORITY_LABEL[priority]}: 1ª resposta em até ${first} e solução em até ${resolution}, contadas da abertura.`;
}

/**
 * As categorias que o catálogo oferece para a fila (as da fila e as gerais),
 * com a subcategoria como "Mãe › Filha": o nome sozinho da filha é ambíguo e
 * não acha pela mãe na busca.
 */
export function categoryOptionsFor(
  categories: readonly TicketCategoryOption[],
  productId: string | null
): CatalogOption[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  return categories
    .filter((category) => category.product_id === null || category.product_id === productId)
    .flatMap((category) => {
      if (category.parent_id === null) return [{ id: category.id, name: category.name }];
      const parent = byId.get(category.parent_id);
      return parent ? [{ id: category.id, name: `${parent.name} › ${category.name}` }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function sourceLabel(source: TicketSource, creator: TicketDetail["creator"]): string {
  if (source === "ai") return "IA";
  if (source === "api") return "Integração";
  return creator ? `Equipe · ${creator.name}` : "Equipe · usuário removido";
}

function reopenedLabel(count: number): string {
  if (count === 0) return "Nenhuma";
  return count === 1 ? "1 vez" : `${count} vezes`;
}

/**
 * Lateral do detalhe (spec 4b): Empresa, Contato, Fila e Categoria,
 * Prioridade, Responsável, Origem e Reaberturas, no bloco de fatos da ficha
 * (`DetailRow`). A fila e a categoria ATUAIS vêm do próprio ticket, mesmo
 * arquivadas; o catálogo só oferece as ativas. Ticket encerrado é só leitura.
 */
export function TicketDetailSidebar({ ticket, catalog, mutation, onAssign }: TicketDetailSidebarProps) {
  const fieldId = useId();
  const editable = !ticket.is_terminal;
  const [classifying, setClassifying] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  // Rascunho da prioridade enquanto o PATCH e a releitura correm: o Select não
  // volta ao valor antigo no meio.
  const [priorityDraft, setPriorityDraft] = useState<TicketPriority | null>(null);
  const priority = priorityDraft ?? ticket.priority;
  // A dica é o SLA gravado no ticket (editar a política vale só para tickets
  // novos). O rascunho de OUTRA prioridade mostra a política do catálogo: é o
  // que o novo snapshot aplica.
  const priorityHint = prioritySlaHint(
    priority,
    priority === ticket.priority
      ? {
          first_response_minutes: ticket.sla_first_response_minutes,
          resolution_minutes: ticket.sla_resolution_minutes,
        }
      : catalog.priorities?.find((item) => item.priority === priority)
  );
  const canClassify = editable && catalog.products !== null && catalog.categories !== null;

  const queueArchived =
    ticket.product !== null &&
    catalog.products !== null &&
    !catalog.products.some((product) => product.id === ticket.product?.id);
  const categoryName = ticket.category
    ? (catalog.categories
        ? categoryOptionsFor(catalog.categories, ticket.product_id).find(
            (option) => option.id === ticket.category?.id
          )?.name
        : undefined) ?? ticket.category.name
    : null;

  function changePriority(value: string) {
    if (!isTicketPriority(value) || value === ticket.priority) return;
    setPriorityDraft(value);
    const label = TICKET_PRIORITY_LABEL[value];
    void mutation.run<TicketChangeData>(
      {
        key: "priority",
        url: ticketUrl(ticket.id),
        method: "PATCH",
        body: { version: ticket.version, priority: value },
      },
      {
        success: (data) => (data.changed ? `Prioridade alterada para ${label}.` : null),
        onSuccess: () => setPriorityDraft(null),
        onFailure: () => {
          setPriorityDraft(null);
          return false;
        },
      }
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-soft sm:p-5">
      <dl className="grid gap-4">
        <DetailRow icon={<Building2Icon />} label="Empresa">
          {ticket.customer ? (
            <div className="grid min-w-0 justify-items-start gap-1.5">
              <Link
                href={`/app/clientes/${encodeURIComponent(ticket.customer.id)}`}
                className="max-w-full break-words font-medium text-primary underline-offset-4 hover:underline"
              >
                {customerDisplayName(ticket.customer)}
              </Link>
              <div className="min-w-0 max-w-full">
                <ContractStatusBadge status={ticket.customer.contract_status} />
              </div>
            </div>
          ) : (
            <div className="grid min-w-0 justify-items-start gap-1.5">
              <span className="text-muted-foreground">Sem empresa</span>
              {editable ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={mutation.busy}
                  onClick={() => setCustomerOpen(true)}
                  className="h-11 sm:h-8"
                >
                  Definir empresa
                </Button>
              ) : null}
            </div>
          )}
        </DetailRow>

        <DetailRow icon={<ContactRoundIcon />} label="Contato">
          <span className={cn("block", !ticket.contact.name && "text-muted-foreground")}>
            {ticket.contact.name ?? "Sem nome"}
          </span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {formatPhone(ticket.contact.phone)}
          </span>
        </DetailRow>

        {classifying ? (
          <div className="grid min-w-0 gap-0.5">
            <dt className="sr-only">Fila e categoria</dt>
            <dd className="min-w-0">
              <ClassificationForm
                ticket={ticket}
                catalog={catalog}
                mutation={mutation}
                onClose={() => setClassifying(false)}
              />
            </dd>
          </div>
        ) : (
          <>
            <DetailRow icon={<LayersIcon />} label="Fila">
              {ticket.product ? (
                <span className="inline-flex max-w-full items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cn("size-2 shrink-0 rounded-full", getColorStyle(ticket.product.color).dot)}
                  />
                  <span className="min-w-0 break-words">{ticket.product.name}</span>
                  {queueArchived ? (
                    <span className="shrink-0 text-muted-foreground">(arquivada)</span>
                  ) : null}
                </span>
              ) : (
                <span className="text-muted-foreground">Sem fila</span>
              )}
            </DetailRow>
            <DetailRow icon={<FolderTreeIcon />} label="Categoria">
              {ticket.category ? (
                <span>
                  {categoryName}
                  {ticket.category.archived_at ? (
                    <span className="text-muted-foreground"> (arquivada)</span>
                  ) : null}
                </span>
              ) : (
                <span className="text-muted-foreground">Sem categoria</span>
              )}
              {canClassify ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={mutation.busy}
                  onClick={() => setClassifying(true)}
                  className="-ms-2 mt-1 flex h-11 px-2 text-primary sm:h-8"
                >
                  Alterar fila e categoria
                </Button>
              ) : null}
              {editable && !canClassify ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Não foi possível carregar as filas e categorias.
                </p>
              ) : null}
            </DetailRow>
          </>
        )}

        <DetailRow icon={<GaugeIcon />} label="Prioridade">
          {editable ? (
            <div className="grid gap-1.5">
              <FormSelect
                id={`${fieldId}-priority`}
                aria-label="Prioridade"
                aria-describedby={priorityHint ? `${fieldId}-priority-hint` : undefined}
                value={priority}
                options={PRIORITY_OPTIONS}
                disabled={mutation.busy}
                onValueChange={changePriority}
                className="sm:h-9"
              />
              {priorityHint ? (
                <p id={`${fieldId}-priority-hint`} className="text-xs text-muted-foreground">
                  {priorityHint}
                </p>
              ) : null}
            </div>
          ) : (
            TICKET_PRIORITY_LABEL[ticket.priority]
          )}
        </DetailRow>

        <DetailRow icon={<UserRoundIcon />} label="Responsável">
          <div className="flex min-w-0 items-center gap-2">
            {ticket.assignee ? (
              <>
                <AvatarInitials name={ticket.assignee.name} size="sm" />
                <span className="min-w-0 truncate" title={ticket.assignee.name}>
                  {ticket.assignee.name}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Sem responsável</span>
            )}
            {editable ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={mutation.busy}
                onClick={onAssign}
                aria-label={ticket.assignee ? "Alterar responsável" : "Atribuir responsável"}
                className="ms-auto h-11 shrink-0 px-2 text-primary sm:h-8"
              >
                {ticket.assignee ? "Alterar" : "Atribuir"}
              </Button>
            ) : null}
          </div>
        </DetailRow>

        <DetailRow icon={<LogInIcon />} label="Origem">
          {sourceLabel(ticket.source, ticket.creator)}
        </DetailRow>

        <DetailRow icon={<RotateCcwIcon />} label="Reaberturas">
          <span className="tabular-nums">{reopenedLabel(ticket.reopened_count)}</span>
        </DetailRow>
      </dl>

      {editable ? (
        <DefineCustomerDialog
          open={customerOpen}
          onOpenChange={setCustomerOpen}
          ticket={ticket}
          mutation={mutation}
        />
      ) : null}
    </div>
  );
}

/**
 * Fila e categoria, editadas juntas e gravadas com "Salvar": o combobox limpa
 * o valor quando a pessoa apaga o texto para buscar, e gravar a cada tecla
 * tiraria a fila do ticket no meio da busca. Trocar a fila limpa a categoria
 * NO MESMO PATCH (a categoria de uma fila não vale na outra; o banco recusaria).
 * A categoria vale só para a fila em que foi escolhida: derivada, e não
 * apagada, para que a fila vazia no meio da busca não a perca de vez.
 */
function ClassificationForm({
  ticket,
  catalog,
  mutation,
  onClose,
}: {
  ticket: TicketDetail;
  catalog: Pick<TicketCatalog, "products" | "categories">;
  mutation: TicketMutation;
  onClose: () => void;
}) {
  const fieldId = useId();
  const id = (part: string) => `${fieldId}-${part}`;
  const activeProducts = catalog.products ?? [];
  const [queue, setQueue] = useState<CatalogOption | null>(() =>
    ticket.product
      ? {
          id: ticket.product.id,
          name: ticket.product.name,
          color: ticket.product.color,
          archived: !activeProducts.some((product) => product.id === ticket.product?.id),
        }
      : null
  );
  const queueId = queue?.id ?? null;
  const categoryOptions = categoryOptionsFor(catalog.categories ?? [], queueId);
  const [category, setCategory] = useState<CatalogOption | null>(() =>
    ticket.category
      ? (categoryOptionsFor(catalog.categories ?? [], ticket.product_id).find(
          (option) => option.id === ticket.category?.id
        ) ?? {
          id: ticket.category.id,
          name: ticket.category.name,
          archived: ticket.category.archived_at !== null,
        })
      : null
  );
  // A fila para a qual a categoria foi escolhida; noutra fila, ela não vale.
  const [categoryQueueId, setCategoryQueueId] = useState(queueId);
  const effectiveCategory = categoryQueueId === queueId ? category : null;
  const saving = mutation.pendingKey === "classification";
  const queueChanged = queueId !== ticket.product_id;

  function pickCategory(option: CatalogOption | null) {
    setCategory(option);
    setCategoryQueueId(queueId);
  }

  function save() {
    const categoryId = effectiveCategory?.id ?? null;
    const body: Record<string, unknown> = {};
    if (queueChanged) {
      body.product_id = queueId;
      body.category_id = categoryId;
    } else if (categoryId !== ticket.category_id) {
      body.category_id = categoryId;
    }
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    void mutation.run<TicketChangeData>(
      {
        key: "classification",
        url: ticketUrl(ticket.id),
        method: "PATCH",
        body: { version: ticket.version, ...body },
      },
      {
        success: (data) => (data.changed ? "Fila e categoria atualizadas." : null),
        onSuccess: onClose,
        onFailure: (failure) => {
          if (failure.status === 409 || failure.status === 404) onClose();
          return false;
        },
      }
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={id("title")}
      aria-busy={saving}
      className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3"
    >
      <p id={id("title")} className="text-sm font-medium">
        Fila e categoria
      </p>
      <div className="grid gap-1.5">
        <label htmlFor={id("queue")} className="text-xs text-muted-foreground">
          Fila
        </label>
        <CatalogCombobox
          id={id("queue")}
          mode="single"
          options={activeProducts.map((product) => ({
            id: product.id,
            name: product.name,
            color: product.color,
          }))}
          value={queue}
          onChange={setQueue}
          placeholder="Sem fila"
          emptyText="Nenhuma fila ativa."
          triggerLabel="Abrir a lista de filas"
          disabled={saving}
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={id("category")} className="text-xs text-muted-foreground">
          Categoria
        </label>
        <CatalogCombobox
          id={id("category")}
          mode="single"
          options={categoryOptions}
          value={effectiveCategory}
          onChange={pickCategory}
          placeholder="Sem categoria"
          emptyText="Nenhuma categoria para esta fila."
          triggerLabel="Abrir a lista de categorias"
          describedBy={queueChanged ? id("category-hint") : undefined}
          disabled={saving}
        />
        {queueChanged ? (
          <p id={id("category-hint")} className="text-xs text-muted-foreground">
            Trocar a fila tira a categoria que não é dela.
          </p>
        ) : null}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onClose}
          className="h-11 sm:h-8"
        >
          Cancelar
        </Button>
        <Button type="button" disabled={mutation.busy} onClick={save} className="h-11 sm:h-8">
          {saving ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
          Salvar
        </Button>
      </div>
    </div>
  );
}

/**
 * "Definir empresa": o `CustomerPicker` (só empresas ativas) dentro de um
 * diálogo, gravando `customer_id` no PATCH do ticket. O banco liga o contrato
 * vigente da empresa junto.
 */
function DefineCustomerDialog({
  open,
  onOpenChange,
  ticket,
  mutation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: TicketDetail;
  mutation: TicketMutation;
}) {
  const pendingId = mutation.pendingKey?.startsWith("customer:")
    ? mutation.pendingKey.slice("customer:".length)
    : null;

  function handleOpenChange(next: boolean) {
    // Não fecha no meio do envio: a resposta ainda decide o que acontece.
    if (!next && pendingId) return;
    onOpenChange(next);
  }

  function pick(customer: CustomerSummary) {
    const name = customerDisplayName(customer);
    void mutation.run<TicketChangeData>(
      {
        key: `customer:${customer.id}`,
        url: ticketUrl(ticket.id),
        method: "PATCH",
        body: { version: ticket.version, customer_id: customer.id },
      },
      {
        success: (data) => (data.changed ? `Empresa definida: ${name}.` : null),
        onSuccess: () => onOpenChange(false),
        onFailure: (failure) => {
          if (failure.status === 409 || failure.status === 404) onOpenChange(false);
          return false;
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <ModalShell
        size="medium"
        title="Definir empresa"
        description={`${formatProtocol(ticket.number)} · ${ticket.title}`}
      >
        <CustomerPicker
          appearance="app"
          currentCustomerId={null}
          // Na releitura depois do PATCH o diálogo ainda está aberto e a tela
          // tem a versão velha: a lista trava inteira, sem spinner (o Atribuir
          // também trava por `mutation.busy`).
          busyId={pendingId ?? (mutation.busy ? REFRESHING_ID : null)}
          onPick={pick}
        />
      </ModalShell>
    </Dialog>
  );
}

/**
 * "Atribuir": a equipe ATIVA (quem está vendo primeiro, como "você") e "Tirar
 * o responsável". Um toque grava, com a versão que a tela tem; o mesmo
 * responsável de novo não é oferecido.
 */
export function TicketAssignDialog({
  open,
  onOpenChange,
  ticket,
  team,
  viewerId,
  mutation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: TicketDetail;
  /** `null` = a leitura da equipe falhou. */
  team: TicketTeamMember[] | null;
  viewerId: string;
  mutation: TicketMutation;
}) {
  const protocol = formatProtocol(ticket.number);
  const pendingId = mutation.pendingKey?.startsWith("assign:")
    ? mutation.pendingKey.slice("assign:".length)
    : null;
  const currentId = ticket.assignee?.id ?? null;
  const active = (team ?? []).filter((member) => member.is_active);
  const members = [
    ...active.filter((member) => member.id === viewerId),
    ...active.filter((member) => member.id !== viewerId),
  ];

  function handleOpenChange(next: boolean) {
    if (!next && pendingId) return;
    onOpenChange(next);
  }

  function assign(member: TicketTeamMember | null) {
    const message = !member
      ? `${protocol} ficou sem responsável.`
      : member.id === viewerId
        ? `${protocol} agora é seu.`
        : `${protocol} atribuído a ${member.name}.`;
    void mutation.run<TicketChangeData>(
      {
        key: `assign:${member?.id ?? "none"}`,
        url: ticketUrl(ticket.id, "assign"),
        method: "POST",
        body: { assignee_id: member?.id ?? null, version: ticket.version },
      },
      {
        success: (data) => (data.changed ? message : null),
        onSuccess: () => onOpenChange(false),
        onFailure: (failure) => {
          if (failure.status === 409 || failure.status === 404) onOpenChange(false);
          return false;
        },
      }
    );
  }

  const rowClass =
    "flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <ModalShell size="compact" title={`Atribuir ${protocol}`} description={ticket.title}>
        {team === null ? (
          <div className="grid justify-items-start gap-3 text-sm">
            <p className="text-muted-foreground">Não foi possível carregar a equipe.</p>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.refreshing}
              onClick={mutation.refresh}
              className="h-11 sm:h-9"
            >
              {mutation.refreshing ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : (
                <RotateCwIcon data-icon="inline-start" />
              )}
              Tentar de novo
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
              {members.map((member) => {
                const isCurrent = member.id === currentId;
                return (
                  <li key={member.id}>
                    <button
                      type="button"
                      disabled={isCurrent || pendingId !== null || mutation.busy}
                      onClick={() => assign(member)}
                      className={cn(rowClass, !isCurrent && "disabled:opacity-60")}
                    >
                      <AvatarInitials name={member.name} size="sm" />
                      <span className="min-w-0 flex-1 truncate">
                        {member.name}
                        {member.id === viewerId ? (
                          <span className="text-muted-foreground"> (você)</span>
                        ) : null}
                      </span>
                      {pendingId === member.id ? (
                        <Loader2Icon aria-hidden className="size-4 shrink-0 animate-spin" />
                      ) : isCurrent ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <CheckIcon aria-hidden className="size-4" />
                          Atual
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {currentId ? (
              <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
                <button
                  type="button"
                  disabled={pendingId !== null || mutation.busy}
                  onClick={() => assign(null)}
                  className={cn(rowClass, "justify-between text-destructive disabled:opacity-60")}
                >
                  Tirar o responsável
                  {pendingId === "none" ? (
                    <Loader2Icon aria-hidden className="size-4 shrink-0 animate-spin" />
                  ) : null}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </ModalShell>
    </Dialog>
  );
}

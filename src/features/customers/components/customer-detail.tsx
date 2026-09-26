"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  Loader2Icon,
  RotateCwIcon,
} from "lucide-react";
import { toast } from "sonner";

import { AvatarInitials } from "@/components/data-display/avatar-initials";
import { EmptyState } from "@/components/data-display/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";
import { useStartConversation } from "@/features/chat/hooks/use-start-conversation";
import { linkContactToCustomer } from "@/features/contacts/lib/link-customer";
import {
  ContractCard,
  ContractHistory,
  type ContractAdminContext,
} from "@/features/contracts/components/contract-card";
import { ContractFormDialog } from "@/features/contracts/components/contract-form-dialog";
import { ContractStatusBadge } from "@/features/contracts/components/contract-status-badge";
import type {
  AdminContractView,
  ContractView,
  SupportPlanOption,
} from "@/features/contracts/types";
import { CustomerFormDialog } from "@/features/customers/components/customer-form-dialog";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import type { CustomerContact, CustomerRecord } from "@/features/customers/types";
import type { ProductOption } from "@/features/products/types";
import { formatCnpj } from "@/lib/formatters/cnpj";
import { formatDate, formatDateTime } from "@/lib/formatters/date";
import { formatPhone } from "@/lib/formatters/phone";

type CustomerDetailBase = {
  customer: CustomerRecord;
  /** `null` = a leitura falhou: "não foi possível carregar", nunca "nenhum". */
  contacts: CustomerContact[] | null;
};

/**
 * União discriminada por papel, decidida NO SERVIDOR (a página). O ramo
 * "member" não tem valor nem dia de vencimento: o payload RSC dele nem carrega
 * os campos. Catálogos de produto e plano só descem para admin, que é quem
 * escreve contrato.
 */
export type CustomerDetailProps =
  | (CustomerDetailBase & {
      role: "member";
      contracts: ContractView[] | null;
    })
  | (CustomerDetailBase & {
      role: "admin";
      contracts: AdminContractView[] | null;
      products: ProductOption[];
      plans: SupportPlanOption[];
    });

// Vigente = ativo ou suspenso; o banco garante um só por empresa.
function isCurrent(contract: ContractView): boolean {
  return contract.status !== "encerrado";
}

/** Ficha da empresa: cabeçalho, contrato, histórico, contatos e observações. */
export function CustomerDetail(props: CustomerDetailProps) {
  const { customer, contacts } = props;

  return (
    <div className="space-y-6 lg:space-y-8">
      <CustomerHeader customer={customer} role={props.role} />

      <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <ContractsSection {...props} />
        </div>
        <div className="min-w-0 space-y-6">
          <ContactsSection contacts={contacts} />
          <Section title="Observações">
            <div className="rounded-xl border border-border/60 bg-card p-4 text-sm shadow-soft">
              {customer.notes ? (
                <p className="whitespace-pre-wrap break-words">{customer.notes}</p>
              ) : (
                <p className="text-muted-foreground">Sem observações.</p>
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function CustomerHeader({
  customer,
  role,
}: {
  customer: CustomerRecord;
  role: "admin" | "member";
}) {
  const router = useRouter();
  const fieldId = useId();
  const id = (part: string) => `${fieldId}-${part}`;
  const [pending, setPending] = useState<"archive" | "restore" | null>(null);
  // Arquivar pede dois cliques no próprio botão: o primeiro arma, o segundo
  // grava. Sair do botão desarma.
  const [archiveArmed, setArchiveArmed] = useState(false);

  const name = customerDisplayName(customer);
  const archived = customer.archived_at !== null;
  // O selo vem do contrato (trigger no banco); o banco recusa arquivar com
  // contrato vigente, e a tela diz o porquê antes do clique.
  const hasCurrentContract =
    customer.contract_status === "ativo" || customer.contract_status === "suspenso";
  const subtitle = [
    customer.trade_name ? customer.legal_name : null,
    customer.cnpj ? formatCnpj(customer.cnpj) : "Sem CNPJ",
  ]
    .filter(Boolean)
    .join(" · ");

  async function mutate(action: "archive" | "restore") {
    if (pending) return;
    setPending(action);
    const failure =
      action === "archive"
        ? "Não foi possível arquivar a empresa."
        : "Não foi possível reativar a empresa.";
    try {
      const response = await fetch(
        action === "archive"
          ? `/api/customers/${customer.id}`
          : `/api/customers/${customer.id}/restore`,
        { method: action === "archive" ? "DELETE" : "POST" }
      );
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? failure);
        return;
      }
      toast.success(
        result.message ?? (action === "archive" ? "Empresa arquivada." : "Empresa reativada.")
      );
      router.refresh();
    } catch {
      toast.error(failure);
    } finally {
      setPending(null);
      setArchiveArmed(false);
    }
  }

  const reasons: { id: string; text: string }[] = [];
  if (archived) {
    reasons.push({
      id: id("edit-reason"),
      text:
        role === "admin"
          ? "Empresa arquivada: reative para editar."
          : "Empresa arquivada: só um administrador pode reativá-la.",
    });
  } else if (role === "admin" && hasCurrentContract) {
    reasons.push({
      id: id("archive-reason"),
      text: "Encerre o contrato vigente antes de arquivar.",
    });
  }

  return (
    <header className="space-y-3">
      <Link
        href="/app/clientes"
        className="-ms-2 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        Clientes
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="break-words font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {name}
          </h1>
          <p className="mt-1 break-words text-sm text-muted-foreground tabular-nums">{subtitle}</p>
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
            <div className="min-w-0">
              <ContractStatusBadge status={customer.contract_status} />
            </div>
            {archived ? (
              <Badge variant="outline" className="text-muted-foreground">
                Arquivada em {formatDate(customer.archived_at)}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2 lg:items-end">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <CustomerFormDialog customer={customer} disabled={archived} />
            {role === "admin" && archived ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending !== null}
                onClick={() => void mutate("restore")}
                className="h-11 sm:h-9"
              >
                {pending === "restore" ? (
                  <Loader2Icon className="animate-spin" data-icon="inline-start" />
                ) : (
                  <ArchiveRestoreIcon data-icon="inline-start" />
                )}
                Reativar
              </Button>
            ) : null}
            {role === "admin" && !archived ? (
              <Button
                type="button"
                variant={archiveArmed ? "destructive" : "outline"}
                disabled={hasCurrentContract || pending !== null}
                aria-describedby={
                  hasCurrentContract
                    ? id("archive-reason")
                    : archiveArmed
                      ? id("archive-hint")
                      : undefined
                }
                onClick={() => (archiveArmed ? void mutate("archive") : setArchiveArmed(true))}
                onBlur={() => {
                  if (pending === null) setArchiveArmed(false);
                }}
                className="h-11 sm:h-9"
              >
                {pending === "archive" ? (
                  <Loader2Icon className="animate-spin" data-icon="inline-start" />
                ) : (
                  <ArchiveIcon data-icon="inline-start" />
                )}
                {archiveArmed ? "Confirmar arquivamento" : "Arquivar"}
              </Button>
            ) : null}
          </div>

          {reasons.map((reason) => (
            <p key={reason.id} id={reason.id} className="text-xs text-muted-foreground lg:text-right">
              {reason.text}
            </p>
          ))}
          <p
            id={id("archive-hint")}
            aria-live="polite"
            className="text-xs text-muted-foreground lg:text-right"
          >
            {archiveArmed
              ? "Clique de novo para arquivar. Contatos e contratos continuam ligados à empresa."
              : ""}
          </p>
        </div>
      </div>
    </header>
  );
}

function ContractsSection(props: CustomerDetailProps) {
  const router = useRouter();
  const reasonId = useId();
  const { customer } = props;
  const archived = customer.archived_at !== null;

  if (props.contracts === null) {
    return (
      <Section title="Contrato">
        <EmptyState>
          <div className="grid justify-items-center gap-3">
            <p>Não foi possível carregar os contratos.</p>
            <RetryButton onRetry={() => router.refresh()} />
          </div>
        </EmptyState>
      </Section>
    );
  }

  if (props.role === "admin") {
    const context: ContractAdminContext = {
      customerId: customer.id,
      customerName: customerDisplayName(customer),
      products: props.products,
      plans: props.plans,
    };
    const current = props.contracts.find(isCurrent) ?? null;
    const closed = props.contracts.filter((contract) => !isCurrent(contract));
    return (
      <>
        <Section title="Contrato">
          {current ? (
            <ContractCard role="admin" contract={current} {...context} />
          ) : (
            <NoCurrentContract>
              <ContractFormDialog
                {...context}
                disabled={archived}
                describedBy={archived ? reasonId : undefined}
              />
              {archived ? (
                <p id={reasonId} className="text-xs">
                  Reative a empresa para criar um contrato.
                </p>
              ) : null}
            </NoCurrentContract>
          )}
        </Section>
        {closed.length > 0 ? (
          <Section title="Contratos anteriores">
            <ContractHistory role="admin" contracts={closed} />
          </Section>
        ) : null}
      </>
    );
  }

  const current = props.contracts.find(isCurrent) ?? null;
  const closed = props.contracts.filter((contract) => !isCurrent(contract));
  return (
    <>
      <Section title="Contrato">
        {current ? <ContractCard role="member" contract={current} /> : <NoCurrentContract />}
      </Section>
      {closed.length > 0 ? (
        <Section title="Contratos anteriores">
          <ContractHistory role="member" contracts={closed} />
        </Section>
      ) : null}
    </>
  );
}

function NoCurrentContract({ children }: { children?: ReactNode }) {
  return (
    <EmptyState>
      <div className="grid justify-items-center gap-3">
        <p>Sem contrato vigente.</p>
        {children}
      </div>
    </EmptyState>
  );
}

function ContactsSection({ contacts }: { contacts: CustomerContact[] | null }) {
  const router = useRouter();
  const { startConversation, checkingPhone } = useStartConversation();
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  // O "desvinculando" dura até a ficha nova chegar: a linha some junto com o
  // spinner, em vez de voltar habilitada por um instante.
  const [refreshing, startRefresh] = useTransition();

  async function unlink(contact: CustomerContact) {
    if (unlinkingId || refreshing) return;
    setUnlinkingId(contact.id);
    // Sem confirmação: desvincular é reversível (vincula de novo em Contatos
    // ou na conversa).
    const result = await linkContactToCustomer(contact.id, null);
    if (!result.ok) {
      setUnlinkingId(null);
      toast.error(result.message);
      return;
    }
    toast.success("Contato desvinculado.");
    startRefresh(() => {
      setUnlinkingId(null);
      router.refresh();
    });
  }

  if (contacts === null) {
    return (
      <Section title="Contatos">
        <EmptyState>
          <div className="grid justify-items-center gap-3">
            <p>Não foi possível carregar os contatos.</p>
            <RetryButton onRetry={() => router.refresh()} />
          </div>
        </EmptyState>
      </Section>
    );
  }

  return (
    <Section title={`Contatos (${contacts.length})`}>
      {contacts.length === 0 ? (
        <EmptyState>
          <p>
            Nenhum contato vinculado. Vincule pela conversa no WhatsApp ou em{" "}
            <Link
              href="/app/contatos?empresa=sem"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Contatos
            </Link>
            .
          </p>
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card shadow-soft">
          {contacts.map((contact) => {
            const label = contact.name ?? formatPhone(contact.phone);
            const opening = checkingPhone === contact.phone;
            const unlinking = unlinkingId === contact.id;
            return (
              <li key={contact.id} className="flex min-w-0 items-center gap-3 px-3 py-2.5 sm:px-4">
                <AvatarInitials name={contact.name} />
                <div className="min-w-0 flex-1">
                  <p
                    className={
                      contact.name
                        ? "truncate text-sm font-medium"
                        : "truncate text-sm font-medium text-muted-foreground"
                    }
                  >
                    {contact.name ?? "Sem nome"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground tabular-nums">
                    {formatPhone(contact.phone)}
                  </p>
                  {contact.last_message_at ? (
                    <p className="truncate text-xs text-muted-foreground">
                      Última mensagem em {formatDateTime(contact.last_message_at)}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void startConversation(contact.phone, contact.name ?? undefined)}
                    disabled={checkingPhone !== null}
                    aria-label={`Abrir conversa com ${label}`}
                    title="Abrir conversa"
                    // O verde diz, sozinho, o que o botão faz; círculo porque é
                    // ação de contato, não item de barra (UI.md §3.3).
                    className="inline-flex size-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 outline-none transition-colors hover:bg-emerald-500/20 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40 sm:size-9 dark:text-emerald-400"
                  >
                    {opening ? (
                      <Loader2Icon className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <WhatsAppIcon className="size-[18px]" />
                    )}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={unlinkingId !== null || refreshing}
                    onClick={() => void unlink(contact)}
                    aria-label={`Desvincular ${label}`}
                    className="h-11 px-2.5 text-muted-foreground sm:h-8"
                  >
                    {unlinking ? (
                      <Loader2Icon className="animate-spin" data-icon="inline-start" />
                    ) : null}
                    Desvincular
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <Button type="button" variant="outline" onClick={onRetry} className="h-11 sm:h-9">
      <RotateCwIcon data-icon="inline-start" />
      Tentar de novo
    </Button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <h2
        id={titleId}
        className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

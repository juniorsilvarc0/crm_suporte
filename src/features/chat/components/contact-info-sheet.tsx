"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  Loader2Icon,
  PhoneIcon,
  SearchIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactAvatar } from "@/features/chat/components/contact-avatar";
import { ConversationTagChips } from "@/features/chat/components/conversation-tag-chips";
import { ConversationTagsPicker } from "@/features/chat/components/conversation-tags-picker";
import type { ConversationTagsController } from "@/features/chat/hooks/use-conversation-tags";
import { NO_TAGS } from "@/features/chat/lib/conversation-tags";
import { useContactInfo } from "@/features/chat/hooks/use-contact-info";
import {
  contactDisplayName,
  contactTelHref,
  notesAreDirty,
} from "@/features/chat/lib/contact-info";
import { ContractStatusBadge } from "@/features/contracts/components/contract-status-badge";
import { CustomerPicker } from "@/features/customers/components/customer-picker";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import type { CustomerSummary } from "@/features/customers/types";
import { useTeamDirectory } from "@/features/settings/hooks/use-team-directory";
import {
  ConversationTicketsFocusList,
  ConversationTicketsGroup,
} from "@/features/tickets/components/conversation-tickets-group";
import {
  NewTicketForm,
  type NewTicketFormHandle,
} from "@/features/tickets/components/new-ticket-form";
import {
  useConversationTickets,
  type ConversationTicketsState,
} from "@/features/tickets/hooks/use-conversation-tickets";
import { useTicketCatalog } from "@/features/tickets/hooks/use-ticket-catalog";
import { formatCnpj } from "@/lib/formatters/cnpj";
import { formatDate } from "@/lib/formatters/date";
import { formatPhoneBR } from "@/lib/formatters/phone";
import { cn } from "@/lib/utils";
import type { ChatConversation } from "@/features/chat/types";
import type { Tag } from "@/features/tags/types";

/**
 * Tela de informações do contato — **sheet lateral contido na conversa**.
 *
 * A referência é a tela do WhatsApp no iOS: lista agrupada, cartão arredondado
 * por seção, rótulo à esquerda e valor à direita, verde para ação e vermelho
 * para destrutivo. O **formato** é copiado; o **conteúdo** não pode ser: o
 * WhatsApp mostra perfil comercial (horário, categoria, site, mapa) e este banco
 * não tem nada disso — `chat_conversations.metadata` só carrega `avatar_key`.
 * Inventar esses campos seria mentir na tela (UI.md §1). O que entra é o que o
 * CRM sabe de verdade: o cadastro do contato e a conversa.
 *
 * O portal nasce dentro do `ChatView`, como o sheet de anexo: assim ele ocupa
 * exatamente a coluna da conversa em qualquer largura, e a lista fica fora da
 * camada por construção — sem número de sidebar duplicado em lugar nenhum.
 *
 * Fora de escopo de propósito: ampliar a foto (seria diálogo sobre diálogo, que
 * é anti-padrão aqui), galeria de mídia, silenciar, bloquear e exportar. Nada
 * disso existe no back-end hoje.
 */

type PendingAction = "search" | null;

/** A vista em que o painel abre (`initialView`): o cabeçalho do chat abre direto nos tickets. */
export type ContactInfoInitialView = "info" | "tickets" | "ticket-new";

type SheetView = ContactInfoInitialView | "tags" | "customer";

// Vista-pai de cada vista interna: o Esc e o "Voltar" sobem UM degrau, e só a
// vista "info" fecha o painel (UI.md §5.7.18).
const PARENT_VIEW: Record<Exclude<SheetView, "info">, SheetView> = {
  tags: "info",
  customer: "info",
  tickets: "info",
  "ticket-new": "info",
};

const VIEW_TITLE: Record<SheetView, string> = {
  info: "Dados do contato",
  tags: "Etiquetas",
  customer: "Empresa",
  tickets: "Tickets",
  "ticket-new": "Novo ticket",
};

export function ContactInfoSheet({
  conversation,
  portalContainer,
  tagsController,
  onClose,
  onSearch,
  initialView = "info",
  tickets: sharedTickets,
}: {
  conversation: ChatConversation;
  portalContainer: RefObject<HTMLDivElement | null>;
  tagsController: ConversationTagsController;
  onClose: () => void;
  /** Abre a busca da conversa. A tela fecha antes, para não empilhar camada. */
  onSearch?: () => void;
  /**
   * Vista em que o painel abre. Lida só na MONTAGEM, que é a abertura: o
   * `ChatView` monta o painel ao abrir (e o remonta ao trocar de conversa, pela
   * `key`). Mudar a prop com o painel aberto não troca a vista.
   */
  initialView?: ContactInfoInitialView;
  /**
   * Os tickets da conversa, quando quem monta já os lê (o `ChatView`, para o
   * cabeçalho): uma leitura só, e a ação feita aqui chega ao chip. Sem ele, o
   * painel lê os seus.
   */
  tickets?: ConversationTicketsState;
}) {
  const [open, setOpen] = useState(true);
  const [pending, setPending] = useState<PendingAction>(null);
  // Etiquetar, escolher a empresa, trocar o foco e abrir ticket trocam o miolo
  // DESTE sheet, com "Voltar" — abrir uma gaveta por cima seria modal sobre
  // modal (UI.md §9).
  const [view, setView] = useState<SheetView>(initialView);
  const [busyTagId, setBusyTagId] = useState<string | null>(null);
  // Alvo da escrita de empresa; só vale enquanto `linking` (o hook é o dono do
  // "em voo"). Ao desligar é a empresa atual, que é o que o seletor espera.
  const [linkTargetId, setLinkTargetId] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const assignedTags = tagsController.tagsByConversation.get(conversation.id) ?? NO_TAGS;

  const toggleTag = async (tag: Tag, assigned: boolean) => {
    setBusyTagId(tag.id);
    const ok = await tagsController.assign(conversation.id, tag, assigned);
    setBusyTagId(null);
    if (!ok) toast.error("Não foi possível atualizar a etiqueta.");
  };

  const {
    info,
    loading,
    failed,
    savingNotes,
    saveNotes,
    linking,
    linkCustomer,
    retry,
  } = useContactInfo(conversation.id);

  const displayName = contactDisplayName(conversation);
  const telHref = contactTelHref(conversation.contact_phone);
  const contact = info?.contact ?? null;
  const customer = info?.customer ?? null;

  // Tickets da conversa: relê quando o foco ou o atendimento mudam (Realtime do
  // chat, inclusive de outra aba) e depois de cada ação daqui. Com os de quem
  // monta, a leitura própria nem sai (`null`).
  const ownTickets = useConversationTickets(
    sharedTickets ? null : conversation.id,
    conversation.active_ticket_id,
    conversation.status
  );
  const tickets = sharedTickets ?? ownTickets;
  // Rótulos e matriz para as ações rápidas; as filas do "Novo ticket".
  const ticketCatalog = useTicketCatalog();
  // Quem está logado: decide se "Atender" cabe (ticket sem responsável ou seu).
  const { currentUserId } = useTeamDirectory();
  const newTicketRef = useRef<NewTicketFormHandle>(null);

  // O "Novo ticket" decide se a vista pode sair: enviando, não; sujo, pergunta
  // "Descartar?" nele mesmo e fica. As outras vistas saem sempre.
  const canLeaveView = () =>
    view !== "ticket-new" || newTicketRef.current?.requestExit() !== false;

  const goBack = () => {
    if (view === "info" || !canLeaveView()) return;
    setView(PARENT_VIEW[view]);
  };

  // Sem mensagem = nada foi enviado (outra escrita já está em voo): silêncio.
  const pickCustomer = async (next: CustomerSummary) => {
    setLinkTargetId(next.id);
    const result = await linkCustomer(next);
    if (!result.ok) {
      if (result.message) toast.error(result.message);
      return;
    }
    toast.success(`Contato ligado a ${customerDisplayName(next)}.`);
    setView("info");
  };

  const unlinkCustomer = async () => {
    if (!customer) return;
    setLinkTargetId(customer.id);
    const result = await linkCustomer(null);
    if (!result.ok) {
      if (result.message) toast.error(result.message);
      return;
    }
    toast.success(`Contato desligado de ${customerDisplayName(customer)}.`);
    setView("info");
  };

  const close = (action: PendingAction = null) => {
    if (!open) return;
    setPending(action);
    setOpen(false);
  };

  const copyPhone = async () => {
    if (!conversation.contact_phone) return;
    try {
      await navigator.clipboard.writeText(conversation.contact_phone);
      toast.success("Número copiado.");
    } catch {
      toast.error("Não foi possível copiar o número.");
    }
  };

  return (
    <Dialog
      variant="dialog"
      open={open}
      onOpenChange={(next, details) => {
        // Esc numa vista interna volta um passo, não fecha o painel: cada Esc
        // desfaz uma coisa só (UI.md §5.7.18).
        if (!next && view !== "info" && details.reason === "escape-key") {
          details.cancel();
          goBack();
          return;
        }
        // Fora do Esc (toque fora), o formulário sujo segura o painel igual.
        if (!next && !canLeaveView()) {
          details.cancel();
          return;
        }
        if (!next) close();
      }}
      onOpenChangeComplete={(next) => {
        if (next) return;
        // O pai só desmonta depois da saída lateral; a ação seguinte espera o
        // mesmo instante para não abrir a busca sob um painel ainda animando.
        onClose();
        if (pending === "search") onSearch?.();
      }}
    >
      <DialogContent
        ref={sheetRef}
        presentation="sheet"
        portalContainer={portalContainer}
        showCloseButton={false}
        // O foco entra no painel, não num campo: focar a caixa de notas durante
        // o `translateX(100%)` faz o Safari rolar a página para revelá-la.
        initialFocus={sheetRef}
        data-chat-sheet="info"
        className="bg-[var(--wa-info-bg)] text-foreground"
        aria-describedby={undefined}
      >
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-[var(--wa-info-divider)] px-1 sm:px-2">
          {/* Nas vistas internas o mesmo botão volta um passo, em vez de
              fechar: fechar dali perderia a tela de contato inteira. */}
          {view !== "info" ? (
            <button
              type="button"
              onClick={goBack}
              aria-label="Voltar para os dados do contato"
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--wa-info-label)] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeftIcon className="size-6" />
            </button>
          ) : (
            <DialogClose
              render={
                <button
                  type="button"
                  aria-label="Voltar para a conversa"
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--wa-info-label)] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              <ChevronLeftIcon className="size-6" />
            </DialogClose>
          )}
          <DialogTitle className="font-sans min-w-0 flex-1 truncate text-center text-[17px] font-semibold tracking-[-0.01em]">
            {VIEW_TITLE[view]}
          </DialogTitle>
          {/* Equilibra o botão da esquerda para o título ficar centrado. */}
          <span className="size-11 shrink-0" aria-hidden />
        </header>

        {view === "tags" ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <ConversationTagsPicker
              tags={tagsController.tags}
              assigned={assignedTags}
              loading={tagsController.loading}
              failed={tagsController.failed}
              busyTagId={busyTagId}
              onToggle={(tag, assigned) => void toggleTag(tag, assigned)}
              onCreate={async (name, color) => {
                const created = await tagsController.createTag(name, color);
                if (!created) return false;
                await toggleTag(created, true);
                return true;
              }}
              onRetry={tagsController.retry}
            />
          </div>
        ) : view === "customer" ? (
          // Sem foco automático: o teclado subiria no meio da troca de vista.
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
            <div className="mx-auto w-full max-w-xl">
              <CustomerPicker
                appearance="chat"
                currentCustomerId={customer?.id ?? null}
                currentCustomerName={customer ? customerDisplayName(customer) : null}
                busyId={linking ? linkTargetId : null}
                onPick={(next) => void pickCustomer(next)}
                onUnlink={() => void unlinkCustomer()}
              />
            </div>
          </div>
        ) : view === "tickets" ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
            <div className="mx-auto w-full max-w-xl">
              <ConversationTicketsFocusList
                conversationId={conversation.id}
                state={tickets}
                activeTicketId={conversation.active_ticket_id}
                statuses={ticketCatalog.catalog?.statuses ?? null}
                onFocused={() => setView("info")}
              />
            </div>
          </div>
        ) : view === "ticket-new" ? (
          // Sem foco automático no título: o teclado subiria no meio da troca
          // de vista. O formulário tem rolagem e rodapé próprios.
          <NewTicketForm
            ref={newTicketRef}
            conversationId={conversation.id}
            products={ticketCatalog.catalog?.products ?? null}
            productsLoading={ticketCatalog.loading}
            onRetryProducts={ticketCatalog.retry}
            onCreated={() => {
              tickets.refresh();
              setView("info");
            }}
            onExit={() => setView(PARENT_VIEW["ticket-new"])}
          />
        ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
          <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-6">
            {/* Identificação — vem da conversa, aparece na hora, sem esperar rede */}
            <section className="flex flex-col items-center gap-2 text-center">
              <ContactAvatar
                name={conversation.contact_name}
                phone={conversation.contact_phone}
                url={conversation.contact_avatar_url}
                className="size-24"
              />
              <h2 className="mt-1 text-[22px] leading-snug font-semibold tracking-[-0.01em] break-words">
                {displayName}
              </h2>
              {conversation.contact_phone && (
                <p className="text-[15px] text-[var(--wa-info-label)]">
                  {formatPhoneBR(conversation.contact_phone)}
                </p>
              )}
            </section>

            {/* Ações rápidas, como as três pílulas da referência */}
            <section className="grid grid-cols-3 gap-2">
              <ActionPill
                icon={<PhoneIcon />}
                label="Ligar"
                href={telHref}
                disabledReason={
                  telHref ? undefined : "Número indisponível para chamada"
                }
              />
              <ActionPill
                icon={<CopyIcon />}
                label="Copiar"
                onClick={() => void copyPhone()}
                disabledReason={
                  conversation.contact_phone ? undefined : "Sem número para copiar"
                }
              />
              <ActionPill
                icon={<SearchIcon />}
                label="Buscar"
                onClick={() => close("search")}
                disabledReason={onSearch ? undefined : "Busca indisponível"}
              />
            </section>

            <CustomerGroup
              customer={customer}
              hasContact={contact !== null}
              loading={loading}
              failed={failed}
              onChange={() => setView("customer")}
            />

            {/* A falha dos tickets fica no grupo, com "Tentar de novo" próprio:
                o resto do painel não depende dela. */}
            <InfoGroup title="Tickets">
              <ConversationTicketsGroup
                state={tickets}
                activeTicketId={conversation.active_ticket_id}
                catalog={ticketCatalog.catalog}
                catalogFailed={ticketCatalog.failed}
                onRetryCatalog={ticketCatalog.retry}
                viewerId={currentUserId}
                onChangeFocus={() => setView("tickets")}
                onNewTicket={() => setView("ticket-new")}
              />
            </InfoGroup>

            {/* Etiquetas vêm antes das notas: é o dado que se lê de relance e
                o que a pessoa mais mexe durante o atendimento. */}
            <InfoGroup title="Etiquetas">
              {assignedTags.length > 0 ? (
                <ConversationTagChips tags={assignedTags} className="px-4 py-3" />
              ) : null}
              <button
                type="button"
                onClick={() => setView("tags")}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-[15px] text-[var(--wa-green-deep)] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="truncate">
                  {assignedTags.length > 0 ? "Editar etiquetas" : "Adicionar etiqueta"}
                </span>
                <ChevronRightIcon
                  aria-hidden
                  className="size-[18px] shrink-0 text-[var(--wa-info-label)]"
                />
              </button>
            </InfoGroup>

            <NotesSection
              contact={contact}
              loading={loading}
              failed={failed}
              saving={savingNotes}
              onSave={saveNotes}
            />

            {/* Bloco do CRM: só existe quando há cadastro. Sem ele, a tela diz
                isso em vez de mostrar campos vazios que parecem defeito. */}
            <InfoGroup title="Contato">
              {loading ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : failed ? (
                // Estado de erro com saída: sem o "tentar de novo" a única
                // forma de recarregar era fechar e reabrir a tela.
                <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0 truncate text-[15px] text-[var(--wa-info-label)]">
                    Não foi possível carregar o contato.
                  </span>
                  <button
                    type="button"
                    onClick={retry}
                    className="min-h-11 shrink-0 rounded-lg px-3 text-[15px] font-medium text-[var(--wa-green-deep)] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Tentar de novo
                  </button>
                </div>
              ) : contact ? (
                <>
                  {contact.email && <InfoRow label="E-mail" value={contact.email} />}
                  <InfoRow label="Contato desde" value={formatDate(contact.created_at)} />
                </>
              ) : (
                <InfoRow
                  label="Sem cadastro vinculado"
                  value="Nenhum contato com este número"
                />
              )}
            </InfoGroup>

            <InfoGroup title="Conversa">
              <InfoRow label="Atendimento" value={ATTENDANCE[conversation.status]} />
              <InfoRow
                label="Conversa desde"
                value={formatDate(conversation.created_at)}
              />
              {conversation.archived_at && (
                <InfoRow
                  label="Arquivada em"
                  value={formatDate(conversation.archived_at)}
                />
              )}
            </InfoGroup>
          </div>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Empresa do contato, com o selo do contrato — é o que o analista precisa ver
 * de relance ("Contrato suspenso"). Nunca valor nem vencimento: a rota do painel
 * não os traz, e esta tela é de quem atende.
 *
 * Na falha o grupo some: o "Tentar de novo" do grupo Contato já recarrega os
 * dois, e duas saídas para a mesma leitura seriam ruído. Sem cadastro também
 * some — não há contato para ligar a empresa.
 */
function CustomerGroup({
  customer,
  hasContact,
  loading,
  failed,
  onChange,
}: {
  customer: CustomerSummary | null;
  hasContact: boolean;
  loading: boolean;
  failed: boolean;
  onChange: () => void;
}) {
  if (loading) {
    return (
      <InfoGroup title="Empresa">
        <SkeletonRow />
        <SkeletonRow />
      </InfoGroup>
    );
  }
  if (failed || !hasContact) return null;

  if (!customer) {
    return (
      <InfoGroup title="Empresa">
        <div className="flex min-h-11 items-center px-4 py-2.5">
          <span className="min-w-0 truncate text-[15px] text-[var(--wa-info-label)]">
            Sem empresa vinculada
          </span>
        </div>
        <GroupActionButton label="Ligar a uma empresa" onClick={onChange} />
      </InfoGroup>
    );
  }

  const name = customerDisplayName(customer);
  const secondary = [
    customer.legal_name !== name ? customer.legal_name : null,
    customer.cnpj ? formatCnpj(customer.cnpj) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <InfoGroup title="Empresa">
      <div className="flex min-h-11 min-w-0 flex-col justify-center px-4 py-2.5">
        <span className="text-[15px] break-words">{name}</span>
        {secondary ? (
          <span className="truncate text-[13px] text-[var(--wa-info-label)] tabular-nums">
            {secondary}
          </span>
        ) : null}
      </div>
      <div className="grid min-h-11 grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-center gap-3 px-4 py-2.5">
        <span className="truncate text-[15px] text-[var(--wa-info-label)]">Contrato</span>
        {/* `div min-w-0`: o `shrink-0` do selo venceria a linha (UI.md §5.6.1). */}
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          <ContractStatusBadge status={customer.contract_status} />
          {customer.archived_at ? (
            <Badge variant="outline" title="Empresa arquivada" className="max-w-full">
              <span className="min-w-0 truncate">Empresa arquivada</span>
            </Badge>
          ) : null}
        </div>
      </div>
      {/* `next/link`, não `<a>`: sair do chat por documento inteiro pisca
          branco no PWA. */}
      <Link
        href={`/app/clientes/${customer.id}`}
        className={GROUP_ACTION_CLASS}
      >
        <span className="truncate">Abrir empresa</span>
        <ChevronRightIcon
          aria-hidden
          className="size-[18px] shrink-0 text-[var(--wa-green-deep)]"
        />
      </Link>
      <GroupActionButton label="Trocar empresa" onClick={onChange} />
    </InfoGroup>
  );
}

/** Linha de ação do grupo: verde, com chevron — o molde de "Adicionar etiqueta". */
const GROUP_ACTION_CLASS =
  "flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-[15px] text-[var(--wa-green-deep)] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function GroupActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={GROUP_ACTION_CLASS}>
      <span className="truncate">{label}</span>
      <ChevronRightIcon
        aria-hidden
        className="size-[18px] shrink-0 text-[var(--wa-info-label)]"
      />
    </button>
  );
}

/** Rótulo curto do atendimento — o cabeçalho usa a forma longa, em frase. */
const ATTENDANCE: Record<ChatConversation["status"], string> = {
  bot: "IA",
  human: "Humano",
  resolved: "Resolvida",
};

/**
 * Notas do contato, editáveis aqui mesmo.
 *
 * Grava pela rota do contato (`PATCH /api/contacts/[id]`) — é o mesmo campo e
 * a mesma validação, não um segundo caminho para o mesmo dado.
 * O botão só aparece com alteração pendente: um "Salvar" permanente convida a
 * gravar o que não mudou.
 */
function NotesSection({
  contact,
  loading,
  failed,
  saving,
  onSave,
}: {
  contact: { id: string; notes: string | null } | null;
  loading: boolean;
  failed: boolean;
  saving: boolean;
  onSave: (draft: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  // As notas chegam depois da tela. Ajuste durante o render, padrão do repo —
  // `setState` em efeito é barrado pelo lint e pintaria um quadro vazio antes.
  const [syncedNotes, setSyncedNotes] = useState<string | null | undefined>(undefined);
  if (contact && contact.notes !== syncedNotes) {
    setSyncedNotes(contact.notes);
    setDraft(contact.notes ?? "");
  }

  if (loading) {
    return (
      <InfoGroup title="Notas">
        <SkeletonRow />
      </InfoGroup>
    );
  }
  if (failed || !contact) return null;

  const dirty = notesAreDirty(draft, contact.notes);

  return (
    <InfoGroup title="Notas">
      <div className="px-4 py-3">
        <label htmlFor="contact-notes" className="sr-only">
          Notas sobre o contato
        </label>
        <textarea
          id="contact-notes"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          disabled={saving}
          placeholder="Adicionar notas"
          // `text-base` no celular: abaixo de 16px o iOS dá zoom ao focar.
          //
          // O texto de apoio fica cinza, e não no verde da referência: lá
          // "Adicionar notas" é uma LINHA que se toca; aqui o campo já está
          // aberto. Verde num placeholder promete um clique que não existe.
          className="min-h-20 w-full resize-none bg-transparent text-base leading-normal outline-none placeholder:text-[var(--wa-info-label)] disabled:opacity-50 sm:text-[15px]"
        />
        <div className="flex items-center justify-end gap-2">
          <span aria-live="polite" className="sr-only">
            {saving ? "Salvando notas" : ""}
          </span>
          {dirty && (
            <>
              <button
                type="button"
                onClick={() => setDraft(contact.notes ?? "")}
                disabled={saving}
                className="min-h-11 rounded-lg px-3 text-[15px] text-[var(--wa-info-label)] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                Descartar
              </button>
              <button
                type="button"
                onClick={() => {
                  void onSave(draft).then((ok) => {
                    if (ok) toast.success("Notas salvas.");
                    else toast.error("Não foi possível salvar as notas.");
                  });
                }}
                disabled={saving}
                className="flex min-h-11 items-center gap-2 rounded-lg bg-[var(--wa-green-deep)] px-4 text-[15px] font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                {saving && <Loader2Icon className="size-4 animate-spin" />}
                Salvar
              </button>
            </>
          )}
        </div>
      </div>
    </InfoGroup>
  );
}

/** Cartão de uma seção, no formato de lista agrupada do iOS. */
function InfoGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="px-4 pb-1.5 text-[13px] font-medium tracking-[0.02em] text-[var(--wa-info-label)] uppercase">
        {title}
      </h3>
      {/* `divide-y` desenha o separador entre linhas sem borda na última, que é
          exatamente o comportamento da tabela agrupada do iOS. */}
      <div className="divide-y divide-[var(--wa-info-divider)] overflow-hidden rounded-xl bg-[var(--wa-info-card)]">
        {children}
      </div>
    </section>
  );
}

/** Linha de leitura: rótulo à esquerda, valor à direita. */
function InfoRow({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    // `minmax(0,auto)` nas duas trilhas: sem isso um e-mail longo vira
    // `max-content` e empurra a linha para fora em 320px em vez de truncar.
    <div className="grid min-h-11 grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-center gap-3 px-4 py-2.5">
      <span className="flex items-center gap-2 text-[15px] text-[var(--wa-info-label)]">
        {icon && (
          <span aria-hidden className="[&_svg]:size-[18px] [&_svg]:shrink-0">
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
      </span>
      <span className="truncate text-right text-[15px]">{value}</span>
    </div>
  );
}

/**
 * Pílula de ação do topo. Vira `<a>` quando é `tel:` e `<button>` quando é
 * comando — o link precisa abrir o discador, que `onClick` não faz.
 */
function ActionPill({
  icon,
  label,
  href,
  onClick,
  disabledReason,
}: {
  icon: ReactNode;
  label: string;
  href?: string | null;
  onClick?: () => void;
  disabledReason?: string;
}) {
  const shape = cn(
    "flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl bg-[var(--wa-info-card)] px-2 py-3",
    "text-[13px] font-medium text-[var(--wa-green-deep)] transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    "[&_svg]:size-[22px] [&_svg]:shrink-0 [&_svg]:stroke-[1.8]",
    disabledReason
      ? "opacity-40"
      : "hover:bg-[var(--wa-info-active)] active:bg-[var(--wa-info-active)]"
  );
  const body = (
    <>
      {icon}
      <span className="truncate">{label}</span>
    </>
  );

  // Indisponível vira `<button disabled>`, não `<span>` apagado: o motivo entra
  // no nome acessível, e não num `title` — que no toque nunca aparece. Um span
  // com `aria-disabled` não é anunciado como controle e some para o leitor.
  if (disabledReason) {
    return (
      <button type="button" disabled aria-label={`${label} — ${disabledReason}`} className={shape}>
        {body}
      </button>
    );
  }

  if (href) {
    return (
      <a href={href} className={shape}>
        {body}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={shape}>
      {body}
    </button>
  );
}

/**
 * Espaço da linha enquanto a rede responde.
 *
 * Mantém a altura da linha real em vez de trocar a seção por um spinner solto:
 * a tela não muda de tamanho quando o dado chega (UI.md §9).
 *
 * Usa o primitivo `Skeleton`, com o cinza da própria superfície por cima: o
 * `bg-muted` do primitivo é o roxo do app e destoaria dentro do painel do chat.
 */
function SkeletonRow() {
  return (
    <div className="flex min-h-11 items-center px-4 py-2.5">
      <Skeleton className="h-4 w-2/5 bg-[var(--wa-info-active)]" />
    </div>
  );
}

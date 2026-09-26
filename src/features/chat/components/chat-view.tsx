"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  Loader2Icon,
  MessageSquareDashedIcon,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ChatHeader } from "@/features/chat/components/chat-header";
import { ChatFooter } from "@/features/chat/components/chat-footer";
import { ConversationSearch } from "@/features/chat/components/conversation-search";
import { DeleteMessageDialog } from "@/features/chat/components/delete-message-dialog";
import { EditMessageDialog } from "@/features/chat/components/edit-message-dialog";
import {
  ContactInfoSheet,
  type ContactInfoInitialView,
} from "@/features/chat/components/contact-info-sheet";
import { FilePreviewDialog } from "@/features/chat/components/file-preview-dialog";
import { ForwardDialog } from "@/features/chat/components/forward-dialog";
import { MessageBubble } from "@/features/chat/components/message-bubble";
import {
  MessageContextMenu,
  type AnchorRect,
} from "@/features/chat/components/message-context-menu";
import { MessageSelectionBar } from "@/features/chat/components/message-selection-bar";
import type { ConversationTagsController } from "@/features/chat/hooks/use-conversation-tags";
import {
  MAX_ATTACHMENT_BATCH,
  appendAttachmentDrafts,
  sendAttachmentBatch,
  type AttachmentBatchProgress,
  type AttachmentDraft,
} from "@/features/chat/lib/attachment-batch";
import { CHAT_COLUMN_CLASS } from "@/features/chat/lib/chat-layout";
import { isNoteMessage } from "@/features/chat/lib/note-actions";
import { isOptimistic } from "@/features/chat/lib/outgoing-message";
import { signMessage } from "@/features/chat/lib/signature";
import { useTeamDirectory } from "@/features/settings/hooks/use-team-directory";
import { findFirstUnreadId } from "@/features/chat/lib/unread-divider";
import { stripWhatsappFormat } from "@/features/chat/lib/whatsapp-format";
import {
  ConversationTicketChip,
  focusTicketSummary,
} from "@/features/tickets/components/conversation-ticket-chip";
import { TakeOverDialog } from "@/features/tickets/components/take-over-dialog";
import { useConversationTakeOver } from "@/features/tickets/hooks/use-conversation-take-over";
import { useConversationTickets } from "@/features/tickets/hooks/use-conversation-tickets";
import { useTicketCatalog } from "@/features/tickets/hooks/use-ticket-catalog";
import { cn } from "@/lib/utils";
import type { ChatConversation, ChatMessage } from "@/features/chat/types";

type ChatViewProps = {
  conversation: ChatConversation;
  messages: ChatMessage[];
  messagesLoading: boolean;
  onBack?: () => void;
  onSend: (
    content: string,
    quotedMessageId?: string | null,
    /** Texto exato que sairá para o contato — o que a bolha otimista mostra. */
    outboundPreview?: string
  ) => Promise<void> | void;
  /** Reenvia uma mensagem que falhou, sem criar outra. */
  onRetryMessage?: (message: ChatMessage) => Promise<void> | void;
  /** Rascunhos por conversa. Dono no ChatShell — ver o porquê lá. */
  drafts: Map<string, string>;
  onSendAudio: (
    blob: Blob,
    seconds: number,
    quotedMessageId?: string | null
  ) => Promise<void> | void;
  onSendFile: (
    file: File,
    quotedMessageId?: string | null,
    caption?: string
  ) => Promise<boolean>;
  onSendNote: (content: string) => Promise<void> | void;
  onEditMessage: (messageId: string, text: string) => Promise<boolean>;
  onDeleteMessage: (messageId: string) => Promise<boolean>;
  onForwardMessages: (
    messageIds: string[],
    targetConversationIds: string[]
  ) => Promise<boolean>;
  /** Destinos possíveis do encaminhamento — as conversas já carregadas. */
  conversations: ChatConversation[];
  onTakeover: () => Promise<void> | void;
  takeoverLoading?: boolean;
  /** A conversa que o take-over do ticket gravou: a lista e o cabeçalho, sem esperar o Realtime. */
  onConversationUpdate: (updated: Partial<ChatConversation> & { id: string }) => void;
  /** Há histórico anterior ao que está carregado. */
  hasMore?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => Promise<void> | void;
  /** Recarrega a conversa centrada numa mensagem (pulo da busca). */
  onLoadAround?: (messageId: string) => Promise<boolean>;
  /** A janela na tela NÃO termina na última mensagem (pós-pulo da busca). */
  windowed?: boolean;
  onReloadLatest?: () => Promise<void> | void;
  /** Busca da conversa. Mora no ChatShell porque o atalho Cmd+F precisa
   *  escolher entre esta busca e a de contatos, e só ele enxerga as duas. */
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  /** Etiquetas do chat — dono no ChatShell, usado pela tela de contato. */
  tagsController: ConversationTagsController;
};

function groupByDate(messages: ChatMessage[]) {
  const groups: { key: string; items: ChatMessage[] }[] = [];
  for (const msg of messages) {
    const key = format(new Date(msg.created_at), "yyyy-MM-dd");
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(msg);
    else groups.push({ key, items: [msg] });
  }
  return groups;
}

/**
 * Envelope da linha no modo de seleção.
 *
 * A caixa fica FORA da `MessageBubble` de propósito: assim a bolha não ganha um
 * segundo modo, e o menu, o lightbox e o player ficam inertes só com o
 * `pointer-events-none` do embrulho — sem uma linha de condicional dentro dela.
 *
 * A caixa é o único controle focável da linha; a bolha vira o rótulo dela, e é
 * por isso que a prévia da mensagem vai no `aria-label`.
 */
function SelectableRow({
  message,
  selection,
  onToggle,
  children,
}: {
  message: ChatMessage;
  selection: string[] | null;
  onToggle: (messageId: string) => void;
  children: React.ReactNode;
}) {
  if (selection === null) return <>{children}</>;

  const checked = selection.includes(message.id);
  const preview =
    stripWhatsappFormat(message.content ?? "").replace(/\s+/g, " ").slice(0, 60) ||
    message.type;

  return (
    <div
      onClick={() => onToggle(message.id)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 py-0.5 pl-3 transition-colors",
        checked ? "bg-black/[0.06] dark:bg-white/[0.07]" : "hover:bg-black/[0.03] dark:hover:bg-white/5"
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={() => onToggle(message.id)}
        onClick={(event) => event.stopPropagation()}
        aria-label={`Selecionar mensagem: ${preview}`}
        className="size-5 shrink-0"
      />
      <div className="pointer-events-none min-w-0 flex-1">{children}</div>
    </div>
  );
}

function formatDateLabel(dateKey: string): string {
  try {
    const d = new Date(dateKey);
    if (isToday(d)) return "Hoje";
    if (isYesterday(d)) return "Ontem";
    return format(d, "d 'de' MMMM 'de' yyyy", { locale: ptBR });
  } catch {
    return dateKey;
  }
}

export function ChatView({
  conversation,
  messages,
  messagesLoading,
  onBack,
  onSend,
  onRetryMessage,
  drafts,
  onSendAudio,
  onSendFile,
  onSendNote,
  onEditMessage,
  onDeleteMessage,
  onForwardMessages,
  conversations,
  onTakeover,
  takeoverLoading,
  onConversationUpdate,
  hasMore = false,
  loadingOlder = false,
  onLoadOlder,
  onLoadAround,
  windowed = false,
  onReloadLatest,
  searchOpen,
  onSearchOpenChange,
  tagsController,
}: ChatViewProps) {
  // Quem é quem na equipe: assina a anotação interna e decide quem pode mexer
  // na própria. Uma busca por conversa aberta, e falhar só tira a assinatura.
  //
  // `signature` é a MESMA que a rota aplicaria: a bolha otimista precisa nascer
  // com ela, senão o texto ganha uma linha em negrito sozinho um segundo depois
  // e a bolha cresce debaixo do olho de quem enviou.
  const { names: teamNames, currentUserId, signature } = useTeamDirectory();

  // Os tickets da conversa: UMA leitura por conversa aberta, para o cabeçalho
  // e para o painel do contato, que a recebe pronta. Duas leituras dobrariam as
  // buscas a cada mudança de foco ou de status, e a ação feita no painel não
  // chegaria ao chip.
  const tickets = useConversationTickets(
    conversation.id,
    conversation.active_ticket_id,
    conversation.status
  );
  // Rótulos e matriz do chip; o `ChatView` remonta a cada conversa aberta.
  const ticketCatalog = useTicketCatalog();
  // "Assumir": com ticket em foco, o take-over do ticket; sem, o PATCH de hoje.
  const ticketTakeOver = useConversationTakeOver({
    status: conversation.status,
    activeTicketId: conversation.active_ticket_id,
    activeTicket: tickets.activeTicket,
    onTakeover,
    onConversationUpdate,
    refresh: tickets.refresh,
  });

  // O anexo vive AQUI, não no rodapé: assim o arquivo solto sobre a conversa
  // cai no mesmo fluxo do clipe, com a mesma tela de envio.
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentDraft[]>([]);
  const [attachmentProgress, setAttachmentProgress] =
    useState<AttachmentBatchProgress | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Contador, não booleano: `dragleave` dispara ao passar por cada filho, e um
  // booleano faria a moldura piscar enquanto o arquivo atravessa a lista.
  const dragDepth = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const chatRootRef = useRef<HTMLDivElement | null>(null);
  // A tela de dados do contato só monta quando abre: ela busca o contato e a
  // empresa, e manter isso vivo em toda conversa seria rede à toa. O valor é a
  // vista em que ela abre (o chip do ticket abre direto nos tickets).
  const [contactView, setContactView] = useState<ContactInfoInitialView | null>(null);
  const contactOpen = contactView !== null;
  const [showJump, setShowJump] = useState(false);
  const atBottomRef = useRef(true);
  // Ligado no instante do envio, consumido pela próxima mensagem que entra na
  // lista: é o que faz a rolagem seguir a MINHA mensagem sem seguir as dos
  // outros — mensagem que chega enquanto se lê o histórico continua respeitando
  // onde o operador parou.
  const followOwnSend = useRef(false);
  // Pede o cursor de volta ao compositor. Contador, não booleano: fechar a tela
  // de anexo duas vezes seguidas precisa funcionar nas duas.
  const [composerFocusToken, setComposerFocusToken] = useState(0);
  const focusComposer = useCallback(() => setComposerFocusToken((n) => n + 1), []);
  const lastConvRef = useRef<string | null>(null);
  const lastCountRef = useRef(0);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  // Editar / encaminhar / apagar.
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState<ChatMessage | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  // `null` = fora do modo de seleção. Lista vazia ainda é modo de seleção.
  const [selection, setSelection] = useState<string[] | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  // Toque longo no celular: a mensagem e onde ela estava na tela.
  const [contextMenu, setContextMenu] = useState<
    { message: ChatMessage; anchor: AnchorRect; openedAt: number } | null
  >(null);

  // Índice por id: a citação é uma mensagem da mesma lista, então basta olhar
  // aqui em vez de buscar no servidor.
  const messageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages]
  );

  // Trocar de conversa cancela a resposta pendente — citar mensagem de outro
  // contato é erro garantido. Pela mesma razão zera a seleção e a edição: são
  // ids da conversa anterior.
  const [syncedConv, setSyncedConv] = useState(conversation.id);
  if (conversation.id !== syncedConv) {
    setSyncedConv(conversation.id);
    setReplyingTo(null);
    setSelection(null);
    setForwardOpen(false);
    setEditing(null);
    setDeleting(null);
    setContextMenu(null);
    setPendingAttachments([]);
    setAttachmentProgress(null);
    setAttachmentError(null);
  }

  // Divisor de "não lidas": calculado UMA vez, quando as mensagens da conversa
  // chegam. Recalcular a cada render moveria a linha conforme mensagem nova
  // entra — e ela marca onde o operador parou, não onde a conversa está.
  // Guardar o ID (e não o índice) faz a linha ficar no lugar mesmo depois de
  // carregar páginas mais antigas.
  const [unreadAnchoredFor, setUnreadAnchoredFor] = useState<string | null>(null);
  const [unreadAnchor, setUnreadAnchor] = useState<string | null>(null);
  if (messages.length > 0 && unreadAnchoredFor !== conversation.id) {
    setUnreadAnchoredFor(conversation.id);
    setUnreadAnchor(findFirstUnreadId(messages, conversation.unread_count));
  }

  const flashMessage = useCallback((messageId: string) => {
    const node = scrollRef.current?.querySelector(`[data-message-id="${messageId}"]`);
    if (!node) return false;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    // Pisca a original para o olho achar onde parou.
    node.classList.add("wa-quoted-flash");
    window.setTimeout(() => node.classList.remove("wa-quoted-flash"), 1200);
    return true;
  }, []);

  const jumpToMessage = useCallback(
    (messageId: string) => {
      flashMessage(messageId);
    },
    [flashMessage]
  );

  /**
   * Pulo vindo da busca: o alvo pode estar fora da janela carregada. Tenta
   * rolar; se a bolha não existe, recarrega a conversa em volta dela e rola
   * depois da pintura.
   */
  const jumpToSearchHit = useCallback(
    async (messageId: string) => {
      onSearchOpenChange(false);
      if (flashMessage(messageId)) return;
      const ok = await onLoadAround?.(messageId);
      if (!ok) return;
      requestAnimationFrame(() => {
        // Segundo quadro: no primeiro a lista ainda não terminou de montar.
        requestAnimationFrame(() => flashMessage(messageId));
      });
    },
    [flashMessage, onLoadAround, onSearchOpenChange]
  );

  // Os três envios consomem a resposta pendente da mesma forma: pegam o id,
  // limpam a barra e mandam. Deixar o `replyingTo` de pé faria a citação
  // reaparecer no envio seguinte.
  //
  // ⚠️ Texto: **não se espera** o servidor. A promessa é ignorada de propósito —
  // quem mostra o andamento é a bolha, e prender o compositor aqui era o que
  // impedia mandar duas mensagens seguidas.
  const handleSend = useCallback(
    (content: string) => {
      const quotedId = replyingTo?.id ?? null;
      setReplyingTo(null);
      // Enviar sempre leva a conversa ao fim, mesmo lendo o histórico lá em
      // cima: é o que o WhatsApp faz, e ver a própria mensagem sumir seria pior
      // que o pulo.
      followOwnSend.current = true;
      void onSend(content, quotedId, signMessage(content, signature));
    },
    [onSend, replyingTo, signature]
  );

  const handleSendAudio = useCallback(
    async (blob: Blob, seconds: number) => {
      const quotedId = replyingTo?.id ?? null;
      setReplyingTo(null);
      followOwnSend.current = true;
      await onSendAudio(blob, seconds, quotedId);
    },
    [onSendAudio, replyingTo]
  );

  // Anotação interna também é mensagem minha: a conversa acompanha, como no
  // envio de texto.
  const handleSendNote = useCallback(
    (content: string) => {
      followOwnSend.current = true;
      void onSendNote(content);
    },
    [onSendNote]
  );

  const addPendingFiles = useCallback(
    (files: File[]) => {
      const result = appendAttachmentDrafts(pendingAttachments, files);
      setPendingAttachments(result.attachments);
      setAttachmentError(null);

      if (result.duplicateCount > 0) {
        toast.info(
          result.duplicateCount === 1
            ? "Um anexo repetido foi ignorado."
            : `${result.duplicateCount} anexos repetidos foram ignorados.`
        );
      }
      if (result.overflowCount > 0) {
        toast.info(`Você pode enviar até ${MAX_ATTACHMENT_BATCH} anexos por vez.`);
      }
    },
    [pendingAttachments]
  );

  const handleSendAttachments = useCallback(
    async () => {
      if (pendingAttachments.length === 0) return;
      const quotedId = replyingTo?.id ?? null;
      setAttachmentError(null);
      followOwnSend.current = true;

      try {
        const result = await sendAttachmentBatch(
          pendingAttachments,
          (attachment, index) =>
            onSendFile(
              attachment.file,
              index === 0 ? quotedId : null,
              attachment.caption
            ),
          setAttachmentProgress
        );

        if (result.sentIds.length > 0) setReplyingTo(null);
        if (!result.failedId) {
          setPendingAttachments([]);
          // A tela de envio fecha: quem acabou de mandar a foto costuma
          // escrever em seguida, e o foco iria parar no clipe (ou em lugar
          // nenhum, quando o anexo entrou por colar/arrastar).
          focusComposer();
          return;
        }

        const sentIds = new Set(result.sentIds);
        const failed = pendingAttachments.find(({ id }) => id === result.failedId);
        setPendingAttachments((current) =>
          current.filter(({ id }) => !sentIds.has(id))
        );
        setAttachmentError(
          `O envio parou em ${failed?.file.name ?? "um anexo"}. Os itens restantes continuam aqui.`
        );
      } catch {
        setAttachmentError("Não foi possível concluir o envio. Tente novamente.");
      } finally {
        setAttachmentProgress(null);
      }
    },
    [onSendFile, pendingAttachments, replyingTo, focusComposer]
  );

  // "Encaminhar" no menu entra no modo de seleção com a mensagem já marcada —
  // é o caminho do WhatsApp: escolher, depois decidir para quem.
  const startForward = useCallback((message: ChatMessage) => {
    setReplyingTo(null);
    setSelection([message.id]);
  }, []);

  // O retângulo é copiado, não guardado por referência: um `DOMRect` vivo muda
  // se a lista mexer, e o clone sairia do lugar da mensagem.
  const openContextMenu = useCallback((message: ChatMessage, rect: DOMRect) => {
    setContextMenu({
      message,
      // Carimbado aqui, no handler: durante o render seria impuro.
      openedAt: Date.now(),
      anchor: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
    });
  }, []);

  const toggleSelected = useCallback((messageId: string) => {
    setSelection((current) => {
      if (current === null) return current;
      return current.includes(messageId)
        ? current.filter((id) => id !== messageId)
        : [...current, messageId];
    });
  }, []);

  const exitSelection = useCallback(() => {
    setSelection(null);
    setForwardOpen(false);
  }, []);

  const handleForward = useCallback(
    async (targets: string[]) => {
      if (!selection || selection.length === 0) return;
      setForwarding(true);
      try {
        const ok = await onForwardMessages(selection, targets);
        if (ok) {
          setForwardOpen(false);
          setSelection(null);
        }
      } finally {
        setForwarding(false);
      }
    },
    [onForwardMessages, selection]
  );

  const handleEdit = useCallback(
    async (text: string) => {
      if (!editing) return;
      setSavingEdit(true);
      try {
        const ok = await onEditMessage(editing.id, text);
        if (ok) setEditing(null);
      } finally {
        setSavingEdit(false);
      }
    },
    [editing, onEditMessage]
  );

  const handleDelete = useCallback(async () => {
    if (!deleting) return;
    setDeletePending(true);
    try {
      const ok = await onDeleteMessage(deleting.id);
      if (ok) setDeleting(null);
    } finally {
      setDeletePending(false);
    }
  }, [deleting, onDeleteMessage]);

  // Enquanto a IA comanda a conversa, o clipe do rodapé fica desabilitado —
  // soltar arquivo tem de respeitar a mesma regra, senão o operador manda
  // anexo por trás da IA sem perceber.
  //
  // No modo de seleção o compositor nem existe: soltar ali abriria a tela de
  // envio por cima de uma seleção em andamento.
  const acceptsDrop = conversation.status !== "bot" && selection === null;

  // Só intercepta arquivo. Arrastar texto ou link dentro da página continua
  // com o comportamento normal do navegador.
  const hasFiles = (event: React.DragEvent) =>
    acceptsDrop && Array.from(event.dataTransfer?.types ?? []).includes("Files");

  const handleDrop = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) addPendingFiles(files);
  };

  // Colar print (Ctrl/Cmd+V) é a terceira porta para o MESMO fluxo do clipe e
  // do arrastar: cai na tela de envio, com legenda.
  //
  // Ouve na janela, não num campo: no WhatsApp Web colar funciona sem precisar
  // clicar no compositor antes, e é assim que se cola um print recém-tirado.
  const anyDialogOpen =
    pendingAttachments.length > 0 ||
    editing !== null ||
    deleting !== null ||
    forwardOpen ||
    contextMenu !== null ||
    ticketTakeOver.conflict !== null;

  useEffect(() => {
    // Com um diálogo aberto o Ctrl+V pertence ao campo de lá (legenda, texto da
    // edição, busca do encaminhar). O painel do contato também: o print colado
    // na Descrição do "Novo ticket" não é anexo para o cliente.
    if (anyDialogOpen || contactOpen || selection !== null) return;

    const onPaste = (event: ClipboardEvent) => {
      // Só intercepta quando há ARQUIVO. Colar texto no compositor segue
      // funcionando como sempre — inclusive texto copiado com formatação.
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((candidate): candidate is File => candidate !== null);
      if (files.length === 0) return;
      event.preventDefault();

      // O clipe fica visivelmente desabilitado e o arrastar não acende a
      // moldura, mas colar não tem afordância nenhuma: sem este aviso, colar
      // um print com a IA no comando simplesmente não faria nada.
      if (conversation.status === "bot") {
        toast.info("Assuma o atendimento para enviar anexos.");
        return;
      }
      addPendingFiles(files);
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addPendingFiles, anyDialogOpen, contactOpen, selection, conversation.status]);

  /**
   * Esc em camadas, como no WhatsApp Web: cada Esc desfaz **uma** coisa, da mais
   * interna para a mais externa, e o último fecha a conversa e devolve a tela
   * vazia. No desktop essa é a única saída — a seta do cabeçalho é `lg:hidden`.
   *
   * ⚠️ Quem abre algo dismissível trata o próprio Esc e marca o evento como
   * tratado (`preventDefault`): os diálogos do Base UI, o menu do `/`, o painel
   * de emoji, o clipe e a gravação de áudio. Aqui só chega o que ninguém quis —
   * é o que impede um Esc de fechar a conversa levando junto um áudio gravado.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Diálogo aberto por cima fica com o Esc; o Base UI fecha sozinho.
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-slot='dialog-content'],[role='dialog']")) return;
      if (anyDialogOpen || contactOpen) return;

      if (selection !== null) {
        exitSelection();
        return;
      }
      if (searchOpen) {
        onSearchOpenChange(false);
        return;
      }
      if (replyingTo) {
        setReplyingTo(null);
        return;
      }
      // Pelo MESMO caminho da seta do cabeçalho: no celular ela devolve a
      // entrada de histórico em vez de deixá-la órfã (§5.7.11).
      onBack?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    anyDialogOpen,
    contactOpen,
    selection,
    exitSelection,
    searchOpen,
    onSearchOpenChange,
    replyingTo,
    onBack,
  ]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    // `scrollTo` no PRÓPRIO contêiner, e não `scrollIntoView` numa sentinela: o
    // `scrollIntoView` rola **todos** os ancestrais roláveis para revelar o
    // elemento. No celular isso mexia na página junto com a conversa, e é parte
    // da sensação de que a tela inteira balança.
    el.scrollTo({ top: el.scrollHeight, behavior });
    setShowJump(false);
    atBottomRef.current = true;
  }, []);

  /**
   * "Ir para a última" depois de um pulo da busca precisa RECARREGAR: a janela
   * na tela termina no passado, então rolar até o fim dela pararia centenas de
   * mensagens antes do presente.
   */
  const goToLatest = useCallback(async () => {
    if (windowed && onReloadLatest) {
      await onReloadLatest();
      requestAnimationFrame(() => scrollToBottom("auto"));
      return;
    }
    scrollToBottom("smooth");
  }, [windowed, onReloadLatest, scrollToBottom]);

  /**
   * ⚠️ Uma leitura de layout por QUADRO, não por evento.
   *
   * O iOS dispara `scroll` a cada quadro durante a inércia, e ler
   * `scrollHeight`/`scrollTop`/`clientHeight` obriga o navegador a recalcular
   * layout naquele instante. Eram três leituras por evento (o `scrollHeight`
   * aparecia duas vezes), no meio do gesto — trabalho síncrono exatamente
   * quando o dedo está pedindo 60 quadros por segundo.
   *
   * O `requestAnimationFrame` junta a rajada de eventos numa medida só, e as
   * três medidas saem do mesmo instante.
   */
  const scrollFrame = useRef<number | null>(null);

  const handleScroll = useCallback(() => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      const el = scrollRef.current;
      if (!el) return;
      const { scrollHeight, scrollTop, clientHeight } = el;
      const near = scrollHeight - scrollTop - clientHeight < 120;
      atBottomRef.current = near;
      setShowJump(!near && scrollHeight > clientHeight + 200);
    });
  }, []);

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) {
        window.cancelAnimationFrame(scrollFrame.current);
      }
    },
    []
  );

  // Jump to bottom instantly when switching conversations
  useLayoutEffect(() => {
    if (lastConvRef.current !== conversation.id) {
      lastConvRef.current = conversation.id;
      lastCountRef.current = messages.length;
      requestAnimationFrame(() => scrollToBottom("auto"));
    }
  }, [conversation.id, messages.length, scrollToBottom]);

  // Carregar mais: guarda a distância até o FIM antes de pedir a página. Depois
  // do prepend, `scrollTop = scrollHeight - distância` devolve o mesmo conteúdo
  // para debaixo do olho. Ancorar por `scrollTop` puro faria a lista saltar a
  // altura inteira das 100 mensagens novas.
  const prependAnchorRef = useRef<number | null>(null);
  const didPrependRef = useRef(false);

  const handleLoadOlder = useCallback(() => {
    const el = scrollRef.current;
    prependAnchorRef.current = el ? el.scrollHeight - el.scrollTop : null;
    didPrependRef.current = true;
    void onLoadOlder?.();
  }, [onLoadOlder]);

  // Antes da pintura, não depois: em `useEffect` o salto aparece por um quadro.
  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    if (anchor === null) return;
    prependAnchorRef.current = null;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight - anchor;
  }, [messages.length]);

  // New messages: auto-scroll only if the user is parked at the bottom
  useEffect(() => {
    if (messages.length === lastCountRef.current) return;
    const grew = messages.length > lastCountRef.current;
    lastCountRef.current = messages.length;
    // Crescer para CIMA não é mensagem nova: nem rola para o fim, nem acende o
    // "ir para a última".
    if (didPrependRef.current) {
      didPrependRef.current = false;
      return;
    }
    if (!grew) return;
    if (followOwnSend.current) {
      followOwnSend.current = false;
      // Instantâneo, não suave: vindo do topo do histórico, a animação de
      // milhares de pixels chega depois da mensagem seguinte já digitada.
      scrollToBottom("auto");
      return;
    }
    if (atBottomRef.current) scrollToBottom("smooth");
    else setShowJump(true);
  }, [messages.length, scrollToBottom]);

  // Mensagem nova do cliente pode mudar o ticket em foco (a retomada tira de
  // "aguardando cliente"): relê os tickets, com o debounce do hook. Carga não
  // conta (a 1ª, o pulo da busca e o "ir para a última" trocam a lista inteira
  // pelo que já estava lá), e sem foco não há o que retomar.
  const latestInboundId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.direction === "inbound") return message.id;
    }
    return null;
  }, [messages]);
  const seenInboundRef = useRef<string | null | undefined>(undefined);
  const hasFocusTicket = conversation.active_ticket_id !== null;
  const { notifyInbound } = tickets;

  useEffect(() => {
    if (messagesLoading) {
      seenInboundRef.current = undefined;
      return;
    }
    const seen = seenInboundRef.current;
    seenInboundRef.current = latestInboundId;
    if (seen === undefined || latestInboundId === null || latestInboundId === seen) return;
    if (hasFocusTicket) notifyInbound();
  }, [latestInboundId, messagesLoading, hasFocusTicket, notifyInbound]);

  // Agrupar por dia percorre a lista inteira; sem memo isso refazia a cada
  // tecla de estado do pai e a cada tick de entrega.
  const groups = useMemo(() => groupByDate(messages), [messages]);

  return (
    <div ref={chatRootRef} className="wa-surface relative isolate flex h-full flex-col">
      <ChatHeader
        conversation={conversation}
        onBack={onBack}
        // "Devolver à IA" segue no PATCH de hoje; só o "Assumir" passa pelo ticket.
        onTakeover={conversation.status === "human" ? onTakeover : ticketTakeOver.takeOver}
        takeoverLoading={takeoverLoading || ticketTakeOver.pending !== null}
        onToggleSearch={onLoadAround ? () => onSearchOpenChange(!searchOpen) : undefined}
        searchOpen={searchOpen}
        onOpenContact={() => setContactView("info")}
        focusTicketSummary={
          tickets.activeTicket
            ? focusTicketSummary(tickets.activeTicket, ticketCatalog.catalog?.statuses ?? null)
            : null
        }
        ticketChip={
          <ConversationTicketChip
            activeTicketId={conversation.active_ticket_id}
            state={tickets}
            catalog={ticketCatalog.catalog}
            catalogFailed={ticketCatalog.failed}
            onRetryCatalog={ticketCatalog.retry}
            viewerId={currentUserId}
            onNewTicket={() => setContactView("ticket-new")}
            onChangeFocus={() => setContactView("tickets")}
          />
        }
      />

      {searchOpen && (
        <ConversationSearch
          conversationId={conversation.id}
          onSelect={(id) => void jumpToSearchHit(id)}
          onClose={() => onSearchOpenChange(false)}
        />
      )}

      {/* Messages */}
      <div
        className="wa-doodle relative min-h-0 flex-1"
        onDragEnter={(event) => {
          if (!hasFiles(event)) return;
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (hasFiles(event)) event.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={handleDrop}
      >
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          // `overscroll-contain`: chegar no topo ou no fim da conversa não pode
          // arrastar a página junto. Mesmo par que a agenda já usa.
          className="absolute inset-0 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
        >
          {messagesLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2Icon className="size-5 animate-spin text-[var(--wa-meta)]" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-black/5 dark:bg-white/5">
                <MessageSquareDashedIcon className="size-5 text-[var(--wa-meta)]" />
              </div>
              <p className="text-sm text-[var(--wa-meta)]">
                Nenhuma mensagem ainda. Aguardando o contato.
              </p>
            </div>
          ) : (
            <div
              className={cn(
                CHAT_COLUMN_CLASS,
                "flex min-h-full flex-col justify-end py-3"
              )}
            >
              {hasMore && (
                <div className="flex justify-center py-3">
                  <button
                    type="button"
                    onClick={handleLoadOlder}
                    disabled={loadingOlder}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--wa-panel)] px-4 text-[13px] font-medium text-[var(--wa-meta)] shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:min-h-9"
                  >
                    {loadingOlder ? (
                      <>
                        <Loader2Icon className="size-3.5 animate-spin" />
                        Carregando…
                      </>
                    ) : (
                      <>
                        <ChevronUpIcon className="size-3.5" />
                        Carregar mensagens anteriores
                      </>
                    )}
                  </button>
                </div>
              )}

              {groups.map((group) => (
                <div key={group.key} className="flex flex-col">
                  <div className="sticky top-2 z-10 my-2 flex justify-center">
                    <span className="rounded-md bg-[var(--wa-panel)] px-2.5 py-1 text-[11px] font-medium uppercase text-[var(--wa-meta)] shadow-sm">
                      {formatDateLabel(group.key)}
                    </span>
                  </div>
                  {group.items.map((msg, index) => {
                    const previous = group.items[index - 1];
                    const showTail = !previous || previous.direction !== msg.direction || previous.type === "note" || msg.type === "note";
                    // Enquanto o envio não voltou não existe id de mensagem no
                    // banco nem no provedor: responder ou encaminhar dali citaria
                    // uma mensagem que ninguém tem, e a rota devolveria erro.
                    // (Editar e apagar já dependem do `external_id`.)
                    const unsent = isOptimistic(msg);
                    return (
                      <Fragment key={msg.id}>
                        {unreadAnchor === msg.id && (
                          <div className="my-2 flex items-center gap-3 px-3">
                            <span className="h-px flex-1 bg-[var(--wa-green-deep)]/25" />
                            <span className="rounded-full bg-[var(--wa-panel)] px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--wa-green-deep)] shadow-sm">
                              Mensagens não lidas
                            </span>
                            <span className="h-px flex-1 bg-[var(--wa-green-deep)]/25" />
                          </div>
                        )}
                      <SelectableRow
                        message={msg}
                        selection={selection}
                        onToggle={toggleSelected}
                      >
                        <MessageBubble
                          message={msg}
                          showTail={showTail}
                          quoted={
                            msg.quoted_message_id
                              ? messageById.get(msg.quoted_message_id) ?? null
                              : null
                          }
                          onReply={
                            msg.type === "note" || unsent ? undefined : setReplyingTo
                          }
                          onJumpToQuoted={jumpToMessage}
                          onForward={
                            msg.type === "note" || unsent ? undefined : startForward
                          }
                          onRetry={onRetryMessage}
                          // Nota também edita e apaga — a regra de quem pode
                          // é do `note-actions`, aplicada dentro da bolha.
                          onEdit={setEditing}
                          onDelete={setDeleting}
                          teamNames={teamNames}
                          viewerId={currentUserId}
                          // Em modo de seleção o toque longo não vale: o gesto
                          // ali é marcar, e a bolha já está inerte.
                          onLongPress={
                            selection === null && msg.type !== "note" && !unsent
                              ? openContextMenu
                              : undefined
                          }
                        />
                      </SelectableRow>
                      </Fragment>
                    );
                  })}
                </div>
              ))}
              {/* Respiro de 4px entre a última bolha e o compositor. Não é mais
                  âncora de rolagem: quem rola agora é o contêiner. */}
              <div aria-hidden="true" className="h-1" />
            </div>
          )}
        </div>

        {/* Soltar arquivo — moldura tracejada sobre a conversa, como no
            WhatsApp Desktop. `pointer-events-none` para não engolir o próprio
            `drop`, que é escutado no contêiner. */}
        {dragging && (
          <div aria-hidden className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-3">
            <div className="flex h-full w-full items-center justify-center rounded-lg border-2 border-dashed border-[var(--wa-green)]">
              <p className="text-[15px] font-medium text-white">Solte o arquivo nesta tela</p>
            </div>
          </div>
        )}

        {/* Jump to latest */}
        <button
          type="button"
          onClick={() => void goToLatest()}
          className={cn(
            "absolute bottom-4 right-4 z-20 flex size-10 items-center justify-center rounded-full bg-[var(--wa-panel)] text-[var(--wa-meta)] shadow-md transition-all hover:text-foreground",
            showJump || windowed
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-2 opacity-0"
          )}
          aria-label="Ir para a última mensagem"
        >
          <ChevronDownIcon className="size-5" />
        </button>
      </div>

      {/* Em modo de seleção não se escreve, se escolhe: a barra ocupa o lugar
          do compositor, como no WhatsApp. */}
      {selection !== null ? (
        <MessageSelectionBar
          count={selection.length}
          onCancel={exitSelection}
          onForward={() => setForwardOpen(true)}
        />
      ) : (
        <ChatFooter
          conversationId={conversation.id}
          focusToken={composerFocusToken}
          drafts={drafts}
          onSend={handleSend}
          onSendAudio={handleSendAudio}
          onPickFiles={addPendingFiles}
          onSendNote={handleSendNote}
          status={conversation.status}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
        />
      )}

      {contextMenu && (
        <MessageContextMenu
          key={contextMenu.message.id}
          message={contextMenu.message}
          quoted={
            contextMenu.message.quoted_message_id
              ? messageById.get(contextMenu.message.quoted_message_id) ?? null
              : null
          }
          anchor={contextMenu.anchor}
          openedAt={contextMenu.openedAt}
          onClose={() => setContextMenu(null)}
          onReply={setReplyingTo}
          onForward={startForward}
          onEdit={setEditing}
          onDelete={setDeleting}
          onMore={startForward}
        />
      )}

      {editing && (
        <EditMessageDialog
          key={editing.id}
          message={editing}
          saving={savingEdit}
          onCancel={() => setEditing(null)}
          onSave={(text) => void handleEdit(text)}
        />
      )}

      {deleting && (
        <DeleteMessageDialog
          // Anotação não vai ao contato: prometer "apagada para o contato"
          // seria mentira, e assustaria quem só quer corrigir um lembrete.
          isNote={isNoteMessage(deleting)}
          deleting={deletePending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void handleDelete()}
        />
      )}

      {forwardOpen && selection !== null && (
        <ForwardDialog
          conversations={conversations}
          excludeConversationId={conversation.id}
          messageCount={selection.length}
          sending={forwarding}
          onCancel={() => setForwardOpen(false)}
          onConfirm={(targets) => void handleForward(targets)}
        />
      )}

      {pendingAttachments.length > 0 && (
        <FilePreviewDialog
          attachments={pendingAttachments}
          portalContainer={chatRootRef}
          contactName={
            conversation.contact_name || conversation.contact_phone || "Contato"
          }
          progress={attachmentProgress}
          error={attachmentError}
          onAdd={addPendingFiles}
          onRemove={(id) =>
            setPendingAttachments((current) =>
              current.filter((attachment) => attachment.id !== id)
            )
          }
          onCaptionChange={(id, caption) =>
            setPendingAttachments((current) =>
              current.map((attachment) =>
                attachment.id === id ? { ...attachment, caption } : attachment
              )
            )
          }
          onCancel={() => {
            setPendingAttachments([]);
            setAttachmentError(null);
            focusComposer();
          }}
          onSend={() => void handleSendAttachments()}
        />
      )}

      {ticketTakeOver.conflict && (
        <TakeOverDialog
          conflict={ticketTakeOver.conflict}
          pending={ticketTakeOver.pending}
          onReassign={() => void ticketTakeOver.reassign()}
          onConversationOnly={() => void ticketTakeOver.conversationOnly()}
          onDismiss={ticketTakeOver.dismiss}
        />
      )}

      {contactView && (
        <ContactInfoSheet
          // Trocar de conversa com a tela aberta precisa remontá-la: sem a
          // `key`, o painel manteria o lead da conversa anterior enquanto a
          // nova busca não volta.
          key={conversation.id}
          conversation={conversation}
          portalContainer={chatRootRef}
          tagsController={tagsController}
          initialView={contactView}
          tickets={tickets}
          onClose={() => setContactView(null)}
          onSearch={onLoadAround ? () => onSearchOpenChange(true) : undefined}
        />
      )}
    </div>
  );
}

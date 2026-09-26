"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCheck,
  ClockIcon,
  CopyIcon,
  CornerUpLeftIcon,
  ChevronDownIcon,
  FileTextIcon,
  ForwardIcon,
  Loader2Icon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AudioMessage } from "@/features/chat/components/audio-message";
import { ContactCard } from "@/features/chat/components/contact-card";
import { DocumentMessageCard } from "@/features/chat/components/document-message-card";
import { FormattedText } from "@/features/chat/components/formatted-text";
import { ImageLightbox } from "@/features/chat/components/image-lightbox";
import { LinkPreviewCard } from "@/features/chat/components/link-preview-card";
import {
  canDeleteMessage,
  canEditMessage,
  canForwardMessage,
  isEditableMessage,
  isForwardedMessage,
  wasEdited,
} from "@/features/chat/lib/message-actions";
import { canEditNote, noteAuthorLabel } from "@/features/chat/lib/note-actions";
import { stripWhatsappFormat } from "@/features/chat/lib/whatsapp-format";
import {
  chatImageDimensions,
  chatThumbSrc,
} from "@/features/chat/lib/media/image-variant";
import { buildMessageLinkPreview } from "@/features/chat/lib/message-content";
import { getDocumentMessagePresentation } from "@/features/chat/lib/document-message";
import type { ChatMessage } from "@/features/chat/types";

type MessageBubbleProps = {
  message: ChatMessage;
  showTail?: boolean;
  /** Mensagem citada já resolvida pelo pai (ver ChatView). */
  quoted?: ChatMessage | null;
  onReply?: (message: ChatMessage) => void;
  onJumpToQuoted?: (messageId: string) => void;
  onForward?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  /** Reenvia esta mensagem quando o envio falhou. */
  onRetry?: (message: ChatMessage) => void;
  /**
   * Toque longo no celular. Recebe o retângulo da LINHA para o menu de contexto
   * clonar a bolha no lugar exato. Quando presente, substitui o dropdown do
   * toque longo — no desktop o gatilho continua sendo o chevron.
   */
  onLongPress?: (message: ChatMessage, rect: DOMRect) => void;
  /** Nome de quem é quem na equipe — assina a anotação interna. */
  teamNames?: ReadonlyMap<string, string>;
  /** Id de quem está logado. Decide quem pode mexer na própria anotação. */
  viewerId?: string | null;
};

const NO_NAMES: ReadonlyMap<string, string> = new Map();

/** Rótulo curto de uma mensagem citada — texto sem marcador, mídia por tipo. */
function quotedPreview(message: ChatMessage): string {
  if (message.is_deleted) return "Mensagem apagada";
  if (message.content?.trim()) {
    return stripWhatsappFormat(message.content).replace(/\s+/g, " ").slice(0, 140);
  }
  const byType: Partial<Record<ChatMessage["type"], string>> = {
    image: "Imagem",
    audio: "Áudio",
    video: "Vídeo",
    document: "Documento",
    sticker: "Figurinha",
  };
  return byType[message.type] ?? "Mensagem";
}

/**
 * Bloco da mensagem citada, dentro da bolha. Clicável: leva até a original,
 * como no WhatsApp Web.
 */
function QuotedBlock({
  quoted,
  isOutbound,
  onJump,
}: {
  quoted: ChatMessage;
  isOutbound: boolean;
  onJump?: (messageId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onJump?.(quoted.id)}
      aria-label="Ir para a mensagem original"
      className={cn(
        "mb-1 flex min-w-0 w-full flex-col items-start gap-0.5 rounded-sm border-l-[3px] px-2 py-1 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isOutbound
          ? "border-l-emerald-600/70 bg-black/[0.06] hover:bg-black/[0.1] dark:bg-white/[0.06] dark:hover:bg-white/10"
          : "border-l-primary/70 bg-black/[0.04] hover:bg-black/[0.08] dark:bg-white/[0.06] dark:hover:bg-white/10"
      )}
    >
      <span className="text-[11px] font-semibold opacity-80">
        {quoted.direction === "outbound" ? "Você" : "Contato"}
      </span>
      <span className="line-clamp-2 min-w-0 w-full [overflow-wrap:anywhere] text-[12.5px] opacity-70">
        {quotedPreview(quoted)}
      </span>
    </button>
  );
}

function Ticks({ message }: { message: ChatMessage }) {
  if (message.direction !== "outbound") return null;
  const s = message.delivery_status;
  if (s === "failed")
    return (
      <span className="text-[10px] text-red-500" aria-label="Não enviada">
        ✕
      </span>
    );
  if (s === "pending")
    return <ClockIcon className="size-3 shrink-0 opacity-50" aria-label="Enviando" />;
  if (s === "read")
    return <CheckCheck className="size-3.5 shrink-0 text-[var(--wa-tick)]" aria-label="Lida" />;
  if (s === "delivered")
    return <CheckCheck className="size-3.5 shrink-0 opacity-55" aria-label="Entregue" />;
  return <Check className="size-3.5 shrink-0 opacity-55" aria-label="Enviada" />;
}

function Time({ iso }: { iso: string }) {
  let label: string | null = null;
  try {
    label = format(new Date(iso), "HH:mm", { locale: ptBR });
  } catch {
    label = null;
  }
  if (!label) return null;
  return (
    <span className="text-[10.5px] tabular-nums opacity-55">{label}</span>
  );
}

/**
 * Menu da mensagem.
 *
 * Visível no hover no desktop e **sempre visível no toque** — hover-only não
 * existe no celular, e o WhatsApp Web resolve com a setinha que aparece no
 * hover. Mesmo padrão do botão de apagar do ProcedureCombobox (UI.md §5.6).
 */
function MessageMenu({
  message,
  isOutbound,
  onReply,
  onForward,
  onEdit,
  onDelete,
  open,
  onOpenChange,
  openedAt,
  onMedia = false,
}: {
  message: ChatMessage;
  isOutbound: boolean;
  onReply?: (message: ChatMessage) => void;
  onForward?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Instante em que o menu abriu, ou null se nunca abriu. */
  openedAt: number | null;
  /** A bolha é de mídia: o gatilho mora dentro dela. */
  onMedia?: boolean;
}) {
  const canCopy = Boolean(message.content?.trim());
  const showForward = Boolean(onForward) && canForwardMessage(message);
  const showDelete = Boolean(onDelete) && canDeleteMessage(message);
  // A janela de edição é medida quando o menu ABRE, não a cada render: ler o
  // relógio durante a renderização é impuro (`react-hooks/purity`) e, pior,
  // faria o item sumir debaixo do cursor de quem já abriu o menu.
  const showEdit =
    Boolean(onEdit) && openedAt !== null && canEditMessage(message, openedAt);

  // O gatilho aparece se HOUVER ação. Aqui a checagem de edição é a estrutural,
  // sem relógio — no pior caso o gatilho aparece para abrir um menu com uma
  // opção a menos, o que é bem melhor que uma bolha sem gatilho nenhum.
  const hasAnyAction =
    Boolean(onReply) ||
    canCopy ||
    showForward ||
    showDelete ||
    (Boolean(onEdit) && isEditableMessage(message));
  if (!hasAnyAction) return null;

  async function copy() {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      toast.success("Mensagem copiada.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          // `<button>` puro, e não o primitivo `Button`: a variante `icon-sm`
          // injeta `size-7` e `rounded-[min(...)]`, que o `twMerge` NÃO resolve
          // contra `h-6 w-7`/`rounded-md` — os dois pares sobreviviam no
          // atributo e quem vencia era a ordem do CSS gerado. O resto da
          // superfície do chat (header, busca, barra de seleção) já usa botão
          // puro pelo mesmo motivo.
          <button
            type="button"
            aria-label="Opções da mensagem"
            className={cn(
              "absolute z-10 flex items-center justify-center transition-opacity",
              onMedia
                ? // Dentro da mídia, no canto superior direito: quadradinho
                  // escuro translúcido, como o WhatsApp Web.
                  "top-0.5 right-0.5 h-7 w-8 rounded-md bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
                : // Em texto, FORA da bolha: dentro cobriria a mensagem e o
                  // menu abriria por cima dela.
                  cn(
                    "top-1 size-7 rounded-full bg-black/5 text-current hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20",
                    isOutbound ? "-left-8" : "-right-8"
                  ),
              // Invisível **e inerte**. Antes o `pointer-events-auto` valia
              // sempre no desktop, sem depender do hover: toda bolha de mídia
              // tinha um alvo transparente de 28px no canto que engolia o
              // clique destinado à foto.
              "pointer-events-none opacity-0",
              "[@media(hover:hover)]:group-hover/msg:pointer-events-auto",
              "[@media(hover:hover)]:group-hover/msg:opacity-100",
              // `pointer-events` não bloqueia foco por teclado: o Tab alcança o
              // botão, ele aparece e volta a aceitar clique.
              "focus-visible:pointer-events-auto focus-visible:opacity-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              // Com o menu aberto o ponteiro pode sair da linha; sem isto o
              // gatilho ficaria inerte com o próprio menu na tela.
              "data-[popup-open]:pointer-events-auto data-[popup-open]:opacity-100"
            )}
          />
        }
      >
        <ChevronDownIcon className={onMedia ? "size-[18px]" : "size-3.5"} />
      </DropdownMenuTrigger>
      {/* Abre para o lado LIVRE da linha, nunca por cima da bolha. Base UI
          reposiciona sozinho se não couber na viewport. */}
      {/* Escuro e translúcido, como o do WhatsApp Web. `bg-popover/85` mantém
          o token do tema — não é cor solta. */}
      <DropdownMenuContent
        side={isOutbound ? "inline-start" : "inline-end"}
        align="start"
        className="w-48 border-0 bg-popover/85 shadow-lg ring-foreground/5 backdrop-blur-xl"
      >
        {onReply ? (
          <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={() => onReply(message)}>
            <CornerUpLeftIcon />
            Responder
          </DropdownMenuItem>
        ) : null}
        {canCopy ? (
          <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={copy}>
            <CopyIcon />
            Copiar
          </DropdownMenuItem>
        ) : null}
        {showForward ? (
          <DropdownMenuItem
            className="min-h-11 sm:min-h-8"
            onClick={() => onForward?.(message)}
          >
            <ForwardIcon />
            Encaminhar
          </DropdownMenuItem>
        ) : null}
        {showEdit ? (
          <DropdownMenuItem
            className="min-h-11 sm:min-h-8"
            onClick={() => onEdit?.(message)}
          >
            <PencilIcon />
            Editar
          </DropdownMenuItem>
        ) : null}
        {/* Separador acima de Apagar, como no WhatsApp. Em vermelho: é o que o
            WhatsApp do celular faz e o que o nosso sistema pede para ação
            irreversível — o print do Web, onde ele é branco, ficou vencido. */}
        {showDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="min-h-11 sm:min-h-8"
              onClick={() => onDelete?.(message)}
            >
              <Trash2Icon />
              Apagar
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Menu da anotação interna.
 *
 * Separado do `MessageMenu` porque as regras não têm nada em comum: lá tudo
 * passa pelo WhatsApp (janela de 15 min, `external_id`, provedor que recusa);
 * aqui é o nosso banco e o dono é quem escreveu. Encaminhar e responder não
 * existem — nota não vai para o cliente.
 *
 * Sempre visível, não só no hover: no toque hover não existe, e uma anotação
 * que só a colega consegue corrigir no desktop não serve de registro.
 */
function NoteMenu({
  message,
  onEdit,
  onDelete,
  open,
  onOpenChange,
}: {
  message: ChatMessage;
  onEdit?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!onEdit && !onDelete) return null;

  async function copy() {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      toast.success("Anotação copiada.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Opções da anotação"
            // 44px no toque (UI.md §8), 28 no desktop. O alvo é transparente
            // até o hover, então o botão grande não aparece — só é mais fácil
            // de acertar com o polegar.
            className="absolute right-0.5 top-0.5 flex size-11 items-center justify-center rounded-full text-current/70 transition-colors hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10 sm:size-7"
          />
        }
      >
        <ChevronDownIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="inline-start"
        align="start"
        className="w-44 border-0 bg-popover/85 shadow-lg ring-foreground/5 backdrop-blur-xl"
      >
        {message.content?.trim() ? (
          <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={copy}>
            <CopyIcon />
            Copiar
          </DropdownMenuItem>
        ) : null}
        {onEdit ? (
          <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={() => onEdit(message)}>
            <PencilIcon />
            Editar
          </DropdownMenuItem>
        ) : null}
        {onDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="min-h-11 sm:min-h-8"
              onClick={() => onDelete(message)}
            >
              <Trash2Icon />
              Apagar
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MessageBubbleImpl({
  message,
  showTail = true,
  quoted = null,
  onReply,
  onJumpToQuoted,
  onForward,
  onEdit,
  onDelete,
  onRetry,
  onLongPress,
  teamNames = NO_NAMES,
  viewerId = null,
}: MessageBubbleProps) {
  const isOutbound = message.direction === "outbound";
  const isNote = message.type === "note";
  const [menuOpen, setMenuOpen] = useState(false);
  // Carimba o relógio na ABERTURA do menu. É o que permite decidir a janela de
  // edição sem ler a hora durante a renderização.
  const [menuOpenedAt, setMenuOpenedAt] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const longPress = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const changeMenu = (open: boolean) => {
    if (open) setMenuOpenedAt(Date.now());
    setMenuOpen(open);
  };

  // Toque longo: no celular abre o menu de contexto (fundo borrado, bolha
  // nítida). Sem `onLongPress` — a bolha clonada dentro do próprio menu, por
  // exemplo — cai no dropdown, que é o gesto que já existia.
  const startLongPress = () => {
    if (message.is_deleted) return;
    longPressFired.current = false;
    longPress.current = window.setTimeout(() => {
      longPressFired.current = true;
      if (onLongPress && rowRef.current) {
        // Vibra como o WhatsApp: no toque não há cursor para avisar que o
        // gesto pegou. `vibrate` não existe no iOS — daí o encadeamento.
        navigator.vibrate?.(10);
        onLongPress(message, rowRef.current.getBoundingClientRect());
        return;
      }
      changeMenu(true);
    }, 500);
  };
  const cancelLongPress = () => {
    if (longPress.current !== null) {
      window.clearTimeout(longPress.current);
      longPress.current = null;
    }
  };
  useEffect(() => cancelLongPress, []);

  // Vale para nota e para mensagem: as duas podem ser editadas depois.
  const edited = wasEdited(message) && !message.is_deleted;

  // Internal note — distinct yellow card, centered-right
  if (isNote) {
    const author = noteAuthorLabel(message, teamNames, viewerId);
    const mine = canEditNote(message, viewerId);

    return (
      <div ref={rowRef} data-message-id={message.id} className="group/msg flex w-full justify-end px-2 py-0.5">
        <div className="relative min-w-0 max-w-[85%] rounded-lg border border-amber-300/60 bg-amber-100 px-3 py-2 text-sm text-amber-900 shadow-sm dark:border-amber-700/40 dark:bg-amber-950/60 dark:text-amber-100 sm:max-w-[70%]">
          {/* Assinatura. Anotação sem autor é bilhete anônimo no histórico do atendimento:
              ninguém sabe a quem perguntar depois. O nome só aparece quando
              existe de verdade — nada é inventado para preencher a linha. */}
          {/* `pr-10` é a calha do gatilho de 44px: sem ela o nome do autor
              passa por baixo do botão numa nota de título longo. */}
          <p
            className={cn(
              "mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide opacity-70",
              mine && "pr-10 sm:pr-6"
            )}
          >
            <FileTextIcon className="size-2.5 shrink-0" />
            <span>Nota interna</span>
            {author ? (
              <>
                <span aria-hidden>·</span>
                <span className="min-w-0 truncate normal-case">{author}</span>
              </>
            ) : null}
          </p>

          {message.is_deleted ? (
            <p className="italic opacity-60">🚫 Anotação apagada</p>
          ) : (
            <p className="min-w-0 max-w-full [overflow-wrap:anywhere] leading-relaxed">
              <FormattedText content={message.content ?? ""} />
            </p>
          )}

          <div className="mt-1 flex items-center justify-end gap-1.5">
            {edited && !message.is_deleted ? (
              <span className="text-[10.5px] italic opacity-55">Editada</span>
            ) : null}
            <Time iso={message.created_at} />
          </div>

          {mine ? (
            <NoteMenu
              message={message}
              onEdit={onEdit}
              onDelete={onDelete}
              open={menuOpen}
              onOpenChange={changeMenu}
            />
          ) : null}
        </div>
      </div>
    );
  }

  const documentPresentation = message.type === "document"
    ? getDocumentMessagePresentation(message)
    : null;
  const visibleContent = message.type === "document"
    ? documentPresentation?.caption ?? null
    : message.content;
  const hasText =
    ((message.type === "text" || message.type === "image") && message.content) ||
    Boolean(documentPresentation?.caption);
  // Envio que não foi. A ação de reenviar mora ao lado da hora, dentro da
  // própria bolha: é ali que se olha para saber se a mensagem saiu.
  const failedSend =
    isOutbound && message.delivery_status === "failed" && !message.is_deleted;
  // Só texto puro encaixa a hora na última linha. Com mídia a bolha tem alturas
  // variáveis e a hora sobreposta cairia em cima da imagem. Com falha, também
  // não: o "Tentar novamente" não cabe no cantinho reservado da última linha.
  const inlineMeta =
    message.type === "text" && Boolean(message.content) && !message.is_deleted && !failedSend;
  // Bolha cujo conteúdo principal é visual: a mídia manda na geometria.
  const isMediaBubble =
    ["image", "video", "sticker"].includes(message.type) &&
    Boolean(message.media_url) &&
    !message.is_deleted;
  // Mídia sem legenda: a hora vai SOBRE a imagem, com um véu para continuar
  // legível em foto clara. É o que o WhatsApp faz — numa linha própria, a bolha
  // ganha uma tarja vazia embaixo da foto.
  const metaOverMedia = isMediaBubble && !hasText;
  const imageSize = chatImageDimensions(message.metadata);
  const linkPreview =
    message.type === "text"
      ? buildMessageLinkPreview(
          message.content,
          message.metadata.linkPreview ?? message.metadata
        )
      : null;

  return (
    <div
      ref={rowRef}
      data-message-id={message.id}
      className={cn(
        "group/msg flex w-full px-2",
        showTail ? "mt-1.5" : "mt-0.5",
        isOutbound ? "justify-end" : "justify-start"
      )}
    >
      <div
        onTouchStart={startLongPress}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        // Depois de um toque longo o navegador ainda dispara o `click` no
        // elemento sob o dedo. Sem barrar na captura, segurar em cima de uma
        // imagem abria o menu E o lightbox, e em cima do card de contato
        // chegava a criar um lead sem querer.
        onClickCapture={(event) => {
          if (!longPressFired.current) return;
          longPressFired.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        onContextMenu={(event) => {
          // O menu de contexto do navegador dispara junto com o toque longo no
          // Android e roubaria a interação.
          if (longPress.current !== null || menuOpen) event.preventDefault();
        }}
        className={cn(
          // ⚠️ `wa-bubble-touch` mata a seleção de texto SÓ onde o ponteiro é
          // grosso. Segurar a bolha no iPhone disparava a seleção do WebKit
          // junto com o nosso menu, e a barra nativa ("Copiar · Pesquisar ·
          // Traduzir") subia por cima dele. No desktop o texto continua
          // selecionável — copiar um trecho da mensagem é uso legítimo.
          "wa-bubble-touch",
          // Geometria do WhatsApp Web: raio 7.5px, respiro curto e sombra de
          // 1px quase imperceptível — não `rounded-md` + `shadow-sm`.
          "relative min-w-0 max-w-[84%] rounded-[7.5px] text-sm sm:max-w-[68%]",
          "shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]",
          // Mídia encosta na borda da bolha (padding de 3px, como no WhatsApp);
          // texto puro mantém o respiro maior. Sem isso a foto fica com uma
          // moldura branca em volta e a bolha parece pequena.
          isMediaBubble ? "w-fit p-[3px]" : "px-[9px] pb-[8px] pt-[6px]",
          isOutbound
            ? cn("bg-[var(--wa-out)] text-[var(--wa-out-text)]", showTail && "wa-bubble-out rounded-tr-none")
            : cn("bg-[var(--wa-in)] text-[var(--wa-in-text)]", showTail && "wa-bubble-in rounded-tl-none")
        )}
      >
        {!message.is_deleted ? (
          <MessageMenu
            message={message}
            isOutbound={isOutbound}
            onReply={onReply}
            onForward={onForward}
            onEdit={onEdit}
            onDelete={onDelete}
            open={menuOpen}
            onOpenChange={changeMenu}
            openedAt={menuOpenedAt}
            onMedia={isMediaBubble}
          />
        ) : null}

        {message.is_deleted ? (
          <p className="px-1 py-0.5 text-sm italic opacity-50">🚫 Mensagem apagada</p>
        ) : (
          <div className="flex min-w-0 flex-col gap-1">
            {/* "Encaminhada", como no WhatsApp: seta e itálico acima do
                conteúdo, em cor apagada. O dado já era gravado pela rota de
                encaminhar (`metadata.forwarded`) desde sempre — só não tinha
                quem o mostrasse. Vem antes da citação porque diz respeito à
                mensagem inteira, não ao trecho citado. */}
            {isForwardedMessage(message) ? (
              <span
                className={cn(
                  "flex items-center gap-1 px-1 text-[13px] italic",
                  isOutbound ? "text-[var(--wa-out-text)]/60" : "text-[var(--wa-meta)]",
                  isMediaBubble && "pt-[3px]"
                )}
              >
                <ForwardIcon aria-hidden className="size-3.5 shrink-0" />
                Encaminhada
              </span>
            ) : null}

            {quoted ? (
              <QuotedBlock quoted={quoted} isOutbound={isOutbound} onJump={onJumpToQuoted} />
            ) : null}

            {/* Image */}
            {message.type === "image" && message.media_url && (
              <ImageLightbox
                src={message.media_url}
                thumb={chatThumbSrc(message.media_url, message.metadata)}
                // Dimensões do provedor, quando existem: sem elas cada foto que
                // termina de carregar remede a linha, empurra o que está abaixo
                // e a conversa salta debaixo do dedo. O WebKit não tem scroll
                // anchoring para compensar isso — Chrome e Firefox têm.
                {...(imageSize ?? {})}
              />
            )}

            {/* Audio */}
            {message.type === "audio" && message.media_url && (
              <div className="px-1 pt-0.5">
                <AudioMessage message={message} isOutbound={isOutbound} />
              </div>
            )}

            {/* Video */}
            {message.type === "video" && message.media_url && (
              <video
                controls
                preload="none"
                src={message.media_url}
                className="max-h-[26rem] w-full rounded-[5px]"
              />
            )}

            {/* Document */}
            {message.type === "document" && documentPresentation ? (
              <DocumentMessageCard
                presentation={documentPresentation}
                url={message.media_url}
              />
            ) : null}

            {/* Contato (vCard) — antes caía no ramo "desconhecido" e virava
                `[contact]` em itálico. */}
            {message.type === "contact" && (
              <ContactCard content={message.content} isOutbound={isOutbound} />
            )}

            {/* Sticker */}
            {message.type === "sticker" && message.media_url && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={message.media_url}
                alt="Sticker"
                loading="lazy"
                decoding="async"
                className="size-28 object-contain"
              />
            )}

            {/* Mídia ainda sem URL — chega via FileDownloaded (evita bolha vazia) */}
            {["audio", "image", "video", "sticker"].includes(message.type) &&
              !message.media_url && (
                <div className="flex items-center gap-2 px-1 py-1 text-xs italic opacity-60">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  {message.type === "audio"
                    ? "Áudio"
                    : message.type === "image"
                    ? "Imagem"
                    : message.type === "video"
                    ? "Vídeo"
                    : "Figurinha"}{" "}
                  · carregando…
                </div>
            )}

            {linkPreview ? (
              <LinkPreviewCard
                key={linkPreview.imageUrl ?? linkPreview.url}
                preview={linkPreview}
              />
            ) : null}

            {/* Text content — `*negrito*` e cia. renderizados como no WhatsApp */}
            {hasText && (
              <p
                className={cn(
                  "min-w-0 max-w-full [overflow-wrap:anywhere] leading-[19px]",
                  // A mídia encosta na borda; a legenda precisa do respiro que
                  // a bolha deixou de ter.
                  isMediaBubble && "px-[6px] pb-[2px] pt-[3px]"
                )}
              >
                <FormattedText content={visibleContent ?? ""} />
                {/* Reserva o espaço da hora na ÚLTIMA linha. É assim que o
                    WhatsApp encaixa hora e ticks dentro do texto em vez de
                    empurrar para uma linha só deles. */}
                {inlineMeta && (
                  <span
                    aria-hidden
                    className={cn(
                      "inline-block h-0 align-bottom",
                      // O "Editada" entra ao lado da hora e alarga a reserva —
                      // sem isso a última linha passa por baixo dele.
                      edited
                        ? isOutbound
                          ? "w-[112px]"
                          : "w-[88px]"
                        : isOutbound
                        ? "w-[62px]"
                        : "w-[38px]"
                    )}
                  />
                )}
              </p>
            )}

            {/* Unknown */}
            {!["text", "image", "audio", "video", "document", "sticker", "contact"].includes(
              message.type
            ) &&
              !message.content && (
                <p className="px-1 text-xs italic opacity-50">[{message.type}]</p>
              )}
          </div>
        )}

        {/* Hora + ticks. Em mensagem de texto ficam flutuando no canto, dentro
            do espaço reservado acima; em mídia continuam numa linha própria. */}
        <div
          className={cn(
            "flex items-center justify-end gap-1",
            inlineMeta && "absolute bottom-[5px] right-[9px]",
            metaOverMedia &&
              "absolute bottom-[6px] right-[8px] rounded-full bg-black/50 px-1.5 py-0.5 text-white [&_*]:opacity-100",
            !inlineMeta && !metaOverMedia && "-mt-0.5 pl-10 pr-0.5"
          )}
        >
          {/* Reenviar. Aparece só no que falhou e nunca apaga o texto: a mesma
              bolha volta a "enviando", sem virar uma segunda mensagem. */}
          {failedSend && onRetry ? (
            <button
              type="button"
              onClick={() => onRetry(message)}
              className="-my-1 flex min-h-11 items-center gap-1 rounded-md px-1 text-[11px] font-medium text-red-500 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-6"
            >
              <RotateCcwIcon className="size-3" aria-hidden />
              Tentar novamente
            </button>
          ) : null}
          {/* "Editada" ao lado da hora, como no WhatsApp: sem isso o texto da
              mensagem muda sozinho e ninguém sabe por quê. */}
          {edited && (
            <span className="text-[10.5px] italic opacity-55">Editada</span>
          )}
          <Time iso={message.created_at} />
          <Ticks message={message} />
        </div>
      </div>
    </div>
  );
}

/**
 * `memo` porque a lista tem até 100 bolhas na tela e muda o tempo todo: cada
 * tick de entrega, cada mensagem que chega e cada envio otimista re-renderizava
 * as 100 de uma vez. As props são estáveis (callbacks em `useCallback` e
 * setters de estado), então a comparação rasa resolve — só a bolha que mudou
 * volta a renderizar.
 */
export const MessageBubble = memo(MessageBubbleImpl);

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CornerUpLeftIcon,
  FileIcon,
  ImageIcon,
  Loader2Icon,
  MicIcon,
  PauseIcon,
  PaperclipIcon,
  PlayIcon,
  SendHorizonalIcon,
  StickyNoteIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAudioRecorder } from "@/features/chat/hooks/use-audio-recorder";
import { EmojiPicker } from "@/features/chat/components/emoji-picker";
import { QuickReplyPicker } from "@/features/chat/components/quick-reply-picker";
import {
  matchQuickReplies,
  nextSlashIndex,
  readSlashCommand,
} from "@/features/chat/lib/slash-command";
import { useQuickReplies } from "@/features/quick-replies/hooks/use-quick-replies";
import { stripWhatsappFormat } from "@/features/chat/lib/whatsapp-format";
import { CHAT_COLUMN_CLASS } from "@/features/chat/lib/chat-layout";
import { useIsMobile, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import type { ChatMessage, ConversationStatus } from "@/features/chat/types";

type ChatFooterProps = {
  /** Conversa aberta — a chave do rascunho. */
  conversationId: string;
  /**
   * Muda de valor quando o pai quer o cursor aqui — hoje, ao fechar a tela de
   * envio de anexo. Contador, e não booleano: pedir foco duas vezes seguidas
   * precisa funcionar nas duas.
   */
  focusToken?: number;
  /** Rascunho por conversa. O dono é o ChatShell (ver o porquê lá). */
  drafts: Map<string, string>;
  onSend: (content: string) => Promise<void> | void;
  onSendAudio: (blob: Blob, seconds: number) => Promise<void> | void;
  onSendNote?: (content: string) => Promise<void> | void;
  status: ConversationStatus;
  /** Mensagem sendo respondida, ou null. O envio é feito pelo pai. */
  replyingTo?: ChatMessage | null;
  onCancelReply?: () => void;
  /** Escolha de anexo. O estado e a tela de envio vivem no ChatView, para o
   *  arrastar-e-soltar sobre a conversa cair no mesmo fluxo. */
  onPickFiles?: (files: File[]) => void;
};

type Mode = "message" | "note";

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}


export function ChatFooter({
  conversationId,
  focusToken = 0,
  drafts,
  onSend,
  onSendAudio,
  onSendNote,
  status,
  replyingTo = null,
  onCancelReply,
  onPickFiles,
}: ChatFooterProps) {
  const [value, setValue] = useState(() => drafts.get(conversationId) ?? "");
  const [mode, setMode] = useState<Mode>("message");
  const [sendingAudio, setSendingAudio] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  /**
   * Porta única para mexer no texto: toda alteração guarda o rascunho da
   * conversa. Chamar `setValue` direto em algum lugar faria o rascunho perder
   * justamente o que o emoji e a resposta rápida inserem.
   */
  const changeValue = (next: string) => {
    setValue(next);
    drafts.set(conversationId, next);
  };

  /**
   * Trocar de conversa troca o rascunho.
   *
   * Hoje o `ChatView` é desmontado nessa troca e o compositor já nasce com o
   * rascunho certo; isto garante o mesmo se ele deixar de desmontar. Texto
   * escrito para um cliente aparecendo no campo de outro é o tipo de erro que
   * não se corrige depois de apertar Enter.
   */
  const [syncedConversation, setSyncedConversation] = useState(conversationId);
  if (conversationId !== syncedConversation) {
    setSyncedConversation(conversationId);
    setValue(drafts.get(conversationId) ?? "");
    setMode("message");
  }

  // Anexos
  const [attachOpen, setAttachOpen] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isMobile = useIsMobile();
  /**
   * Teclado virtual — a pergunta é o ponteiro, não a largura.
   *
   * Uma janela estreita no desktop continua tendo teclado físico (e Shift+Enter);
   * um tablet largo, não. É essa distinção que decide se o Enter envia.
   */
  const virtualKeyboard = useMediaQuery("(hover: none) and (pointer: coarse)");
  const rec = useAudioRecorder();
  const isBot = status === "bot";
  const blocked = isBot && mode === "message";
  // ⚠️ A ÚNICA coisa que desabilita o compositor é a IA estar no comando.
  // Envio em andamento NÃO entra aqui: um `loading` global desabilitava o campo,
  // o navegador soltava o foco e a próxima mensagem precisava de um clique para
  // começar a ser escrita. O andamento agora é de cada mensagem, na bolha dela.
  const disabled = blocked;

  /**
   * Respostas rápidas pelo teclado: `/` no começo do campo abre a lista.
   *
   * O dono da lista é este componente — o seletor do ícone e este menu leem a
   * MESMA `store`, senão criar uma resposta num lugar não apareceria no outro.
   *
   * Anotação interna não tem comando: a resposta pronta é texto para o
   * cliente, e oferecer aqui convidaria a colar no lugar errado.
   */
  const quickReplies = useQuickReplies();
  const [slashIndex, setSlashIndex] = useState(0);
  const slashTerm = mode === "note" || disabled ? null : readSlashCommand(value);
  const slashMatches = useMemo(
    () =>
      slashTerm === null
        ? []
        : matchQuickReplies(quickReplies.items ?? [], slashTerm),
    [slashTerm, quickReplies.items]
  );
  // Esc fecha o menu sem apagar o que foi digitado. Zera a cada termo novo, e é
  // por isso que voltar a digitar reabre a lista.
  const [slashDismissed, setSlashDismissed] = useState(false);
  // Aberto de verdade só quando há o que escolher. Um painel vazio roubando o
  // Enter de quem está escrevendo é pior que painel nenhum.
  const slashOpen = slashTerm !== null && slashMatches.length > 0 && !slashDismissed;
  // Índice sempre dentro da lista. Ela encolhe a cada letra digitada, e um
  // destaque fora do intervalo faria o Enter inserir `undefined`.
  const activeIndex = Math.min(slashIndex, Math.max(0, slashMatches.length - 1));

  // Termo novo devolve o destaque para o topo. Ajuste durante o render, não em
  // efeito — é o padrão do repo (ver `syncedConv` no ChatView) e evita o
  // quadro intermediário com a seleção antiga.
  const [syncedTerm, setSyncedTerm] = useState<string | null>(null);
  if (slashTerm !== syncedTerm) {
    setSyncedTerm(slashTerm);
    setSlashIndex(0);
    setSlashDismissed(false);
  }

  // Buscar é efeito colateral e fica no efeito. `ensureLoaded` só troca de
  // identidade quando a lista chega, então isto roda uma vez por barra digitada.
  const { ensureLoaded: ensureQuickReplies } = quickReplies;
  useEffect(() => {
    if (slashTerm !== null) ensureQuickReplies();
  }, [slashTerm, ensureQuickReplies]);

  /**
   * Foco automático — o compositor se prepara sozinho.
   *
   * Responder, assumir o atendimento e abrir a conversa são gestos que dizem
   * "vou escrever agora". Cobrar um clique a mais no campo depois de cada um é
   * atrito que não aparece em teste e aparece em toda conversa do dia.
   */
  const focusComposer = useCallback(() => {
    const el = textareaRef.current;
    if (!el || el.disabled) return;
    // `preventScroll`: no celular o foco já sobe o teclado sozinho, e deixar o
    // navegador ainda rolar até o campo sacode a conversa inteira junto.
    el.focus({ preventScroll: true });
    // Cursor no fim — com rascunho guardado, o padrão do navegador é o começo,
    // e a pessoa acabaria escrevendo antes do que já tinha digitado.
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  /**
   * Responder volta para o modo mensagem: citação não existe em anotação
   * interna, e responder com a aba de nota aberta escreveria a resposta onde o
   * cliente nunca veria.
   *
   * Ajuste durante o RENDER, não em efeito — é o padrão do repo (ver
   * `syncedTerm` acima e `syncedConv` no ChatView) e o que o lint exige.
   */
  const replyingToId = replyingTo?.id ?? null;
  const [syncedReplyId, setSyncedReplyId] = useState(replyingToId);
  if (replyingToId !== syncedReplyId) {
    setSyncedReplyId(replyingToId);
    if (replyingToId) setMode("message");
  }

  /**
   * E põe o cursor no campo — inclusive no celular: tocar em "Responder" é
   * dizer que a próxima coisa é digitar.
   */
  useEffect(() => {
    if (!replyingToId) return;
    focusComposer();
  }, [replyingToId, focusComposer]);

  /**
   * O pai pediu o cursor de volta — fechar a tela de envio de anexo, por
   * exemplo. Sem isto, mandar uma foto e querer escrever em seguida cobrava um
   * clique no campo: o diálogo devolve o foco ao clipe (ou a lugar nenhum,
   * quando o anexo entrou por colar ou arrastar).
   *
   * `> 0` porque o valor inicial não é um pedido, é só o estado de repouso.
   */
  useEffect(() => {
    if (focusToken === 0 || virtualKeyboard) return;
    focusComposer();
  }, [focusToken, virtualKeyboard, focusComposer]);

  /**
   * Abrir a conversa e assumir o atendimento também deixam o campo pronto —
   * mas **só no desktop**. No celular o mesmo foco abriria o teclado por cima
   * da conversa que a pessoa acabou de abrir para ler.
   *
   * Roda na montagem (o `ChatView` remonta a cada troca de conversa) e quando o
   * campo deixa de estar bloqueado, que é exatamente o "Assumir": o campo
   * estava `disabled`, o navegador soltou o foco e ninguém o devolvia.
   */
  useEffect(() => {
    if (virtualKeyboard || blocked) return;
    // Não rouba foco de quem está usando outro campo: um "Assumir" feito por
    // outra pessoa chega por Realtime e não pode puxar o cursor de dentro da
    // busca ou de um diálogo aberto.
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable ||
        active.closest("[role='dialog'],[data-slot='dialog-content']") !== null)
    ) {
      return;
    }
    focusComposer();
  }, [virtualKeyboard, blocked, focusComposer]);

  /**
   * Esc desfaz primeiro o que está aberto no PRÓPRIO compositor.
   *
   * O clipe é um painel solto (não é diálogo do Base UI) e a gravação não é
   * painel nenhum — sem isto, o Esc que fecha a conversa (ChatView) levaria
   * junto um áudio já gravado. `preventDefault` é o sinal de "eu tratei".
   */
  // Desmembrado antes do efeito, e não lido como `rec.x` dentro dele: o objeto
  // do gravador é novo a cada render, e depender de `rec` religaria o listener
  // a cada tecla digitada.
  const { state: recorderState, cancel: cancelRecording } = rec;
  useEffect(() => {
    if (!attachOpen && recorderState === "idle") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (attachOpen) {
        setAttachOpen(false);
        return;
      }
      // Vale para a gravação em curso e para o áudio já gravado: `cancel`
      // descarta os dois e devolve o compositor.
      cancelRecording();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [attachOpen, recorderState, cancelRecording]);

  // A opção destacada precisa ficar visível quando se navega pelas setas.
  // `block: "nearest"` não mexe em ancestral que já está no lugar.
  const slashPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!slashOpen) return;
    slashPanelRef.current
      ?.querySelector<HTMLElement>('[data-slash-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, slashOpen]);

  const applyQuickReply = (content: string) => {
    // O gatilho exige que o campo inteiro seja `/atalho`, então trocar tudo é
    // exatamente substituir o comando pelo texto.
    changeValue(content);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(content.length, content.length);
      grow(el);
    });
  };

  // Reset textarea height when cleared
  useEffect(() => {
    if (!value && textareaRef.current) textareaRef.current.style.height = "auto";
  }, [value]);

  /**
   * Altura do compositor: cresce com o texto até um teto.
   *
   * O teto é em `lh` (altura de linha), não em pixel fixo: no celular a fonte
   * é 16px — obrigatória, senão o iOS dá zoom ao focar — e um teto de 120px que
   * cabia 4 linhas a 14px passava a caber 3. Em `lh` o limite é "5 linhas",
   * independente do tamanho da fonte.
   */
  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const max = lineHeight * 5;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  };

  /**
   * ⚠️ Síncrona e sem `await`: o envio NÃO é esperado.
   *
   * Quem mostra o andamento é a bolha da mensagem (relógio → ✓), então o campo
   * esvazia, recupera o foco e já aceita a próxima frase no mesmo quadro. É o
   * que faz mandar cinco mensagens seguidas parecer instantâneo.
   */
  const handleSend = () => {
    // O botão de enviar respeita o menu do `/` igual ao Enter. Sem isto, clicar
    // no avião com a lista aberta mandava `/teste` como texto para o cliente.
    if (slashOpen) {
      applyQuickReply(slashMatches[activeIndex].content);
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    changeValue("");
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      // Clicar no avião move o foco para o botão — e o botão some assim que o
      // campo esvazia (dá lugar ao microfone). Sem devolver o foco aqui, a
      // próxima mensagem exigiria um clique de volta no campo.
      el.focus();
    }

    if (mode === "note") void onSendNote?.(trimmed);
    else void onSend(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ⚠️ IME antes de tudo. Durante a composição (acento morto, teclado
    // japonês, sugestão do Android) o Enter CONFIRMA a palavra — enviar ali
    // cortaria a frase no meio. `keyCode === 229` é o sinal legado dos teclados
    // que não preenchem `isComposing`.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    // ⚠️ O menu do `/` vem ANTES do envio. Com ele aberto, Enter escolhe a
    // resposta; sem esta ordem, `/teste` + Enter enviava a barra como texto —
    // que é exatamente o bug relatado.
    if (slashOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex(
          nextSlashIndex(
            activeIndex,
            slashMatches.length,
            e.key === "ArrowDown" ? 1 : -1
          )
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyQuickReply(slashMatches[activeIndex].content);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // Fecha o menu e MANTÉM o que foi digitado. Apagar o campo inteiro
        // para o menu não reabrir cobrava o texto da pessoa por um Esc.
        setSlashDismissed(true);
        return;
      }
    }

    // Enter envia no desktop; Shift+Enter quebra linha.
    //
    // Com teclado virtual ele quebra linha, como no WhatsApp do celular: ali
    // não existe Shift+Enter, e interceptar o Enter tornaria impossível escrever
    // mensagem de várias linhas. O envio é pelo botão, que está do lado.
    if (e.key === "Enter" && !e.shiftKey && !virtualKeyboard) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    changeValue(e.target.value);
    grow(e.target);
  };

  // Insere texto na posição do cursor (ou no fim, se sem foco). Emojis e
  // respostas rápidas compartilham o mesmo caminho para preservar a seleção.
  const insertText = (text: string) => {
    const el = textareaRef.current;
    if (!el) {
      changeValue(value + text);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    changeValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
      grow(el);
    });
  };

  const handleSendAudio = async () => {
    if (!rec.audioBlob) return;
    setSendingAudio(true);
    try {
      await onSendAudio(rec.audioBlob, rec.seconds);
      rec.reset();
    } finally {
      setSendingAudio(false);
    }
  };

  const togglePreview = () => {
    const a = previewRef.current;
    if (!a) return;
    if (previewPlaying) a.pause();
    else void a.play();
  };

  // ── Anexos ──────────────────────────────────────────────────────
  const pickFiles = (files: FileList | null) => {
    setAttachOpen(false);
    if (files?.length) onPickFiles?.(Array.from(files));
  };


  // ── Recording bar ───────────────────────────────────────────────
  if (rec.state === "recording") {
    return (
      <FooterFrame>
        <div className="flex items-center gap-3 px-2 py-1">
          <button
            type="button"
            onClick={rec.cancel}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-red-500 hover:bg-red-500/10"
            aria-label="Cancelar gravação"
          >
            <Trash2Icon className="size-5" />
          </button>
          <div className="flex flex-1 items-center gap-2">
            <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
            <span className="text-sm font-medium tabular-nums text-foreground">
              {fmt(rec.seconds)}
            </span>
            <span className="text-sm text-[var(--wa-meta)]">Gravando áudio…</span>
          </div>
          <button
            type="button"
            onClick={rec.stop}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--wa-green-deep)] text-white hover:opacity-90"
            aria-label="Finalizar gravação"
          >
            <SendHorizonalIcon className="size-5" />
          </button>
        </div>
      </FooterFrame>
    );
  }

  // ── Recorded preview ────────────────────────────────────────────
  if (rec.state === "recorded" && rec.audioUrl) {
    return (
      <FooterFrame>
        <div className="flex items-center gap-3 px-2 py-1">
          <button
            type="button"
            onClick={rec.reset}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-red-500 hover:bg-red-500/10"
            aria-label="Descartar áudio"
          >
            <Trash2Icon className="size-5" />
          </button>
          <button
            type="button"
            onClick={togglePreview}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--wa-green-deep)] text-white"
            aria-label={previewPlaying ? "Pausar" : "Reproduzir"}
          >
            {previewPlaying ? (
              <PauseIcon className="size-4" />
            ) : (
              <PlayIcon className="size-4 translate-x-px" />
            )}
          </button>
          <div className="flex flex-1 items-center gap-2 text-sm text-[var(--wa-meta)]">
            <MicIcon className="size-4" />
            Áudio gravado · {fmt(rec.seconds)}
          </div>
          <audio
            ref={previewRef}
            src={rec.audioUrl}
            className="hidden"
            onPlay={() => setPreviewPlaying(true)}
            onPause={() => setPreviewPlaying(false)}
            onEnded={() => setPreviewPlaying(false)}
          />
          <button
            type="button"
            onClick={handleSendAudio}
            disabled={sendingAudio}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--wa-green-deep)] text-white hover:opacity-90 disabled:opacity-60"
            aria-label="Enviar áudio"
          >
            {sendingAudio ? (
              <Loader2Icon className="size-5 animate-spin" />
            ) : (
              <SendHorizonalIcon className="size-5" />
            )}
          </button>
        </div>
      </FooterFrame>
    );
  }

  // ── Default composer ────────────────────────────────────────────
  return (
    <div className="shrink-0 border-t border-[var(--wa-panel-border)] bg-[var(--wa-panel)]">
      {/* Respondendo — só no modo mensagem: anotação interna não vai ao contato,
          então não existe citação a mandar.

          A largura vai num EMBRULHO, não na caixa: se a coluna compartilhada
          fosse aplicada diretamente, o `twMerge` descartaria o padding base
          contra o `px-2.5` da caixa, mas preservaria os variantes responsivos e
          criaria respiro interno diferente em cada breakpoint. */}
      {replyingTo && (
        <div className="pt-2">
          <div className={FOOTER_ROW}>
            <div className="flex items-start gap-2 rounded-md border-l-[3px] border-l-[var(--wa-green-deep)] bg-black/[0.04] px-2.5 py-1.5 dark:bg-white/[0.06]">
              <CornerUpLeftIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--wa-meta)]" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-[var(--wa-green-deep)]">
                  Respondendo {replyingTo.direction === "outbound" ? "você mesmo" : "o contato"}
                </p>
                <p className="line-clamp-2 break-words text-xs text-[var(--wa-meta)]">
                  {replyingTo.content?.trim()
                    ? stripWhatsappFormat(replyingTo.content).replace(/\s+/g, " ")
                    : `[${replyingTo.type}]`}
                </p>
              </div>
              <button
                type="button"
                // Devolve o foco ao campo: o ✕ some junto com a barra, e sem
                // isto o foco cairia no `body` — mais um clique para voltar a
                // escrever a mensagem que a pessoa ia mandar de qualquer jeito.
                onClick={() => {
                  onCancelReply?.();
                  focusComposer();
                }}
                aria-label="Cancelar resposta"
                className="flex size-11 shrink-0 items-center justify-center rounded-md text-[var(--wa-meta)] hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10 sm:size-7"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Abas de modo — visíveis TAMBÉM no celular.
          Antes ficavam escondidas ali e a única porta era o menu do clipe. Um
          clipe promete "anexar arquivo": anotação interna escondida ali é
          feature que, no telefone, não existe. Com a conversa em modo imersivo
          (cabeçalho e nav somem) sobra a linha de 34px que essa troca custa. */}
      <div className={cn(FOOTER_ROW, "flex items-center gap-1 pt-2")}>
        <ModeTab active={mode === "message"} onClick={() => setMode("message")}>
          <SendHorizonalIcon className="size-3" /> Mensagem
        </ModeTab>
        {onSendNote && (
          <ModeTab
            active={mode === "note"}
            onClick={() => {
              setMode("note");
              // Anotação interna não vai ao contato: manter a resposta pendente
              // faria a citação reaparecer na próxima mensagem sem aviso.
              onCancelReply?.();
            }}
          >
            <StickyNoteIcon className="size-3" /> Anotação interna
          </ModeTab>
        )}
      </div>

      {isBot && mode === "message" && (
        <div className={cn(FOOTER_ROW, "pt-2")}>
          <p className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">
            O atendimento automático está ativo. Use <strong>Assumir</strong> para responder.
          </p>
        </div>
      )}

      <div className={cn(FOOTER_ROW, "flex items-end gap-2 py-2.5")}>
        <EmojiPicker onSelect={insertText} disabled={disabled} />

        {/* Anexar */}
        <div className="relative shrink-0">
          <button
            type="button"
            disabled={disabled || !onPickFiles}
            onClick={() => setAttachOpen((o) => !o)}
            className="flex size-11 items-center justify-center rounded-full text-[var(--wa-meta)] hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5 sm:size-9"
            aria-label="Anexar"
          >
            <PaperclipIcon className="size-5" />
          </button>

          {/* No celular é gaveta; no desktop segue o painel ANCORADO no clipe.
              A troca é explícita, e não pelo `Dialog` responsivo, porque um
              diálogo é posicionado pela viewport: no desktop ele nasceria no
              canto da tela, sobre a lista de conversas, em vez de ao lado do
              botão que o abriu. */}
          {onPickFiles && isMobile && (
            <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
              <DialogContent showCloseButton={false} className="p-0">
                <DialogTitle className="sr-only">Anexar</DialogTitle>
                <div className="py-1">
                  <AttachOption
                    icon={<ImageIcon className="size-4" />}
                    label="Fotos e vídeos"
                    onClick={() => {
                      setAttachOpen(false);
                      mediaInputRef.current?.click();
                    }}
                  />
                  <AttachOption
                    icon={<FileIcon className="size-4" />}
                    label="Arquivo"
                    onClick={() => {
                      setAttachOpen(false);
                      fileInputRef.current?.click();
                    }}
                  />
                </div>
              </DialogContent>
            </Dialog>
          )}

          {/* Desktop: o painel de sempre, ancorado no clipe. */}
          {onPickFiles && !isMobile && attachOpen && (
            <>
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setAttachOpen(false)}
              />
              <div className="absolute bottom-11 left-0 z-20 w-52 overflow-hidden rounded-xl border border-[var(--wa-panel-border)] bg-popover py-1 shadow-lg">
                <AttachOption
                  icon={<ImageIcon className="size-4" />}
                  label="Fotos e vídeos"
                  onClick={() => {
                    setAttachOpen(false);
                    mediaInputRef.current?.click();
                  }}
                />
                <AttachOption
                  icon={<FileIcon className="size-4" />}
                  label="Arquivo"
                  onClick={() => {
                    setAttachOpen(false);
                    fileInputRef.current?.click();
                  }}
                />
              </div>
            </>
          )}

          <input
            ref={mediaInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              pickFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              pickFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div className="relative flex min-w-0 flex-1 items-end">
          {/* Região viva: quem não vê a tela precisa saber que a barra abriu
              uma lista, quantas opções ela tem e como percorrer. */}
          <p
            id="slash-quick-replies-status"
            role="status"
            aria-live="polite"
            className="sr-only"
          >
            {slashOpen
              ? `${slashMatches.length} resposta(s) rápida(s). Use as setas para navegar e Enter para inserir.`
              : ""}
          </p>

          {slashOpen && (
            <div
              ref={slashPanelRef}
              role="listbox"
              aria-label="Respostas rápidas"
              className="absolute inset-x-0 bottom-full z-30 mb-2 overflow-hidden rounded-xl border border-[var(--wa-panel-border)] bg-popover text-popover-foreground shadow-lg"
            >
              <p className="border-b border-[var(--wa-panel-border)] px-3 py-1.5 text-[11px] text-muted-foreground">
                Resposta rápida — <kbd className="font-sans">↑↓</kbd> navega,{" "}
                <kbd className="font-sans">Enter</kbd> insere,{" "}
                <kbd className="font-sans">Esc</kbd> sai
              </p>
              <div className="max-h-[40dvh] overflow-y-auto overscroll-contain sm:max-h-64">
                {slashMatches.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    data-slash-active={index === activeIndex}
                    // `onPointerDown` com `preventDefault`, não `onClick`: o
                    // clique tira o foco do campo antes de disparar, e o campo
                    // sem foco fecha o menu antes da escolha acontecer.
                    onPointerDown={(event) => {
                      event.preventDefault();
                      applyQuickReply(item.content);
                    }}
                    onMouseEnter={() => setSlashIndex(index)}
                    className={cn(
                      "grid min-h-14 w-full gap-0.5 px-3 py-2 text-left outline-none transition-colors sm:min-h-12",
                      index === activeIndex && "bg-black/5 dark:bg-white/5"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{item.title}</span>
                      <span className="shrink-0 font-mono text-xs text-[var(--wa-green-deep)]">
                        /{item.shortcut}
                      </span>
                    </span>
                    <span className="line-clamp-1 break-words text-xs text-muted-foreground">
                      {item.content}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
            // Nada de `aria-expanded`/`role="combobox"` aqui: o papel implícito
            // de `textarea` é `textbox`, e forçar combobox num campo de várias
            // linhas confunde o leitor de tela sobre o que é editável. Quem
            // anuncia a lista é a região viva logo abaixo.
            aria-describedby={slashOpen ? "slash-quick-replies-status" : undefined}
            placeholder={
              blocked
                ? "Assuma o atendimento para responder…"
                : mode === "note"
                  ? "Escreva uma anotação interna (não é enviada ao cliente)…"
                  : "Digite uma mensagem"
            }
            className={cn(
              // `text-base` no celular NÃO é estética: abaixo de 16px o iOS dá
              // zoom automático ao focar, e a página fica panorâmica mesmo
              // depois de fechar o teclado. Mesmo par de `ui/input.tsx`.
              "w-full resize-none rounded-2xl px-4 py-2.5 text-base outline-none transition-colors md:text-sm",
              "placeholder:text-[var(--wa-meta)]/70 disabled:cursor-not-allowed disabled:opacity-60",
              // A calha do botão de respostas rápidas só existe quando o botão
              // existe. Em anotação ele saía de cena e deixava 48px de vazio.
              mode === "note"
                ? "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
                : "bg-background pr-12 text-foreground"
            )}
            // Em `lh`, pelo mesmo motivo do `grow`: com 16px no celular um teto
            // fixo em pixel muda quantas linhas cabem.
            style={{ minHeight: "44px", maxHeight: "5lh" }}
            aria-label={mode === "note" ? "Anotação" : "Mensagem"}
          />
          {/* Anotação interna não recebe resposta pronta: o texto é para o
              cliente, e um botão inerte ali só ocupava a calha. */}
          {mode !== "note" && (
            <div className="absolute bottom-1 right-1">
              <QuickReplyPicker
                onSelect={insertText}
                disabled={disabled}
                store={quickReplies}
              />
            </div>
          )}
        </div>

        {value.trim() ? (
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--wa-green-deep)] text-white hover:opacity-90 disabled:opacity-50"
            aria-label="Enviar"
          >
            {/* Sem giratória: o botão não espera o servidor. O andamento é da
                mensagem, na bolha dela. */}
            <SendHorizonalIcon className="size-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void rec.start()}
            disabled={disabled || mode === "note"}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--wa-green-deep)] text-white hover:opacity-90 disabled:opacity-40"
            aria-label="Gravar áudio"
            title={mode === "note" ? "Áudio indisponível em anotações" : "Gravar áudio"}
          >
            <MicIcon className="size-5" />
          </button>
        )}
      </div>

      {rec.error && (
        <p className="px-4 pb-2 text-[11px] text-red-500">{rec.error}</p>
      )}
    </div>
  );
}

function AttachOption({
  icon,
  label,
  onClick,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // 56px no celular (linha de folha), 44px no desktop.
        "flex min-h-14 w-full items-center gap-3 px-4 text-left text-base text-foreground hover:bg-black/5 dark:hover:bg-white/5 sm:min-h-11 sm:px-3 sm:text-sm",
        className
      )}
    >
      <span className="text-[var(--wa-green-deep)]">{icon}</span>
      {label}
    </button>
  );
}

/**
 * Largura útil do rodapé, igual à da lista de mensagens
 * A coluna é fluida: acompanha o painel com gutters progressivos, sem um teto
 * fixo que centralize toda a conversa em monitores largos.
 *
 * A constante compartilhada impede que mensagens, busca e compositor voltem a
 * divergir quando a responsividade mudar.
 */
const FOOTER_ROW = CHAT_COLUMN_CLASS;

function FooterFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="shrink-0 border-t border-[var(--wa-panel-border)] bg-[var(--wa-panel)] py-2">
      <div className={FOOTER_ROW}>{children}</div>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-11 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 text-[11px] font-medium transition-colors sm:min-h-8",
        active
          ? "border-[var(--wa-green-deep)] text-[var(--wa-green-deep)]"
          : "border-transparent text-[var(--wa-meta)] hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EmojiPicker } from "@/features/chat/components/emoji-picker";
import { MessageBubble } from "@/features/chat/components/message-bubble";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/features/chat/types";

/**
 * Editar mensagem, no formato do WhatsApp Desktop: cabeçalho com fechar à
 * esquerda, a mensagem sobre o fundo da conversa, e o campo com sublinhado
 * verde, emoji e o botão redondo de confirmar.
 *
 * A prévia é a **`MessageBubble` de verdade**, dentro de `.wa-surface`/
 * `.wa-doodle`. Redesenhar a bolha aqui seria a segunda cópia da geometria do
 * WhatsApp no repositório, e as duas iam divergir na primeira mudança.
 *
 * A bolha mostra o texto **original**, parado. É a mensagem que se está
 * editando — comparar o antes com o que se digita é o valor da tela.
 */
export function EditMessageDialog({
  message,
  saving,
  onCancel,
  onSave,
}: {
  message: ChatMessage;
  saving: boolean;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(message.content ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const guard = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Falhou e o diálogo seguiu aberto: libera para tentar de novo. O sucesso
  // desmonta o componente, então isto só roda no caminho do erro.
  useEffect(() => {
    if (!saving) guard.current = false;
  }, [saving]);

  const trimmed = text.trim();
  const unchanged = trimmed === (message.content ?? "").trim();
  const canSave = trimmed.length > 0 && !unchanged && !saving;

  const submit = () => {
    // `disabled` só chega ao DOM depois do re-render: dois Enter seguidos
    // disparariam dois /message/edit, e o segundo usaria um id que a primeira
    // edição já trocou — erro na cara do operador sem nada ter dado errado.
    if (!canSave || guard.current) return;
    guard.current = true;
    onSave(trimmed);
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Fechar no meio do envio deixaria a tela sem saber se gravou. Um guard
        // no `onOpenChange` cobre X, Esc e clique fora de uma vez.
        if (!next && !saving) onCancel();
      }}
    >
      {/* `wa-surface` no PRÓPRIO diálogo: ele é portalado para o `body`, fora
          da árvore do chat, e sem isto todo `--wa-green` cairia no valor
          padrão — o verde claro, inclusive no tema escuro. A classe só declara
          variáveis, não pinta nada. */}
      {/* Folha de tela cheia no celular (o teclado sobe e uma caixinha
          centrada fica espremida), caixa centrada no desktop. */}
      <DialogContent
        showCloseButton={false}
        // No celular a gaveta assume a geometria; aqui fica só o desktop.
        className={cn(
          "wa-surface flex flex-col gap-0 overflow-hidden p-0",
          "sm:w-[calc(100%-2rem)] sm:max-w-xl"
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-3 px-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            aria-label="Cancelar edição"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 sm:size-9"
          >
            <XIcon className="size-5" />
          </button>
          <DialogTitle className="font-sans text-[15px]">Editar mensagem</DialogTitle>
        </div>

        {/* A mensagem, sobre o fundo da conversa. Só mensagem nossa é editável,
            então a bolha sempre cai à direita.

            `pointer-events-none` no embrulho: aqui a bolha é ilustração. Sem
            isso o gatilho do menu aparece no hover (o "Copiar" sozinho já basta
            para ele existir) e o lightbox abriria por cima do diálogo. */}
        {/* Na gaveta a altura é limitada pelo teto dela (92dvh), então o corpo
            rola dentro; no desktop, o teto é próprio. */}
        <div className="wa-doodle max-h-[40dvh] min-h-32 overflow-y-auto overscroll-contain px-3 py-6 sm:max-h-[55vh] sm:px-6">
          <div className="pointer-events-none">
            <MessageBubble message={message} showTail />
          </div>
        </div>

        {/* Campo com sublinhado verde, como no WhatsApp: a linha atravessa a
            faixa inteira, por baixo do emoji e do botão. */}
        <div className="flex items-center gap-2 border-b-2 border-[var(--wa-green)] px-3 py-2 sm:px-6">
          <input
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            disabled={saving}
            aria-label="Novo texto da mensagem"
            className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-muted-foreground disabled:opacity-50 md:text-[15px]"
          />
          <EmojiPicker
            disabled={saving}
            onSelect={(emoji) => setText((current) => current + emoji)}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!canSave}
            aria-label="Salvar edição"
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-full",
              "bg-[var(--wa-green)] text-white transition-opacity",
              "hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:opacity-40"
            )}
          >
            {saving ? (
              <Loader2Icon className="size-5 animate-spin" />
            ) : (
              <CheckIcon className="size-6" />
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

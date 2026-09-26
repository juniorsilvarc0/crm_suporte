"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  FileIcon,
  Loader2Icon,
  PlusIcon,
  SendHorizonalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmojiPicker } from "@/features/chat/components/emoji-picker";
import {
  MAX_ATTACHMENT_BATCH,
  type AttachmentBatchProgress,
  type AttachmentDraft,
} from "@/features/chat/lib/attachment-batch";
import { formatBytes } from "@/lib/formatters/bytes";
import { cn } from "@/lib/utils";

/**
 * Revisão de anexos — sheet lateral contido na área da conversa.
 *
 * A faixa mantém somente metadados. Apenas o anexo ativo cria `objectURL` e
 * monta imagem/vídeo, evitando decodificar o lote inteiro no PWA do iPhone.
 */
export function FilePreviewDialog({
  attachments,
  portalContainer,
  contactName,
  progress,
  error,
  onAdd,
  onRemove,
  onCaptionChange,
  onCancel,
  onSend,
}: {
  attachments: AttachmentDraft[];
  portalContainer: RefObject<HTMLDivElement | null>;
  contactName: string;
  progress: AttachmentBatchProgress | null;
  error: string | null;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  onCaptionChange: (id: string, caption: string) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dimensions, setDimensions] = useState<Record<string, string>>({});
  const sheetRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const safeIndex = Math.min(activeIndex, attachments.length - 1);
  const active = attachments[safeIndex];
  const sending = progress !== null;

  if (!active) return null;

  const submit = () => {
    if (!sending) onSend();
  };

  const requestClose = () => {
    if (!sending) setOpen(false);
  };

  const selectAttachment = (index: number) => {
    setActiveIndex(index);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.style.height = "auto";
      grow(input);
      input.focus({ preventScroll: true });
    });
  };

  const removeActive = () => {
    if (sending) return;
    if (attachments.length === 1) {
      requestClose();
      return;
    }
    if (safeIndex === attachments.length - 1) {
      setActiveIndex(Math.max(0, safeIndex - 1));
    }
    onRemove(active.id);
  };

  return (
    <Dialog
      variant="dialog"
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
      onOpenChangeComplete={(next) => {
        if (next) {
          inputRef.current?.focus({ preventScroll: true });
          return;
        }
        onCancel();
      }}
    >
      <DialogContent
        ref={sheetRef}
        presentation="sheet"
        portalContainer={portalContainer}
        showCloseButton={false}
        initialFocus={sheetRef}
        data-chat-sheet=""
        className="bg-[var(--wa-preview-bg)] text-[var(--wa-preview-fg)]"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">
          {attachments.length === 1
            ? `Enviar ${active.file.name} para ${contactName}`
            : `Enviar ${attachments.length} anexos para ${contactName}`}
        </DialogTitle>

        <div
          aria-hidden
          className="h-0.5 shrink-0 overflow-hidden bg-black/10 dark:bg-white/10"
        >
          {sending && (
            <div className="h-full w-1/3 animate-[wa-indeterminate_1.1s_ease-in-out_infinite] rounded-full bg-[var(--wa-green,#25d366)]" />
          )}
        </div>

        <div className="flex h-14 shrink-0 items-center gap-2 px-2 sm:px-4">
          <DialogClose
            render={
              <button
                type="button"
                disabled={sending}
                aria-label="Cancelar envio"
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-black/60 transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/30 disabled:opacity-40 sm:size-9 dark:text-white/80 dark:hover:bg-white/10 dark:focus-visible:ring-white/60"
              />
            }
          >
            <XIcon className="size-5" />
          </DialogClose>

          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-sm font-medium">{active.file.name}</p>
            <p className="truncate text-[11px] text-black/50 dark:text-white/50">
              {attachments.length > 1 ? `${safeIndex + 1} de ${attachments.length} · ` : ""}
              {describeKind(active.file)} · {formatBytes(active.file.size)}
              {dimensions[active.id] ? ` · ${dimensions[active.id]}` : ""}
            </p>
          </div>

          <button
            type="button"
            onClick={removeActive}
            disabled={sending}
            aria-label={`Remover ${active.file.name}`}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-black/60 transition-colors hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/30 disabled:opacity-40 sm:size-9 dark:text-white/80 dark:hover:text-red-300 dark:focus-visible:ring-white/60"
          >
            <Trash2Icon className="size-4.5" />
          </button>
        </div>

        <div className="flex min-h-[8rem] flex-1 items-center justify-center overflow-hidden px-4 py-2">
          <AttachmentPreview
            key={active.id}
            attachment={active}
            onDimensions={(value) =>
              setDimensions((current) => ({ ...current, [active.id]: value }))
            }
          />
        </div>

        <div className="shrink-0 px-3 pb-3 pt-2 sm:px-5">
          <div
            className="mx-auto mb-2 flex w-full max-w-2xl gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]"
            aria-label="Anexos selecionados"
          >
            {attachments.map((attachment, index) => (
              <button
                key={attachment.id}
                type="button"
                onClick={() => selectAttachment(index)}
                disabled={sending}
                aria-label={`Selecionar ${attachment.file.name}`}
                aria-current={index === safeIndex ? "true" : undefined}
                className={cn(
                  "flex h-10 max-w-44 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-left text-xs transition-colors disabled:opacity-50",
                  index === safeIndex
                    ? "border-[var(--wa-green)] bg-[var(--wa-green)]/10"
                    : "border-black/10 bg-black/[0.03] hover:bg-black/[0.06] dark:border-white/10 dark:bg-white/[0.06] dark:hover:bg-white/10"
                )}
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded bg-black/5 text-[10px] font-semibold dark:bg-white/10">
                  {index + 1}
                </span>
                <span className="truncate">{attachment.file.name}</span>
              </button>
            ))}

            <button
              type="button"
              onClick={() => addInputRef.current?.click()}
              disabled={sending || attachments.length >= MAX_ATTACHMENT_BATCH}
              aria-label="Adicionar mais anexos"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-black/20 text-black/55 transition-colors hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:text-white/70 dark:hover:bg-white/10"
            >
              <PlusIcon className="size-4" />
            </button>
            <input
              ref={addInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) {
                  onAdd(Array.from(event.target.files));
                }
                event.target.value = "";
              }}
            />
          </div>

          <div className="mx-auto flex w-full max-w-2xl items-end gap-1 rounded-2xl bg-black/5 px-2 py-1 dark:bg-white/10">
            <textarea
              ref={inputRef}
              value={active.caption}
              rows={1}
              onChange={(event) => {
                onCaptionChange(active.id, event.target.value);
                grow(event.target);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              disabled={sending}
              placeholder={`Legenda para ${active.file.name}`}
              aria-label="Legenda do anexo"
              className="min-h-11 min-w-0 flex-1 resize-none bg-transparent px-3 py-2.5 text-base outline-none placeholder:text-black/40 disabled:opacity-50 md:text-[15px] dark:placeholder:text-white/40"
            />
            <EmojiPicker
              disabled={sending}
              onSelect={(emoji) =>
                onCaptionChange(active.id, active.caption + emoji)
              }
            />
          </div>

          {error && (
            <p
              role="alert"
              className="mx-auto mt-2 w-full max-w-2xl text-sm text-red-600 dark:text-red-300"
            >
              {error}
            </p>
          )}

          <div className="mx-auto mt-2.5 flex w-full max-w-2xl items-center justify-between gap-3">
            <span
              className="min-w-0 truncate rounded-md bg-black/5 px-2.5 py-1 text-[13px] text-black/70 dark:bg-white/10 dark:text-white/80"
              aria-live="polite"
            >
              {progress
                ? `Enviando ${progress.current} de ${progress.total} para ${contactName}…`
                : `${attachments.length} ${attachments.length === 1 ? "anexo" : "anexos"} · ${contactName}`}
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={sending}
              aria-label={
                sending
                  ? `Enviando anexo ${progress.current} de ${progress.total}`
                  : attachments.length === 1
                    ? "Enviar anexo"
                    : `Enviar ${attachments.length} anexos`
              }
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--wa-green,#25d366)] text-white transition-opacity",
                "hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/30 disabled:opacity-60 dark:focus-visible:ring-white"
              )}
            >
              {sending ? (
                <Loader2Icon className="size-6 animate-spin" />
              ) : (
                <SendHorizonalIcon className="size-6" />
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AttachmentPreview({
  attachment,
  onDimensions,
}: {
  attachment: AttachmentDraft;
  onDimensions: (value: string) => void;
}) {
  const { file } = attachment;
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  const [preview] = useState<string | null>(() =>
    isImage || isVideo ? URL.createObjectURL(file) : null
  );

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  if (isImage && preview) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={preview}
        alt={`Prévia de ${file.name}`}
        onLoad={(event) =>
          onDimensions(
            `${event.currentTarget.naturalWidth}×${event.currentTarget.naturalHeight}`
          )
        }
        className="max-h-[42dvh] max-w-full rounded-md object-contain"
      />
    );
  }

  if (isVideo && preview) {
    return (
      <video
        src={preview}
        controls
        preload="metadata"
        onLoadedMetadata={(event) =>
          onDimensions(
            `${event.currentTarget.videoWidth}×${event.currentTarget.videoHeight}`
          )
        }
        className="max-h-[42dvh] max-w-full rounded-md"
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <div className="flex size-24 items-center justify-center rounded-lg bg-black/5 text-[var(--wa-preview-fg)] dark:bg-white/90 dark:text-[#0b141a]">
        <FileIcon className="size-10" strokeWidth={1.5} />
      </div>
      <p className="text-sm text-black/60 dark:text-white/60">
        Não é possível pré-visualizar
      </p>
    </div>
  );
}

/** Cresce com o texto até quatro linhas, igual ao compositor. */
function grow(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 20;
  element.style.height = `${Math.min(element.scrollHeight, lineHeight * 4)}px`;
}

function describeKind(file: File): string {
  const extension = file.name.split(".").pop()?.toUpperCase();
  if (extension && extension.length <= 5 && extension !== file.name.toUpperCase()) {
    return extension;
  }
  return "dados";
}

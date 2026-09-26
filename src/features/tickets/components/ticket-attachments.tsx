"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, PaperclipIcon, RotateCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DocumentMessageCard } from "@/features/chat/components/document-message-card";
import { ImageLightbox } from "@/features/chat/components/image-lightbox";
import {
  attachmentFileProblem,
  attachmentPresentation,
  isPreviewableImage,
  mergeAttachments,
  ticketAttachmentHref,
  uploadErrorMessage,
} from "@/features/tickets/lib/attachment-view";
import type { TicketAttachment } from "@/features/tickets/types";
import { formatBytes } from "@/lib/formatters/bytes";

type UploadResponse = { ok?: boolean; attachment?: TicketAttachment };

/**
 * Anexos do ticket: a lista e o envio (spec 4b).
 *
 * Documento é o cartão do chat (`DocumentMessageCard`) com a apresentação
 * montada do próprio anexo; imagem que o navegador desenha abre no
 * `ImageLightbox`. O arquivo sai SEMPRE pela rota do anexo, que confere a
 * sessão e redireciona para uma URL assinada curta — nenhuma URL do storage
 * chega aqui.
 *
 * `attachments` nulo = a leitura falhou: "não foi possível carregar", nunca
 * "nenhum anexo". Enviar não depende de ler, então o botão fica nos dois casos.
 * Depois do envio o anexo aparece na hora e o `router.refresh()` traz a lista
 * (e a timeline) do servidor.
 */
export function TicketAttachments({
  ticketId,
  attachments,
}: {
  ticketId: string;
  attachments: TicketAttachment[] | null;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  // Trava de duplo envio: o estado só desabilita o botão no próximo render.
  const uploadingRef = useRef(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<TicketAttachment[]>([]);

  const shown = attachments === null ? null : mergeAttachments(attachments, added);

  function refresh() {
    startRefresh(() => router.refresh());
  }

  async function upload(file: File) {
    if (uploadingRef.current) return;
    const problem = attachmentFileProblem(file);
    if (problem) {
      setError(problem);
      return;
    }

    uploadingRef.current = true;
    setUploading(file.name);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/attachments`, {
        method: "POST",
        body: form,
      });
      const result: unknown = await response.json().catch(() => null);
      const attachment =
        response.ok && (result as UploadResponse | null)?.ok
          ? (result as UploadResponse).attachment
          : undefined;
      if (!attachment) {
        setError(uploadErrorMessage(response.status, result));
        return;
      }
      setAdded((current) => [...current, attachment]);
      toast.success("Arquivo anexado.");
      refresh();
    } catch {
      setError("Não foi possível anexar o arquivo. Confira a conexão e tente de novo.");
    } finally {
      uploadingRef.current = false;
      setUploading(null);
    }
  }

  return (
    <div className="grid min-w-0 gap-3">
      {shown === null ? (
        <div className="grid justify-items-start gap-2">
          <p className="text-sm text-muted-foreground">Não foi possível carregar os anexos.</p>
          <Button
            type="button"
            variant="outline"
            disabled={refreshing}
            onClick={refresh}
            className="h-11 sm:h-8"
          >
            {refreshing ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <RotateCwIcon data-icon="inline-start" />
            )}
            Tentar de novo
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum anexo.</p>
      ) : (
        <ul aria-label="Anexos do ticket" className="grid min-w-0 gap-2">
          {shown.map((attachment) => (
            <li key={attachment.id} className="min-w-0">
              <AttachmentItem ticketId={ticketId} attachment={attachment} />
            </li>
          ))}
        </ul>
      )}

      <div className="grid justify-items-start gap-1.5">
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Limpa já: escolher o MESMO arquivo de novo (depois de um erro)
            // precisa disparar outro change.
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={uploading !== null}
          onClick={() => inputRef.current?.click()}
          className="h-11 sm:h-8"
        >
          {uploading !== null ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : (
            <PaperclipIcon data-icon="inline-start" />
          )}
          {uploading !== null ? "Enviando…" : "Anexar arquivo"}
        </Button>
        <p aria-live="polite" className="sr-only">
          {uploading !== null ? `Enviando ${uploading}` : ""}
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Até 50 MB por arquivo.</p>
        )}
      </div>
    </div>
  );
}

function AttachmentItem({
  ticketId,
  attachment,
}: {
  ticketId: string;
  attachment: TicketAttachment;
}) {
  const href = ticketAttachmentHref(ticketId, attachment.id);

  if (!isPreviewableImage(attachment.mime)) {
    return <DocumentMessageCard presentation={attachmentPresentation(attachment)} url={href} />;
  }

  const size = formatBytes(attachment.size_bytes);
  // A rota não tem miniatura (o transformador do storage é só do chat): a
  // mesma URL nas duas pontas, e a altura contida para a coluna lateral.
  return (
    <figure className="grid w-64 min-w-0 max-w-full gap-1 [&_img]:max-h-48">
      <ImageLightbox src={href} thumb={href} alt={attachment.file_name} />
      <figcaption className="flex min-w-0 gap-1 text-xs text-muted-foreground">
        <span className="min-w-0 truncate" title={attachment.file_name}>
          {attachment.file_name}
        </span>
        {size ? <span className="shrink-0 tabular-nums">· {size}</span> : null}
      </figcaption>
    </figure>
  );
}

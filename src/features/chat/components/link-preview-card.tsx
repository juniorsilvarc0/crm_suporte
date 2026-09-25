"use client";

import { useState } from "react";
import { ExternalLinkIcon } from "lucide-react";

import type { MessageLinkPreview } from "@/features/chat/lib/message-content";

export function LinkPreviewCard({ preview }: { preview: MessageLinkPreview }) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-0.5 block w-72 min-w-0 max-w-full overflow-hidden rounded-[6px] bg-black/[0.055] text-current no-underline ring-1 ring-black/[0.035] transition-colors hover:bg-black/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/[0.07] dark:ring-white/[0.04] dark:hover:bg-white/[0.1] sm:w-80"
      aria-label={`Abrir preview de ${preview.siteName}`}
    >
      {preview.imageUrl && !imageFailed ? (
        // A origem é o próprio payload do WhatsApp/UAZAPI; domínio arbitrário
        // impede `next/image`. O referrer vazio evita entregar a URL do CRM.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="max-h-52 w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : null}

      <span className="flex min-w-0 items-start gap-2 px-2.5 py-2">
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-[13px] leading-[17px] font-semibold">
            {preview.title ?? preview.siteName}
          </span>
          {preview.description ? (
            <span className="mt-0.5 line-clamp-3 block text-[12px] leading-[16px] opacity-70">
              {preview.description}
            </span>
          ) : null}
          <span className="mt-1 block truncate text-[11px] opacity-55">
            {preview.siteName}
          </span>
        </span>
        <ExternalLinkIcon className="mt-0.5 size-3.5 shrink-0 opacity-45" aria-hidden />
      </span>
    </a>
  );
}

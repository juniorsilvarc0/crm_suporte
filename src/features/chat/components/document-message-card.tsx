import { DownloadIcon, FileTextIcon, FileWarningIcon } from "lucide-react";

import type { DocumentMessagePresentation } from "@/features/chat/lib/document-message";
import { cn } from "@/lib/utils";

export function DocumentMessageCard({
  presentation,
  url,
}: {
  presentation: DocumentMessagePresentation;
  url: string | null;
}) {
  const typeLabel = presentation.extension ?? "Arquivo";
  const content = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-black/[0.06] dark:bg-white/10">
        <FileTextIcon className="size-5" aria-hidden />
      </span>

      <span className="min-w-0 flex-1">
        <span
          title={presentation.fileName}
          className="block truncate text-[13px] font-medium leading-4"
        >
          {presentation.fileName}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] leading-4 opacity-60">
          <span className="max-w-24 truncate font-semibold uppercase">{typeLabel}</span>
          {presentation.sizeLabel ? (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0 tabular-nums">{presentation.sizeLabel}</span>
            </>
          ) : null}
          {!url ? (
            <>
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate">Arquivo indisponível</span>
            </>
          ) : null}
        </span>
      </span>

      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full border border-black/10 bg-black/[0.035] dark:border-white/10 dark:bg-white/[0.06]"
        aria-hidden
      >
        {url ? <DownloadIcon className="size-4.5" /> : <FileWarningIcon className="size-4.5" />}
      </span>
    </>
  );
  const className = cn(
    "flex min-h-14 w-64 max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-[6px] bg-black/[0.055] p-2 text-left dark:bg-white/[0.07]",
    url &&
      "transition-colors hover:bg-black/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.11]"
  );

  if (!url) {
    return (
      <div
        data-slot="document-message-card"
        className={className}
        aria-label={`${presentation.fileName}, arquivo indisponível`}
      >
        {content}
      </div>
    );
  }

  return (
    <a
      data-slot="document-message-card"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={`Abrir arquivo ${presentation.fileName}`}
    >
      {content}
    </a>
  );
}

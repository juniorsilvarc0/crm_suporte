"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2Icon, SearchIcon, XIcon } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { highlightSlices } from "@/features/chat/lib/search-term";
import { CHAT_COLUMN_CLASS } from "@/features/chat/lib/chat-layout";
import { stripWhatsappFormat } from "@/features/chat/lib/whatsapp-format";
import { cn } from "@/lib/utils";

export type SearchHit = {
  id: string;
  content: string | null;
  direction: string;
  type: string;
  created_at: string;
};

/**
 * Busca dentro da conversa.
 *
 * O resultado vem do servidor porque a tela carrega 100 mensagens por vez e a
 * maior conversa tem 684 — procurar só no que está montado acharia menos de um
 * sexto. Clicar num resultado pede a janela ao redor daquela mensagem.
 */
export function ConversationSearch({
  conversationId,
  onSelect,
  onClose,
}: {
  conversationId: string;
  onSelect: (messageId: string) => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState("");
  // O resultado carrega o termo a que pertence. Assim o "está desatualizado?"
  // é derivado na renderização, em vez de limpar estado dentro do efeito —
  // que o lint do React proíbe, e com razão: gera render extra à toa.
  const [result, setResult] = useState<{ term: string; hits: SearchHit[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = term.trim();
  const fresh = result?.term === query ? result.hits : null;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce: sem ele, cada tecla vira uma consulta ao banco.
  useEffect(() => {
    if (query.length < 2) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/chat/conversations/${conversationId}/search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );
        const json = (await res.json()) as { hits?: SearchHit[] };
        setResult({ term: query, hits: json.hits ?? [] });
      } catch {
        // AbortError entra aqui quando o termo muda; não é erro para o usuário.
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, conversationId]);

  return (
    // A faixa atravessa a tela e o conteúdo segue a mesma coluna fluida das
    // mensagens e do compositor em todos os breakpoints.
    <div className="flex shrink-0 flex-col border-b border-[var(--wa-panel-border)] bg-[var(--wa-panel)]">
      <div
        className={cn(
          CHAT_COLUMN_CLASS,
          "flex items-center gap-2 py-2"
        )}
      >
        <SearchIcon className="size-4 shrink-0 text-[var(--wa-meta)]" aria-hidden />
        <input
          ref={inputRef}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
          }}
          placeholder="Buscar nesta conversa…"
          aria-label="Buscar nesta conversa"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-base outline-none placeholder:text-[var(--wa-meta)] md:py-0 md:text-sm"
        />
        {loading ? (
          <Loader2Icon className="size-4 shrink-0 animate-spin text-[var(--wa-meta)]" />
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar busca"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--wa-meta)] hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10 sm:size-8"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      {query.length >= 2 && (
        <div
          className={cn(
            CHAT_COLUMN_CLASS,
            "max-h-64 overflow-y-auto overscroll-contain border-t border-[var(--wa-panel-border)]"
          )}
        >
          {fresh === null || loading ? (
            <p className="px-4 py-3 text-[13px] text-[var(--wa-meta)]">Procurando…</p>
          ) : fresh.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-[var(--wa-meta)]">
              Nenhuma mensagem encontrada.
            </p>
          ) : (
            <ul>
              {fresh.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(hit.id)}
                    className="flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:bg-black/5 dark:hover:bg-white/10 dark:focus-visible:bg-white/10"
                  >
                    <span className="text-[11px] font-medium text-[var(--wa-meta)]">
                      {hit.direction === "outbound" ? "Você" : "Contato"}
                      {" · "}
                      {safeDate(hit.created_at)}
                    </span>
                    <span className="line-clamp-2 w-full break-words text-[13px]">
                      {highlightSlices(
                        stripWhatsappFormat(hit.content ?? "").replace(/\s+/g, " "),
                        term
                      ).map((slice, index) => (
                        <span
                          key={index}
                          className={cn(
                            slice.match &&
                              "rounded-sm bg-[var(--wa-green)]/30 font-semibold"
                          )}
                        >
                          {slice.text}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function safeDate(iso: string): string {
  try {
    return format(new Date(iso), "d MMM yyyy, HH:mm", { locale: ptBR });
  } catch {
    return "";
  }
}

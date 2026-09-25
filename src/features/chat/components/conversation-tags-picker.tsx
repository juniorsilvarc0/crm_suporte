"use client";

import { useState } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import { TagForm } from "@/features/chat/components/tag-form";
import { getColorStyle, type ColorName } from "@/features/tags/schemas/colors";
import { cn } from "@/lib/utils";
import type { Tag } from "@/features/tags/types";

/**
 * Etiquetar UMA conversa: marcar, desmarcar e criar na hora.
 *
 * ⚠️ É **conteúdo**, não camada. Não abre `Dialog` nem `Drawer` próprio — ele é
 * montado dentro da casca que já está aberta (gaveta do toque longo, sheet de
 * dados do contato, dropdown do desktop), que troca o próprio miolo por esta
 * vista. Empilhar modal sobre modal é anti-padrão aqui (UI.md §9): dois véus,
 * dois focus traps e dois donos do `Esc`.
 *
 * Também não traz fundo próprio: herda a superfície de quem o monta, que é o
 * que permite ele funcionar tanto sobre `--wa-panel` quanto sobre `--wa-info-bg`
 * sem sumir num dos dois.
 */
export function ConversationTagsPicker({
  tags,
  assigned,
  loading,
  failed,
  busyTagId,
  onToggle,
  onCreate,
  onRetry,
}: {
  tags: readonly Tag[];
  assigned: readonly Tag[];
  loading: boolean;
  failed: boolean;
  /** Etiqueta com escrita em voo — trava só ela, não a lista inteira. */
  busyTagId: string | null;
  onToggle: (tag: Tag, assigned: boolean) => void;
  onCreate: (name: string, color: ColorName) => Promise<boolean>;
  onRetry: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const assignedIds = new Set(assigned.map((tag) => tag.id));

  const create = async (name: string, color: ColorName) => {
    setCreating(true);
    const ok = await onCreate(name, color);
    setCreating(false);
    if (!ok) toast.error("Não foi possível criar a etiqueta.");
  };

  return (
    <div className="flex min-h-0 flex-col">
      {/* ⚠️ Teto próprio, e não `flex-1`. Este bloco é montado em três cascas —
          gaveta, diálogo e sheet — e só uma delas dá altura definida ao filho.
          Com `flex-1` num pai de altura automática, o scroller colapsa e a
          lista de etiquetas simplesmente não rola. O teto funciona nas três. */}
      <div className="max-h-[min(50dvh,22rem)] overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
        {loading ? (
          <div className="flex flex-col gap-2 px-4 py-3">
            <Skeleton className="h-5 w-2/5 bg-black/5 dark:bg-white/10" />
            <Skeleton className="h-5 w-1/3 bg-black/5 dark:bg-white/10" />
          </div>
        ) : failed ? (
          <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0 truncate text-[15px] text-[var(--wa-meta)]">
              Não foi possível carregar as etiquetas.
            </span>
            <button
              type="button"
              onClick={onRetry}
              className="min-h-11 shrink-0 rounded-lg px-3 text-[15px] font-medium text-[var(--wa-green-deep)] transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
            >
              Tentar de novo
            </button>
          </div>
        ) : tags.length === 0 ? (
          <p className="px-4 py-4 text-[15px] text-[var(--wa-meta)]">
            Nenhuma etiqueta ainda. Crie a primeira abaixo.
          </p>
        ) : (
          <div className="divide-y divide-[var(--wa-panel-border)]">
            {tags.map((tag) => {
              const isAssigned = assignedIds.has(tag.id);
              const style = getColorStyle(tag.color);
              const busy = busyTagId === tag.id;
              return (
                <button
                  key={tag.id}
                  type="button"
                  role="checkbox"
                  aria-checked={isAssigned}
                  disabled={busy}
                  onClick={() => onToggle(tag, !isAssigned)}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-3 px-4 text-left transition-colors",
                    "hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60 dark:hover:bg-white/5"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("size-3 shrink-0 rounded-full", style.dot)}
                  />
                  <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">
                    {tag.name}
                  </span>
                  {busy ? (
                    <Loader2Icon className="size-[18px] shrink-0 animate-spin text-[var(--wa-meta)]" />
                  ) : isAssigned ? (
                    <CheckIcon
                      aria-hidden
                      className="size-[18px] shrink-0 text-[var(--wa-green-deep)]"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--wa-panel-border)] px-4 py-3">
        <p className="pb-1.5 text-[13px] font-medium tracking-[0.02em] text-[var(--wa-meta)] uppercase">
          Nova etiqueta
        </p>
        <TagForm
          id="nova-etiqueta-na-conversa"
          mode="create"
          takenNames={tags.map((tag) => tag.name)}
          submitting={creating}
          onSubmit={(name, color) => void create(name, color)}
        />
      </div>
    </div>
  );
}

"use client";

import { useRef, useState, type RefObject } from "react";
import { CheckIcon, ChevronLeftIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_TAG_COLOR, TagForm } from "@/features/chat/components/tag-form";
import { countConversationsByTag } from "@/features/chat/lib/conversation-tags";
import type { ConversationTagsController } from "@/features/chat/hooks/use-conversation-tags";
import { getColorStyle, isColorName, type ColorName } from "@/features/tags/schemas/colors";
import { cn } from "@/lib/utils";
import type { Tag } from "@/features/tags/types";

/**
 * Tela de etiquetas — **sheet contido na coluna da lista**.
 *
 * É o destino da linha "Etiquetas" do topo. Faz as três coisas que a referência
 * faz: mostra quantas conversas cada etiqueta tem, filtra ao tocar, e é onde a
 * etiqueta nasce, muda de nome/cor e morre.
 *
 * Edição e exclusão acontecem **dentro da própria linha**, não numa camada nova:
 * diálogo sobre sheet seria modal sobre modal (UI.md §9). A linha vira editor, e
 * "Apagar" pede confirmação ali mesmo — com a contagem na frase, porque apagar
 * a etiqueta tira ela de todas as conversas de uma vez.
 */
export function ChatLabelsSheet({
  controller,
  portalContainer,
  selectedTagIds,
  onFilterChange,
  onClose,
}: {
  controller: ConversationTagsController;
  portalContainer: RefObject<HTMLDivElement | null>;
  /** Etiquetas filtrando a lista agora. Várias valem OU (ver `conversation-tags`). */
  selectedTagIds: readonly string[];
  onFilterChange: (tagIds: string[]) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [clearOnExit, setClearOnExit] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const { tags, tagsByConversation, loading, failed, createTag, updateTag, deleteTag, retry } =
    controller;
  const counts = countConversationsByTag(tagsByConversation);

  const close = (clearFilter = false) => {
    if (!open) return;
    setClearOnExit(clearFilter);
    setOpen(false);
  };

  /**
   * Marcar/desmarcar aplica NA HORA e a tela continua aberta — é o que permite
   * montar `VIP + Urgente` sem entrar e sair duas vezes.
   *
   * Aplicar durante a saída lateral (como faz o "Todas as conversas") existe
   * para a lista não reordenar por baixo de um painel ainda visível; aqui o
   * painel cobre a coluna inteira, então não há nada para ver reordenando.
   */
  const toggle = (tagId: string) => {
    onFilterChange(
      selectedTagIds.includes(tagId)
        ? selectedTagIds.filter((id) => id !== tagId)
        : [...selectedTagIds, tagId]
    );
  };

  const handleCreate = async (name: string, color: ColorName) => {
    setCreating(true);
    const created = await createTag(name, color);
    setCreating(false);
    if (created) toast.success("Etiqueta criada.");
    else toast.error("Não foi possível criar a etiqueta.");
  };

  const handleUpdate = async (tag: Tag, name: string, color: ColorName) => {
    setBusy(true);
    const ok = await updateTag(tag.id, { name, color });
    setBusy(false);
    if (ok) {
      setEditingId(null);
      toast.success("Etiqueta atualizada.");
    } else {
      toast.error("Não foi possível atualizar a etiqueta.");
    }
  };

  const handleDelete = async (tag: Tag) => {
    setBusy(true);
    const ok = await deleteTag(tag.id);
    setBusy(false);
    if (!ok) {
      toast.error("Não foi possível apagar a etiqueta.");
      return;
    }
    setConfirmingId(null);
    setEditingId(null);
    // Filtro apontando para etiqueta que acabou de sumir deixaria a lista vazia
    // sem explicação. As outras selecionadas continuam valendo.
    if (selectedTagIds.includes(tag.id)) {
      onFilterChange(selectedTagIds.filter((id) => id !== tag.id));
    }
    toast.success("Etiqueta apagada.");
  };

  return (
    <Dialog
      variant="dialog"
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      onOpenChangeComplete={(next) => {
        if (next) return;
        onClose();
        // "Todas as conversas" só vale depois da saída lateral: aplicar antes
        // faria a lista reordenar por baixo do painel ainda visível.
        if (clearOnExit) onFilterChange([]);
      }}
    >
      <DialogContent
        ref={sheetRef}
        presentation="sheet"
        portalContainer={portalContainer}
        showCloseButton={false}
        initialFocus={sheetRef}
        data-chat-sheet="info"
        className="bg-[var(--wa-info-bg)] text-foreground"
        aria-describedby={undefined}
      >
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-[var(--wa-info-divider)] px-1 sm:px-2">
          <DialogClose
            render={
              <button
                type="button"
                aria-label="Voltar para as conversas"
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--wa-info-label)] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            <ChevronLeftIcon className="size-6" />
          </DialogClose>
          <DialogTitle className="font-sans min-w-0 flex-1 truncate text-center text-[17px] font-semibold tracking-[-0.01em]">
            Etiquetas
          </DialogTitle>
          <span className="size-11 shrink-0" aria-hidden />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
          <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-5">
            <section>
              <h3 className="px-4 pb-1.5 text-[13px] font-medium tracking-[0.02em] text-[var(--wa-info-label)] uppercase">
                Filtrar a lista
              </h3>
              <p className="px-4 pb-2 text-[13px] text-[var(--wa-info-label)]">
                Marque quantas quiser — a lista mostra quem tem{" "}
                <strong className="font-medium">qualquer uma</strong> delas.
              </p>
              <div className="divide-y divide-[var(--wa-info-divider)] overflow-hidden rounded-xl bg-[var(--wa-info-card)]">
                <button
                  type="button"
                  onClick={() => close(true)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-[15px] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="truncate">Todas as conversas</span>
                  {selectedTagIds.length === 0 ? (
                    <CheckIcon
                      aria-hidden
                      className="size-[18px] shrink-0 text-[var(--wa-green-deep)]"
                    />
                  ) : null}
                </button>

                {loading ? (
                  <div className="flex min-h-12 items-center px-4">
                    <Skeleton className="h-4 w-2/5 bg-[var(--wa-info-active)]" />
                  </div>
                ) : failed ? (
                  <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
                    <span className="min-w-0 truncate text-[15px] text-[var(--wa-info-label)]">
                      Não foi possível carregar.
                    </span>
                    <button
                      type="button"
                      onClick={retry}
                      className="min-h-11 shrink-0 rounded-lg px-3 text-[15px] font-medium text-[var(--wa-green-deep)] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Tentar de novo
                    </button>
                  </div>
                ) : tags.length === 0 ? (
                  <p className="px-4 py-3.5 text-[15px] text-[var(--wa-info-label)]">
                    Nenhuma etiqueta ainda.
                  </p>
                ) : (
                  tags.map((tag) => (
                    <LabelRow
                      key={tag.id}
                      tag={tag}
                      count={counts.get(tag.id) ?? 0}
                      active={selectedTagIds.includes(tag.id)}
                      editing={editingId === tag.id}
                      confirming={confirmingId === tag.id}
                      busy={busy}
                      takenNames={tags.map((item) => item.name)}
                      onFilter={() => toggle(tag.id)}
                      onToggleEdit={() => {
                        setConfirmingId(null);
                        setEditingId((current) => (current === tag.id ? null : tag.id));
                      }}
                      onSubmit={(name, color) => void handleUpdate(tag, name, color)}
                      onAskDelete={() => setConfirmingId(tag.id)}
                      onCancelDelete={() => setConfirmingId(null)}
                      onConfirmDelete={() => void handleDelete(tag)}
                    />
                  ))
                )}
              </div>
            </section>

            <section>
              <h3 className="px-4 pb-1.5 text-[13px] font-medium tracking-[0.02em] text-[var(--wa-info-label)] uppercase">
                Nova etiqueta
              </h3>
              <div className="overflow-hidden rounded-xl bg-[var(--wa-info-card)] px-4 py-3">
                <TagForm
                  id="nova-etiqueta-na-tela"
                  mode="create"
                  takenNames={tags.map((tag) => tag.name)}
                  submitting={creating}
                  onSubmit={(name, color) => void handleCreate(name, color)}
                />
              </div>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LabelRow({
  tag,
  count,
  active,
  editing,
  confirming,
  busy,
  takenNames,
  onFilter,
  onToggleEdit,
  onSubmit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  tag: Tag;
  count: number;
  active: boolean;
  editing: boolean;
  confirming: boolean;
  busy: boolean;
  takenNames: readonly string[];
  onFilter: () => void;
  onToggleEdit: () => void;
  onSubmit: (name: string, color: ColorName) => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const style = getColorStyle(tag.color);

  return (
    <div>
      <div className="flex min-h-12 items-center">
        <button
          type="button"
          onClick={onFilter}
          aria-pressed={active}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-4 text-left transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span aria-hidden className={cn("size-3 shrink-0 rounded-full", style.dot)} />
          <span className="min-w-0 flex-1 truncate text-[15px]">{tag.name}</span>
          <span className="shrink-0 text-[13px] tabular-nums text-[var(--wa-info-label)]">
            {count}
          </span>
          {active ? (
            <CheckIcon
              aria-hidden
              className="size-[18px] shrink-0 text-[var(--wa-green-deep)]"
            />
          ) : null}
        </button>
        <button
          type="button"
          onClick={onToggleEdit}
          aria-expanded={editing}
          aria-label={`Editar etiqueta ${tag.name}`}
          className="me-1 flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--wa-info-label)] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PencilIcon className="size-[18px]" />
        </button>
      </div>

      {editing ? (
        <div className="border-t border-[var(--wa-info-divider)] px-4 py-3">
          <TagForm
            // A `key` reinicia o formulário ao trocar de etiqueta editada: sem
            // ela o campo guardaria o nome da anterior.
            key={tag.id}
            id={`editar-etiqueta-${tag.id}`}
            mode="edit"
            initialName={tag.name}
            // `tag.color` é `text` no banco: se vier fora da paleta, o seletor não
            // marcaria nada e salvar sobrescreveria com a cor errada.
            initialColor={isColorName(tag.color) ? tag.color : DEFAULT_TAG_COLOR}
            takenNames={takenNames}
            submitting={busy}
            onSubmit={onSubmit}
          />

          {confirming ? (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
              <p className="min-w-0 text-[13px] text-[var(--wa-info-label)]">
                {count > 0
                  ? `Sai de ${count} conversa${count > 1 ? "s" : ""}. Não dá para desfazer.`
                  : "Não dá para desfazer."}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={onCancelDelete}
                  disabled={busy}
                  className="min-h-11 rounded-lg px-3 text-[15px] text-[var(--wa-info-label)] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={onConfirmDelete}
                  disabled={busy}
                  className="min-h-11 rounded-lg px-3 text-[15px] font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  Apagar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={onAskDelete}
              disabled={busy}
              className="mt-3 min-h-11 rounded-lg px-3 text-[15px] font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              Apagar etiqueta
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

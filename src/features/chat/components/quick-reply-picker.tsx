"use client";

import { useMemo, useState } from "react";
import {
  Loader2Icon,
  MessageSquareTextIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  QuickReplyDeleteDialog,
  QuickReplyFormDialog,
} from "@/features/quick-replies/components/quick-reply-dialogs";
import type { QuickRepliesStore } from "@/features/quick-replies/hooks/use-quick-replies";
import type { QuickReply } from "@/features/quick-replies/types";
import { useIsMobile, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

type Editor = { open: boolean; item: QuickReply | null };

/**
 * Respostas rápidas: usar **e** gerenciar, na mesma superfície do compositor.
 *
 * O cadastro morava em `/app/configuracoes`. Gerenciar de lá exigia sair do
 * atendimento, e a resposta nasce aqui — no meio da conversa em que alguém
 * percebe que digita a mesma frase todo dia.
 */
export function QuickReplyPicker({
  disabled,
  onSelect,
  store,
}: {
  disabled?: boolean;
  onSelect: (content: string) => void;
  /** Lista compartilhada com o menu do `/`. O dono é o ChatFooter. */
  store: QuickRepliesStore;
}) {
  const isMobile = useIsMobile();
  // ⚠️ Largura não responde "tem hover?". O chat fica em layout móvel até `lg`,
  // então num tablet de 800px o seletor é o popover — e ali editar/excluir
  // ficariam presos no hover, que no toque não existe (UI.md §5.6).
  const noHover = useMediaQuery("(hover: none)");
  const [open, setOpen] = useState(false);
  const { items, loading, ensureLoaded, applySaved, applyDeleted } = store;
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor>({ open: false, item: null });
  const [deleteTarget, setDeleteTarget] = useState<QuickReply | null>(null);

  const filteredItems = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    if (!items || !term) return items ?? [];
    return items.filter((item) =>
      `${item.title} ${item.shortcut} ${item.content}`
        .toLocaleLowerCase("pt-BR")
        .includes(term),
    );
  }, [items, query]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) ensureLoaded();
  }

  function choose(item: QuickReply) {
    onSelect(item.content);
    setOpen(false);
    setQuery("");
  }

  // ⚠️ Fecha o seletor ANTES de abrir o diálogo. No celular o seletor já é uma
  // gaveta, e gaveta sobre gaveta é o anti-padrão do UI.md §9.
  function openEditor(item: QuickReply | null) {
    setOpen(false);
    setEditor({ open: true, item });
  }

  function confirmDelete(item: QuickReply) {
    setOpen(false);
    setDeleteTarget(item);
  }

  function handleDeleted(id: string) {
    applyDeleted(id);
    setDeleteTarget(null);
  }

  const list = (
    <QuickReplyList
      items={filteredItems}
      loading={loading}
      query={query}
      onQueryChange={setQuery}
      onSelect={choose}
      onEdit={openEditor}
      onDelete={confirmDelete}
      alwaysShowActions={noHover}
    />
  );

  const header = (
    <button
      type="button"
      onClick={() => openEditor(null)}
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--wa-meta)] outline-none transition-colors hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5 sm:size-8"
      aria-label="Nova resposta rápida"
      title="Nova resposta rápida"
    >
      <PlusIcon className="size-[18px]" />
    </button>
  );

  const trigger = (
    <button
      type="button"
      disabled={disabled}
      onClick={() => handleOpenChange(!open)}
      aria-label="Respostas rápidas"
      aria-expanded={open}
      aria-haspopup="dialog"
      title="Respostas rápidas"
      className="flex size-9 items-center justify-center rounded-full text-[var(--wa-meta)] outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 dark:hover:bg-white/5"
    >
      <MessageSquareTextIcon className="size-[18px]" />
    </button>
  );

  const dialogs = (
    <>
      <QuickReplyFormDialog
        open={editor.open}
        item={editor.item}
        onOpenChange={(next) => setEditor((prev) => ({ ...prev, open: next }))}
        onSaved={applySaved}
      />
      {deleteTarget ? (
        <QuickReplyDeleteDialog
          item={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
        />
      ) : null}
    </>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent className="flex max-h-[78dvh] flex-col gap-0 overflow-hidden p-0">
            <DialogHeader className="shrink-0 border-b border-border/70 px-4 pb-4 pt-2 pr-16">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <DialogTitle className="font-sans">Respostas rápidas</DialogTitle>
                  <DialogDescription>
                    Toque para inserir no campo. Você pode criar e editar aqui mesmo.
                  </DialogDescription>
                </div>
                {header}
              </div>
            </DialogHeader>
            {list}
          </DialogContent>
        </Dialog>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <div className="relative shrink-0">
        {trigger}
        {open ? (
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setOpen(false)}
            />
            <div
              role="dialog"
              aria-label="Respostas rápidas"
              className="absolute bottom-11 right-0 z-20 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--wa-panel-border)] bg-popover text-popover-foreground shadow-lg"
            >
              <div className="flex items-start justify-between gap-3 border-b border-[var(--wa-panel-border)] px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Respostas rápidas</p>
                  <p className="text-xs text-muted-foreground">
                    Selecione para inserir e revisar antes de enviar.
                  </p>
                </div>
                {header}
              </div>
              {list}
            </div>
          </>
        ) : null}
      </div>
      {dialogs}
    </>
  );
}

function QuickReplyList({
  items,
  loading,
  query,
  onQueryChange,
  onSelect,
  onEdit,
  onDelete,
  alwaysShowActions,
}: {
  items: QuickReply[];
  loading: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (item: QuickReply) => void;
  onEdit: (item: QuickReply) => void;
  onDelete: (item: QuickReply) => void;
  alwaysShowActions: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative shrink-0 p-3">
        <SearchIcon
          className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Buscar resposta..."
          aria-label="Buscar resposta rápida"
          className="h-11 pl-9 pr-9 sm:h-9"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="Limpar busca"
            className="absolute right-4 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5"
          >
            <XIcon className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 max-h-[45dvh] flex-1 overflow-y-auto overscroll-contain border-t border-[var(--wa-panel-border)] sm:max-h-80">
        {loading ? (
          <div
            className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2Icon className="size-4 animate-spin" />
            Carregando respostas...
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
            <MessageSquareTextIcon className="size-6 text-muted-foreground/40" aria-hidden />
            <p className="text-sm font-medium text-muted-foreground">
              {query ? "Nenhuma resposta encontrada." : "Nenhuma resposta rápida."}
            </p>
            {query ? null : (
              <p className="text-xs text-muted-foreground/70">
                Crie mensagens prontas para agilizar o atendimento.
              </p>
            )}
          </div>
        ) : (
          items.map((item) => (
            <QuickReplyRow
              key={item.id}
              item={item}
              alwaysShowActions={alwaysShowActions}
              onSelect={() => onSelect(item)}
              onEdit={() => onEdit(item)}
              onDelete={() => onDelete(item)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function QuickReplyRow({
  item,
  alwaysShowActions,
  onSelect,
  onEdit,
  onDelete,
}: {
  item: QuickReply;
  alwaysShowActions: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // Resposta inativa continua na lista para poder ser reativada, mas não é
  // inserível: mostrar e deixar enviar seria mentir sobre o que "inativa"
  // significa. Por isso a linha deixa de ser botão.
  const Row = item.is_active ? "button" : "div";

  return (
    <div
      className={cn(
        "group/reply relative border-b border-[var(--wa-panel-border)]/60 last:border-0",
        !item.is_active && "opacity-60",
      )}
    >
      <Row
        {...(item.is_active ? { type: "button" as const, onClick: onSelect } : {})}
        className={cn(
          "grid min-h-16 w-full gap-1 py-3 pl-4 pr-20 text-left outline-none transition-colors sm:min-h-14",
          item.is_active &&
            "hover:bg-black/5 focus-visible:bg-black/5 dark:hover:bg-white/5 dark:focus-visible:bg-white/5",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{item.title}</span>
          <span className="shrink-0 font-mono text-xs text-[var(--wa-green-deep)]">
            /{item.shortcut}
          </span>
          {item.is_active ? null : (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Inativa
            </span>
          )}
        </span>
        <span className="line-clamp-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
          {item.content}
        </span>
      </Row>

      {/*
        Fora da linha, não dentro: `Row` é um <button> quando a resposta está
        ativa, e botão dentro de botão é HTML inválido — o navegador fecha o de
        fora e a linha inteira para de funcionar (UI.md §5.7.5).
      */}
      <div
        className={cn(
          "absolute right-2 top-2 flex items-center gap-0.5 transition-opacity",
          alwaysShowActions
            ? "opacity-100"
            : "pointer-events-none opacity-0 group-hover/reply:pointer-events-auto group-hover/reply:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100",
        )}
      >
        <RowAction label={`Editar ${item.title}`} onClick={onEdit}>
          <PencilIcon className="size-[15px]" />
        </RowAction>
        <RowAction label={`Excluir ${item.title}`} destructive onClick={onDelete}>
          <Trash2Icon className="size-[15px]" />
        </RowAction>
      </div>
    </div>
  );
}

function RowAction({
  label,
  destructive = false,
  onClick,
  children,
}: {
  label: string;
  destructive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-8 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5",
      )}
    >
      {children}
    </button>
  );
}

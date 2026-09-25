"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, PlusIcon, StickyNoteIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { noteColorClass, NOTE_COLORS, type NoteColor } from "@/features/home/schemas/note";
import type { HomeNotes, UserNote } from "@/features/home/types";
import { cn } from "@/lib/utils";

/**
 * "Minhas notas" — um mural de post-its, e só.
 *
 * O post-it nasce **em branco**: criar já com texto obrigava a apagar antes de
 * escrever. A ordem é arrastável e fica gravada em `user_notes.position`; nada
 * aqui vive só na tela.
 */
export function NotesPanel({ initial }: { initial: HomeNotes }) {
  const [stickies, setStickies] = useState<UserNote[]>(initial.stickies);
  const [creating, setCreating] = useState(false);

  /**
   * ⚠️ Id do DndContext, obrigatório aqui — sem ele a página quebra a
   * hidratação.
   *
   * Sem `id`, o dnd-kit monta o `aria-describedby` das alças com um CONTADOR
   * global do módulo (`useUniqueId`): o servidor renderiza `DndDescribedBy-0` e
   * o navegador, que já montou outros contextos (e que em dev renderiza duas
   * vezes por causa do StrictMode), chega em `DndDescribedBy-3`. O React
   * compara os dois e reclama.
   *
   * `useId` do React é justamente a garantia de um id igual dos dois lados.
   */
  const dndId = useId();

  // Mesmos sensores do kanban do funil: o clique precisa continuar sendo
  // clique (8px de folga) e, no toque, o dedo precisa poder rolar a página
  // sem arrastar post-it (200ms de espera).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor)
  );

  async function createSticky() {
    setCreating(true);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "", color: nextColor(stickies.length) }),
      });
      const payload = (await response.json()) as { ok: boolean; note?: RawNote; message?: string };
      if (!response.ok || !payload.note) {
        toast.error(payload.message ?? "Não foi possível criar o post-it.");
        return;
      }
      setStickies((current) => [toUserNote(payload.note!), ...current]);
    } catch {
      toast.error("Não foi possível criar o post-it.");
    } finally {
      setCreating(false);
    }
  }

  async function updateSticky(id: string, content: string) {
    const previous = stickies;
    setStickies((current) =>
      current.map((note) => (note.id === id ? { ...note, content } : note))
    );
    try {
      const response = await fetch(`/api/notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) throw new Error("patch");
    } catch {
      setStickies(previous);
      toast.error("Não foi possível salvar o post-it.");
    }
  }

  async function removeSticky(id: string) {
    const previous = stickies;
    setStickies((current) => current.filter((note) => note.id !== id));
    try {
      const response = await fetch(`/api/notes/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete");
    } catch {
      setStickies(previous);
      toast.error("Não foi possível excluir o post-it.");
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = stickies.findIndex((note) => note.id === active.id);
    const to = stickies.findIndex((note) => note.id === over.id);
    if (from < 0 || to < 0) return;

    const previous = stickies;
    const reordered = arrayMove(stickies, from, to);
    // Move na tela primeiro: arrastar tem que parecer instantâneo. Se o
    // servidor recusar, a lista volta para onde estava e o aviso explica.
    setStickies(reordered);

    try {
      const response = await fetch("/api/notes/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: reordered.map((note) => note.id) }),
      });
      if (!response.ok) throw new Error("reorder");
    } catch {
      setStickies(previous);
      toast.error("Não foi possível salvar a ordem dos post-its.");
    }
  }

  return (
    <section
      aria-labelledby="home-notes-title"
      // `min-h-0` + `flex-1`: na tela larga a coluna tem altura travada, então
      // o mural rola por dentro em vez de esticar a página (ver a armadilha do
      // painel de pessoas no PROGRESS de 2026-08-18).
      className="flex min-h-0 flex-col rounded-2xl border border-border/60 bg-card p-4 shadow-soft lg:flex-1"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="home-notes-title" className="font-display text-base font-semibold">
          Minhas notas
        </h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-2.5 py-1">
            <StickyNoteIcon className="size-3.5" aria-hidden />
            {stickies.length} {stickies.length === 1 ? "post-it" : "post-its"}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={createSticky} disabled={creating}>
            <PlusIcon data-icon="inline-start" />
            Novo post-it
          </Button>
        </div>
      </div>

      {stickies.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
          Nenhum post-it ainda. Crie o primeiro para fixar um lembrete que não se perde.
        </p>
      ) : (
        // A folga lateral (`-mx-1 px-1`) existe para a rolagem não decepar a
        // sombra do post-it nem o cartão que o arrasto levanta.
        <div className="-mx-1 mt-3 min-h-0 px-1 py-1 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain [scrollbar-width:thin]">
          <DndContext
            id={dndId}
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={stickies.map((note) => note.id)} strategy={rectSortingStrategy}>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {stickies.map((note) => (
                  <StickyCard
                    key={note.id}
                    note={note}
                    onSave={(content) => {
                      if (content !== note.content) void updateSticky(note.id, content);
                    }}
                    onRemove={() => void removeSticky(note.id)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </section>
  );
}

function StickyCard({
  note,
  onSave,
  onRemove,
}: {
  note: UserNote;
  onSave: (content: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: note.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // Os `listeners` ficam no cartão inteiro para o mural funcionar como um
      // mural: pega em qualquer lugar e arrasta. Quem escapa é o texto — ver o
      // `onPointerDown` do Textarea.
      {...listeners}
      className={cn(
        "group/sticky flex min-h-44 cursor-grab flex-col rounded-2xl p-3 shadow-soft transition-shadow active:cursor-grabbing",
        noteColorClass[note.color],
        isDragging && "z-10 rotate-2 shadow-soft-lg"
      )}
    >
      <div className="flex items-center justify-between gap-1 pb-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          // `attributes` mora aqui, e não no cartão: é o que dá o arrasto por
          // teclado a um alvo declarado, sem transformar em botão o elemento
          // que contém a área de texto.
          {...attributes}
          aria-label={`Mover post-it${note.content ? `: ${note.content.slice(0, 40)}` : ""}`}
          className="inline-flex size-7 cursor-grab items-center justify-center rounded-md text-current/50 outline-none transition-opacity hover:bg-black/10 hover:text-current focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        >
          <GripVerticalIcon className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onRemove}
          // Sem o `stopPropagation` o clique também é um começo de arrasto e o
          // cartão sai do lugar antes de sumir.
          onPointerDown={(event) => event.stopPropagation()}
          aria-label="Excluir post-it"
          className="inline-flex size-7 items-center justify-center rounded-md opacity-0 outline-none transition-opacity hover:bg-black/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/sticky:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <Trash2Icon className="size-4" aria-hidden />
        </button>
      </div>

      <Textarea
        defaultValue={note.content}
        // O texto é para ler e selecionar; arrastar é papel do resto do cartão.
        onPointerDown={(event) => event.stopPropagation()}
        onBlur={(event) => onSave(event.target.value.trim())}
        placeholder="Escreva aqui…"
        aria-label={note.content ? `Post-it: ${note.content.slice(0, 40)}` : "Post-it em branco"}
        // ⚠️ `rounded-none` NÃO é enfeite. O primitivo traz `rounded-lg`, que
        // nesta base vale `--radius` = 1.1rem ≈ 17,6px, e o navegador recorta o
        // conteúdo do textarea pelo retângulo ARREDONDADO. Com padding zero, a
        // primeira letra da primeira e da última linha cai dentro da curva e
        // aparece cortada ao meio ("hoje" virava "noje"). Reduzir o raio é o
        // conserto certo aqui; aumentar o padding só empurraria o texto para
        // dentro e desalinharia do resto do cartão.
        // O `px-0.5` é a folga para o lado esquerdo de letras que avançam além
        // da origem do glifo (itálico, "j", "f").
        className="min-h-24 flex-1 cursor-text resize-none rounded-none border-transparent bg-transparent px-0.5 py-0 text-sm leading-relaxed shadow-none placeholder:text-current/45 focus-visible:ring-2 focus-visible:ring-ring/60 dark:bg-transparent"
      />
    </li>
  );
}

type RawNote = { id: string; title: string | null; content: string; color: string; updated_at: string };

function toUserNote(raw: RawNote): UserNote {
  return {
    id: raw.id,
    title: raw.title,
    content: raw.content,
    color: (NOTE_COLORS.includes(raw.color as NoteColor) ? raw.color : "amber") as NoteColor,
    updatedAt: raw.updated_at,
  };
}

/** Cor do próximo post-it: cicla a paleta em vez de pedir escolha a cada criação. */
function nextColor(index: number): NoteColor {
  return NOTE_COLORS[index % NOTE_COLORS.length];
}

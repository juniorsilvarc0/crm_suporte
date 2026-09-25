"use client";

import type {
  Announcements,
  DndContextProps,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import tunnel from "tunnel-rat";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const t = tunnel();

export type { DragEndEvent } from "@dnd-kit/core";

type KanbanItemProps = {
  id: string;
  name: string;
  column: string;
} & Record<string, unknown>;

type KanbanColumnProps = {
  id: string;
  name: string;
} & Record<string, unknown>;

type KanbanContextProps<
  T extends KanbanItemProps = KanbanItemProps,
  C extends KanbanColumnProps = KanbanColumnProps,
> = {
  columns: C[];
  data: T[];
  activeCardId: string | null;
};

const KanbanContext = createContext<KanbanContextProps>({
  columns: [],
  data: [],
  activeCardId: null,
});

export type KanbanBoardProps = {
  id: string;
  children: ReactNode;
  className?: string;
};

export const KanbanBoard = ({ id, children, className }: KanbanBoardProps) => {
  const { isOver, setNodeRef } = useDroppable({
    id,
  });

  return (
    <div
      className={cn(
        // Mobile: largura fixa + snap (rola na horizontal). >=lg: cresce p/ preencher.
        // h-full → preenche a altura do board (colunas altas, sem corte).
        "flex h-full w-[85vw] max-w-[22rem] min-h-0 min-w-0 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-border/70 bg-muted/30 text-xs shadow-soft ring-2 ring-inset transition-[box-shadow] duration-200",
        "sm:w-80 lg:w-[22rem]",
        isOver ? "ring-primary/60" : "ring-transparent",
        className
      )}
      ref={setNodeRef}
    >
      {children}
    </div>
  );
};

export type KanbanCardProps<T extends KanbanItemProps = KanbanItemProps> = T & {
  children?: ReactNode;
  className?: string;
};

export const KanbanCard = <T extends KanbanItemProps = KanbanItemProps>({
  id,
  name,
  children,
  className,
}: KanbanCardProps<T>) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transition,
    transform,
    isDragging,
  } = useSortable({
    id,
  });
  const { activeCardId } = useContext(KanbanContext) as KanbanContextProps;

  const style = {
    transition,
    transform: CSS.Transform.toString(transform),
  };

  return (
    <>
      <div style={style} {...listeners} {...attributes} ref={setNodeRef}>
        <Card
          className={cn(
            "cursor-grab gap-2 rounded-xl border-border/70 p-3.5 shadow-xs ring-0",
            isDragging && "pointer-events-none cursor-grabbing opacity-30",
            className
          )}
        >
          {children ?? <p className="m-0 font-medium text-sm">{name}</p>}
        </Card>
      </div>
      {activeCardId === id && (
        <t.In>
          <Card
            className={cn(
              "cursor-grabbing gap-2 rounded-xl p-3.5 shadow-lg ring-2 ring-primary",
              className
            )}
          >
            {children ?? <p className="m-0 font-medium text-sm">{name}</p>}
          </Card>
        </t.In>
      )}
    </>
  );
};

export type KanbanCardsProps<T extends KanbanItemProps = KanbanItemProps> =
  Omit<HTMLAttributes<HTMLDivElement>, "children" | "id"> & {
    children: (item: T) => ReactNode;
    id: string;
    /** Conteúdo quando a coluna não tem card. Sem isto a coluna vira área morta. */
    empty?: ReactNode;
  };

export const KanbanCards = <T extends KanbanItemProps = KanbanItemProps>({
  children,
  className,
  empty,
  ...props
}: KanbanCardsProps<T>) => {
  const { data } = useContext(KanbanContext) as KanbanContextProps<T>;
  const filteredData = data.filter((item) => item.column === props.id);
  const items = filteredData.map((item) => item.id);

  return (
    <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-scrollbar]]:hidden">
      <SortableContext items={items}>
        <div
          className={cn("flex flex-grow flex-col gap-2.5 p-2.5", className)}
          {...props}
        >
          {filteredData.length > 0 ? filteredData.map(children) : empty}
        </div>
      </SortableContext>
    </ScrollArea>
  );
};

export type KanbanHeaderProps = HTMLAttributes<HTMLDivElement>;

export const KanbanHeader = ({ className, ...props }: KanbanHeaderProps) => (
  <div className={cn("m-0 p-2 font-semibold text-sm", className)} {...props} />
);

// "Segurar e arrastar" com o mouse para rolar o board na horizontal (pan), como
// num kanban clássico. Só com o mouse (no toque a rolagem nativa já funciona) e
// ignorando cards/botões/links — assim NÃO conflita com o arraste de cards do
// dnd-kit nem com cliques.
function useHorizontalDragScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const IGNORE = 'button, a, input, select, textarea, [role="button"], [data-no-pan]';
    const THRESHOLD = 5;
    let down = false;
    let panning = false;
    let startX = 0;
    let startLeft = 0;
    let pointerId = -1;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(IGNORE)) return;
      down = true;
      panning = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
      pointerId = e.pointerId;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!panning) {
        if (Math.abs(dx) < THRESHOLD) return;
        panning = true;
        el.style.cursor = "grabbing";
        el.style.userSelect = "none";
        el.setPointerCapture?.(pointerId);
      }
      el.scrollLeft = startLeft - dx;
      e.preventDefault();
    };

    const stop = () => {
      down = false;
      if (panning) {
        panning = false;
        el.style.cursor = "";
        el.style.userSelect = "";
        el.releasePointerCapture?.(pointerId);
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  return ref;
}

export type KanbanProviderProps<
  T extends KanbanItemProps = KanbanItemProps,
  C extends KanbanColumnProps = KanbanColumnProps,
> = Omit<DndContextProps, "children"> & {
  children: (column: C) => ReactNode;
  className?: string;
  columns: C[];
  data: T[];
  onDataChange?: (data: T[]) => void;
  onDragStart?: (event: DragStartEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  onDragOver?: (event: DragOverEvent) => void;
};

export const KanbanProvider = <
  T extends KanbanItemProps = KanbanItemProps,
  C extends KanbanColumnProps = KanbanColumnProps,
>({
  children,
  onDragStart,
  onDragEnd,
  onDragOver,
  className,
  columns,
  data,
  onDataChange,
  ...props
}: KanbanProviderProps<T, C>) => {
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const scrollRef = useHorizontalDragScroll<HTMLDivElement>();

  /**
   * ⚠️ Id do DndContext — sem ele a hidratação quebra.
   *
   * O dnd-kit monta o `aria-describedby` das alças com um CONTADOR global do
   * módulo quando nenhum `id` é passado. O servidor renderiza
   * `DndDescribedBy-0` e o navegador, que já montou outros contextos, chega em
   * outro número; o React compara e reclama em cima do board inteiro.
   * `useId` é a garantia de um id igual dos dois lados.
   *
   * Fica com `??` para quem chama poder continuar passando o próprio `id`.
   */
  const generatedDndId = useId();

  const sensors = useSensors(
    // distance: clique simples não inicia arraste (evita "drag" acidental)
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // delay: toque rápido = scroll; segurar = arrasta (corrige scroll travado no mobile)
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = (event: DragStartEvent) => {
    const card = data.find((item) => item.id === event.active.id);
    if (card) {
      setActiveCardId(event.active.id as string);
    }
    onDragStart?.(event);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;

    if (!over) {
      return;
    }

    const activeItem = data.find((item) => item.id === active.id);
    const overItem = data.find((item) => item.id === over.id);

    if (!activeItem) {
      return;
    }

    const activeColumn = activeItem.column;
    const overColumn =
      overItem?.column ||
      columns.find((col) => col.id === over.id)?.id ||
      columns[0]?.id;

    if (activeColumn !== overColumn) {
      let newData = [...data];
      const activeIndex = newData.findIndex((item) => item.id === active.id);
      const overIndex = newData.findIndex((item) => item.id === over.id);

      newData[activeIndex].column = overColumn;
      newData = arrayMove(newData, activeIndex, overIndex);

      onDataChange?.(newData);
    }

    onDragOver?.(event);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveCardId(null);

    onDragEnd?.(event);

    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    let newData = [...data];

    const oldIndex = newData.findIndex((item) => item.id === active.id);
    const newIndex = newData.findIndex((item) => item.id === over.id);

    newData = arrayMove(newData, oldIndex, newIndex);

    onDataChange?.(newData);
  };

  const announcements: Announcements = {
    onDragStart({ active }) {
      const { name, column } = data.find((item) => item.id === active.id) ?? {};

      const columnName = columns.find((item) => item.id === column)?.name ?? column;
      return `Card "${name}" selecionado na coluna "${columnName}".`;
    },
    onDragOver({ active, over }) {
      const { name } = data.find((item) => item.id === active.id) ?? {};
      const overItem = data.find((item) => item.id === over?.id);
      const columnId = overItem?.column ?? over?.id;
      const newColumn = columns.find((column) => column.id === columnId)?.name;

      return `Card "${name}" movido sobre a coluna "${newColumn}".`;
    },
    onDragEnd({ active, over }) {
      const { name } = data.find((item) => item.id === active.id) ?? {};
      const overItem = data.find((item) => item.id === over?.id);
      const columnId = overItem?.column ?? over?.id;
      const newColumn = columns.find((column) => column.id === columnId)?.name;

      return `Card "${name}" solto na coluna "${newColumn}".`;
    },
    onDragCancel({ active }) {
      const { name } = data.find((item) => item.id === active.id) ?? {};

      return `Movimento do card "${name}" cancelado.`;
    },
  };

  return (
    <KanbanContext.Provider value={{ columns, data, activeCardId }}>
      <DndContext
        accessibility={{ announcements }}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        sensors={sensors}
        {...props}
        id={props.id ?? generatedDndId}
      >
        <div
          ref={scrollRef}
          className={cn(
            // Rolagem horizontal no mobile; colunas crescem p/ preencher no desktop.
            // lg:cursor-grab → dica visual do "segurar e arrastar" com o mouse.
            "flex w-full gap-3 overflow-x-auto overflow-y-hidden pb-3 snap-x snap-mandatory [-webkit-overflow-scrolling:touch] [scrollbar-width:thin] lg:snap-none lg:cursor-grab lg:gap-4",
            className
          )}
        >
          {columns.map((column) => children(column))}
        </div>
        {typeof window !== "undefined" &&
          createPortal(
            <DragOverlay>
              <t.Out />
            </DragOverlay>,
            document.body
          )}
      </DndContext>
    </KanbanContext.Provider>
  );
};

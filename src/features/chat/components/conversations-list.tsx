"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowUpIcon, ChevronLeftIcon, SearchIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";
import { ChatLabelsSheet } from "@/features/chat/components/chat-labels-sheet";
import { ConversationItem } from "@/features/chat/components/conversation-item";
import { ConversationListShortcuts } from "@/features/chat/components/conversation-list-shortcuts";
import { ConversationFilters } from "@/features/chat/components/conversation-filters";
import { ConversationTagsPicker } from "@/features/chat/components/conversation-tags-picker";
import {
  clearChatFilters,
  countActiveFilters,
  type ChatFilters,
} from "@/features/chat/lib/chat-filters";
import { NO_TAGS } from "@/features/chat/lib/conversation-tags";
import type { ConversationTagsController } from "@/features/chat/hooks/use-conversation-tags";
import {
  ConversationActionDialog,
  ConversationActionsDrawer,
  ConversationTagsDialog,
  type ConversationAction,
} from "@/features/chat/components/conversation-actions";
import {
  promotedConversationScrollShift,
  promotedShiftPixels,
  viewportIndexFromHeights,
  type ConversationPromotion,
} from "@/features/chat/lib/conversation-scroll";
import type { ChatConversation, ChatStageOption } from "@/features/chat/types";
import type { SwipeSide } from "@/features/chat/lib/conversation-swipe";
import type { Tag } from "@/features/tags/types";

type ConversationsListProps = {
  conversations: ChatConversation[];
  promotedConversationCount: number;
  lastPromotion: (ConversationPromotion & { sequence: number }) | null;
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSearchChange: (value: string) => void;
  /** Muda de valor quando o ChatShell quer o foco aqui (Cmd+F). */
  focusSearchToken?: number;
  /** Filtros da lista — dono no ChatShell, que é quem aplica. */
  filters: ChatFilters;
  onFiltersChange: (next: ChatFilters) => void;
  /** Etapas do funil oferecidas como chip. Vêm do servidor com a página. */
  stages: readonly ChatStageOption[];
  onConversationAction: (
    conversation: ChatConversation,
    action: ConversationAction
  ) => Promise<boolean>;
  /** Etiquetas do chat — catálogo, vínculos e escritas, com dono no ChatShell. */
  tagsController: ConversationTagsController;
  archivedCount: number;
};

const LIST_TOP_THRESHOLD = 8;

/** Faixa aberta — `null` significa "nenhuma", então não entra aqui. */
type OpenSwipeSide = Exclude<SwipeSide, null>;

type RowMeasurement = {
  heights: number[];
  heightById: Map<string, number>;
  /** Altura de uma linha representativa, para quem sumiu da lista. */
  typical: number;
};

/**
 * Mede as linhas de conversa numa passada só.
 *
 * ⚠️ Procura por `[data-conversation-row]`, e **não** pelo primeiro filho: acima
 * das conversas moram os atalhos (arquivadas, etiquetas), e medi-los como se
 * fossem linha daria a altura errada para tudo.
 *
 * As alturas deixaram de ser uniformes quando a conversa ganhou a linha de
 * etiquetas. Ler todas de uma vez custa **um** cálculo de layout — a primeira
 * leitura força, as demais aproveitam. Intercalar leitura e escrita aqui seria
 * layout síncrono por linha (UI.md §9).
 */
function measureConversationRows(container: HTMLElement): RowMeasurement {
  const rows = container.querySelectorAll<HTMLElement>("[data-conversation-row]");
  const heights: number[] = [];
  const heightById = new Map<string, number>();

  rows.forEach((row) => {
    const height = row.offsetHeight;
    heights.push(height);
    const id = row.dataset.conversationId;
    if (id) heightById.set(id, height);
  });

  // Linha do meio como representativa: etiqueta é minoria, então ela quase
  // sempre cai numa conversa sem etiqueta — que é a altura comum da lista.
  const typical = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 0;
  return { heights, heightById, typical };
}

/**
 * Altura de UMA linha, para o índice aproximado mantido durante a rolagem.
 *
 * Aproximado de propósito. Ele só é usado como último recurso, quando a lista
 * está escondida atrás da conversa no celular e não há o que medir; o caminho
 * que decide a compensação de verdade mede todas as linhas. Varrer as 425 a cada
 * quadro de rolagem para refinar um palpite de reserva seria caro à toa.
 */
function fallbackRowHeight(container: HTMLElement): number | null {
  const row = container.querySelector<HTMLElement>("[data-conversation-row]");
  const height = row?.offsetHeight ?? 0;
  return height > 0 ? height : null;
}

export function ConversationsList({
  conversations,
  promotedConversationCount,
  lastPromotion,
  loading,
  selectedId,
  onSelect,
  onSearchChange,
  focusSearchToken = 0,
  filters,
  onFiltersChange,
  stages,
  onConversationAction,
  tagsController,
  archivedCount,
}: ConversationsListProps) {
  const [search, setSearch] = useState("");
  // Guarda o LADO junto do id: as duas faixas ocupam a mesma linha, e só o id
  // não diria qual delas está aberta.
  const [swiped, setSwiped] = useState<{ id: string; side: OpenSwipeSide } | null>(null);
  const swipedAt = useRef(0);
  const [drawerConversation, setDrawerConversation] = useState<ChatConversation | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerOpenedAt, setDrawerOpenedAt] = useState(0);
  // A gaveta do toque longo troca o próprio miolo para etiquetar, em vez de
  // abrir uma segunda camada por cima (UI.md §9).
  const [drawerView, setDrawerView] = useState<"actions" | "tags">("actions");
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [busyTagId, setBusyTagId] = useState<string | null>(null);
  // Caminho do desktop: o dropdown não é modal, então ele fecha e este diálogo
  // abre — sem empilhar camada. O `Dialog` do repo já vira gaveta no celular.
  const [tagsDialogFor, setTagsDialogFor] = useState<ChatConversation | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [confirmation, setConfirmation] = useState<{
    conversation: ChatConversation;
    action: "clear" | "delete";
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const confirmationTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  const viewportIndex = useRef(0);
  // Ids, não uma contagem: no celular a lista fica escondida atrás da conversa,
  // com geometria zero, e a compensação espera ela reaparecer para medir. Só o
  // id preserva QUAL linha entrou — e agora as linhas têm alturas diferentes.
  const pendingPromotedIds = useRef<string[]>([]);
  const handledPromotionSequence = useRef(0);
  const promotionCountRef = useRef(promotedConversationCount);
  const atTopRef = useRef(true);
  const [atTop, setAtTop] = useState(true);
  const [acknowledgedPromotionCount, setAcknowledgedPromotionCount] = useState(
    promotedConversationCount
  );

  const pendingPromotionCount = atTop
    ? 0
    : Math.max(0, promotedConversationCount - acknowledgedPromotionCount);

  const acknowledgePromotions = useCallback(() => {
    setAcknowledgedPromotionCount(promotionCountRef.current);
  }, []);

  const handleSearch = (v: string) => {
    acknowledgePromotions();
    setSearch(v);
    onSearchChange(v);
  };

  // O atalho pede o foco pelo contador. `select()` junto porque a segunda vez
  // que se aperta Cmd+F é para trocar o termo, não para completá-lo.
  useEffect(() => {
    if (focusSearchToken === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSearchToken]);

  useEffect(
    () => () => {
      if (confirmationTimer.current !== null) {
        window.clearTimeout(confirmationTimer.current);
      }
      if (scrollFrame.current !== null) {
        window.cancelAnimationFrame(scrollFrame.current);
      }
    },
    []
  );

  /**
   * A conversa promovida entra acima da viewport. Antes da pintura, compensa
   * a altura da linha quando ela cruzou o conteúdo que estava visível.
   *
   * `selectedId` também dispara esta etapa ao voltar da conversa no celular:
   * enquanto a lista está escondida sua geometria é zero, então a restauração
   * fica pendente até ela reaparecer.
   */
  useLayoutEffect(() => {
    promotionCountRef.current = promotedConversationCount;

    const unhandledPromotion =
      lastPromotion &&
      lastPromotion.sequence > handledPromotionSequence.current
        ? lastPromotion
        : null;
    if (unhandledPromotion) {
      handledPromotionSequence.current = unhandledPromotion.sequence;
    }

    const container = listRef.current;
    if (scrollFrame.current !== null) {
      window.cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = null;
    }

    // Medir custa uma passada por todas as linhas. Quem está no topo da lista
    // não precisa de compensação nenhuma — e esse é o caso comum, com mensagem
    // chegando o tempo todo. Só mede quem realmente vai compensar.
    const needsMeasurement =
      (Boolean(unhandledPromotion) && !atTopRef.current) ||
      pendingPromotedIds.current.length > 0;
    if (!needsMeasurement) return;

    const measurable =
      container !== null && container.clientWidth > 0 && container.clientHeight > 0;
    const measurement: RowMeasurement | null =
      measurable && container ? measureConversationRows(container) : null;

    const currentViewportIndex =
      measurement && container
        ? viewportIndexFromHeights(measurement.heights, container.scrollTop)
        : viewportIndex.current;

    if (unhandledPromotion && !atTopRef.current) {
      const shift = promotedConversationScrollShift(
        unhandledPromotion,
        currentViewportIndex
      );
      if (shift > 0) pendingPromotedIds.current.push(unhandledPromotion.id);
      viewportIndex.current = currentViewportIndex + shift;
    }

    // Lista escondida ou ainda sem altura: a compensação fica pendente pelo id
    // e é aplicada quando ela reaparecer.
    if (!container || !measurement || measurement.typical <= 0) return;

    if (pendingPromotedIds.current.length > 0) {
      const pixels = promotedShiftPixels(
        pendingPromotedIds.current,
        measurement.heightById,
        measurement.typical
      );
      pendingPromotedIds.current = [];
      if (pixels > 0) {
        container.scrollTo({ top: container.scrollTop + pixels });
      }
    }
    viewportIndex.current = viewportIndexFromHeights(
      measurement.heights,
      container.scrollTop
    );
  }, [conversations, lastPromotion, promotedConversationCount, selectedId]);

  // ⚠️ Os quatro handlers abaixo descem para toda a lista memoizada. Identidade
  // nova a cada render anularia o `memo` do `ConversationItem` — e era isso que
  // fazia o arraste engasgar: um `setSwipedId` re-renderizava a lista inteira.
  const openDrawer = useCallback((conversation: ChatConversation) => {
    setSwiped(null);
    setDrawerConversation(conversation);
    setDrawerOpenedAt(Date.now());
    setDrawerView("actions");
    setDrawerOpen(true);
  }, []);

  /** Marca/desmarca etiqueta, travando só a linha tocada enquanto a rota responde. */
  const toggleTag = useCallback(
    async (conversationId: string, tag: Tag, assigned: boolean) => {
      setBusyTagId(tag.id);
      const ok = await tagsController.assign(conversationId, tag, assigned);
      setBusyTagId(null);
      if (!ok) toast.error("Não foi possível atualizar a etiqueta.");
    },
    [tagsController]
  );

  const openTagsDialog = useCallback((conversation: ChatConversation) => {
    setSwiped(null);
    setTagsDialogFor(conversation);
  }, []);

  const runAction = useCallback(
    async (conversation: ChatConversation, action: ConversationAction) => {
      setActionLoading(true);
      const success = await onConversationAction(conversation, action);
      setActionLoading(false);
      if (success) setConfirmation(null);
    },
    [onConversationAction]
  );

  const requestAction = useCallback(
    (conversation: ChatConversation, action: ConversationAction) => {
      setSwiped(null);
      if (action !== "clear" && action !== "delete") {
        setDrawerOpen(false);
        void runAction(conversation, action);
        return;
      }

      const showConfirmation = () => setConfirmation({ conversation, action });
      if (drawerOpen) {
        setDrawerOpen(false);
        confirmationTimer.current = window.setTimeout(showConfirmation, 220);
      } else {
        showConfirmation();
      }
    },
    [drawerOpen, runAction]
  );

  const handleSelect = useCallback(
    (id: string) => {
      setSwiped(null);
      onSelect(id);
    },
    [onSelect]
  );

  const closeSwipe = useCallback(() => setSwiped(null), []);

  const openSwipe = useCallback((id: string, side: OpenSwipeSide) => {
    swipedAt.current = Date.now();
    setSwiped({ id, side });
  }, []);

  // Rolar fecha a linha aberta, como no WhatsApp — mas não no mesmo instante em
  // que ela abriu. O arraste pode terminar com um resto de inércia vertical no
  // iOS, e sem a carência o primeiro `scroll` desfazia o gesto recém-feito.
  // Mesma ideia do `drawerOpenedAt` logo acima.
  const closeSwipeOnScroll = useCallback(() => {
    if (Date.now() - swipedAt.current < 350) return;
    setSwiped(null);
  }, []);

  const handleListScroll = useCallback(() => {
    if (swiped) closeSwipeOnScroll();
    if (scrollFrame.current !== null) return;

    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      const container = listRef.current;
      if (!container) return;

      const nextAtTop = container.scrollTop <= LIST_TOP_THRESHOLD;
      if (nextAtTop || (atTopRef.current && !nextAtTop)) {
        setAcknowledgedPromotionCount(promotionCountRef.current);
      }
      atTopRef.current = nextAtTop;
      setAtTop((current) => (current === nextAtTop ? current : nextAtTop));
      const rowHeight = fallbackRowHeight(container);
      if (rowHeight) {
        viewportIndex.current = Math.floor(container.scrollTop / rowHeight);
      }
    });
  }, [closeSwipeOnScroll, swiped]);

  const goToPromotedConversations = useCallback(() => {
    const container = listRef.current;
    if (!container) return;
    acknowledgePromotions();
    atTopRef.current = true;
    setAtTop(true);
    container.scrollTo({ top: 0, behavior: "smooth" });
  }, [acknowledgePromotions]);

  const archivedView = filters.status === "archived";
  const activeFilterCount = countActiveFilters(filters);
  // Nomes das etiquetas filtrando agora — o valor da linha "Etiquetas" do topo.
  // Uma só mostra o nome; várias mostram a contagem, senão a linha vira uma
  // fileira de nomes truncados que não informa nada.
  const activeTagNames = filters.tags
    .map((id) => tagsController.tags.find((tag) => tag.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const tagsSummary =
    activeTagNames.length === 0
      ? null
      : activeTagNames.length === 1
        ? activeTagNames[0]
        : `${activeTagNames.length} etiquetas`;

  const setTagFilter = useCallback(
    (tags: string[]) => onFiltersChange({ ...filters, tags }),
    [filters, onFiltersChange]
  );

  /** O mesmo seletor nas duas cascas — gaveta no toque longo, diálogo no ⋯. */
  const renderTagsPicker = (conversation: ChatConversation) => (
    <ConversationTagsPicker
      tags={tagsController.tags}
      assigned={tagsController.tagsByConversation.get(conversation.id) ?? NO_TAGS}
      loading={tagsController.loading}
      failed={tagsController.failed}
      busyTagId={busyTagId}
      onToggle={(tag, assigned) => void toggleTag(conversation.id, tag, assigned)}
      onCreate={async (name, color) => {
        const created = await tagsController.createTag(name, color);
        if (!created) return false;
        // Criar já aplica: ninguém abre esta tela para cadastrar etiqueta e
        // deixar de usar na conversa que está bem na frente.
        await toggleTag(conversation.id, created, true);
        return true;
      }}
      onRetry={tagsController.retry}
    />
  );

  return (
    // `relative` porque o sheet de etiquetas é portalizado aqui dentro: ele
    // ocupa a coluna da lista, não a tela inteira (UI.md §5.7.2b).
    <div ref={rootRef} className="wa-surface relative isolate flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--wa-panel-border)] bg-[var(--wa-panel)] px-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">Conversas</h2>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-[var(--wa-green)]/12 px-2.5 py-1 text-[11px] font-medium text-[var(--wa-green-deep)]">
          <WhatsAppIcon className="size-3.5" brand />
          Conectado
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 py-2">
        <div className="relative">
          <SearchIcon className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--wa-meta)]" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={(e) => {
              // Esc limpa e devolve o foco — sair da busca sem pegar no mouse.
              if (e.key !== "Escape") return;
              if (search) handleSearch("");
              else e.currentTarget.blur();
            }}
            placeholder="Pesquisar contato ou mensagem"
            aria-label="Pesquisar contato"
            title="Pesquisar contato (Ctrl/⌘ + Shift + F)"
            aria-keyshortcuts="Control+Shift+F Meta+Shift+F"
            className="h-11 w-full rounded-lg border-0 bg-[var(--wa-panel)] pl-10 pr-9 text-base text-foreground outline-none placeholder:text-[var(--wa-meta)] focus:ring-1 focus:ring-[var(--wa-green-deep)]/30 md:h-9 md:text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => handleSearch("")}
              className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-[var(--wa-meta)] hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
              aria-label="Limpar busca"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filtros logo abaixo da busca, como no WhatsApp Web: é o controle mais
          usado da coluna, e ficar depois das duas linhas de atalho o empurrava
          para o terceiro nível da tela. */}
      <ConversationFilters
        filters={filters}
        onFiltersChange={(next) => {
          // Mudar de filtro reposiciona a lista: o aviso de "conversas novas no
          // topo" é da lista anterior e ficaria pendurado sobre outra.
          acknowledgePromotions();
          onFiltersChange(next);
        }}
        stages={stages}
        tags={tagsController.tags}
      />

      {/* Atalhos do topo. Na caixa de arquivadas eles dão lugar ao caminho de
          volta: sem o chip "Arquivadas", a única saída seria recarregar. */}
      {archivedView ? (
        <button
          type="button"
          onClick={() => onFiltersChange({ ...filters, status: "all" })}
          className="flex min-h-12 shrink-0 items-center gap-2 border-b border-[var(--wa-panel-border)] px-2 text-left transition-colors hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/5"
        >
          <ChevronLeftIcon aria-hidden className="size-5 shrink-0 text-[var(--wa-meta)]" />
          <span className="text-[15px] font-medium text-foreground">Arquivadas</span>
          <span className="text-[13px] text-[var(--wa-meta)]">
            · voltar para as conversas
          </span>
        </button>
      ) : (
        <ConversationListShortcuts
          archivedCount={archivedCount}
          activeTagsLabel={tagsSummary}
          onOpenArchived={() => onFiltersChange({ ...filters, status: "archived" })}
          onOpenLabels={() => setLabelsOpen(true)}
        />
      )}

      {/* List */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          role="listbox"
          aria-label="Conversas"
          // `overscroll-contain`: sem ele, chegar no fim da lista entrega o
          // gesto para a página. As medidas do scroll ficam agrupadas no RAF.
          className="absolute inset-0 overflow-y-auto overscroll-contain [overflow-anchor:none] [-webkit-overflow-scrolling:touch]"
          onScroll={handleListScroll}
        >
          {loading ? (
            <ListSkeleton />
          ) : conversations.length === 0 ? (
            <ListEmpty
              archived={archivedView}
              activeFilterCount={activeFilterCount}
              onClearFilters={() => onFiltersChange(clearChatFilters(filters))}
            />
          ) : (
            conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                // `NO_TAGS` é congelado e de módulo: `?? []` aqui criaria array
                // novo a cada render e mataria o `memo` de toda conversa sem
                // etiqueta — que é a maioria delas.
                tags={tagsController.tagsByConversation.get(conv.id) ?? NO_TAGS}
                isSelected={selectedId === conv.id}
                swipeSide={swiped?.id === conv.id ? swiped.side : null}
                onSelect={handleSelect}
                onSwipeOpen={openSwipe}
                onSwipeClose={closeSwipe}
                onOpenActions={openDrawer}
                onRequestAction={requestAction}
                onOpenTags={openTagsDialog}
              />
            ))
          )}
        </div>

        {pendingPromotionCount > 0 ? (
          <div
            className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-3"
            aria-live="polite"
          >
            <button
              type="button"
              onClick={goToPromotedConversations}
              className="pointer-events-auto inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--wa-panel-border)] bg-[var(--wa-panel)] px-3.5 text-xs font-semibold text-[var(--wa-green-deep)] shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
              aria-label={`Ir para ${pendingPromotionCount} conversa${pendingPromotionCount > 1 ? "s" : ""} nova${pendingPromotionCount > 1 ? "s" : ""} no topo`}
            >
              {pendingPromotionCount} conversa{pendingPromotionCount > 1 ? "s" : ""} nova{pendingPromotionCount > 1 ? "s" : ""}
              <ArrowUpIcon className="size-3.5" />
            </button>
          </div>
        ) : null}
      </div>

      {drawerConversation ? (
        <ConversationActionsDrawer
          conversation={drawerConversation}
          open={drawerOpen}
          view={drawerView}
          onOpenChange={(next) => {
            if (!next && Date.now() - drawerOpenedAt < 400) return;
            setDrawerOpen(next);
          }}
          onRequest={requestAction}
          onOpenTags={() => setDrawerView("tags")}
          onBackToActions={() => setDrawerView("actions")}
          tagsContent={renderTagsPicker(drawerConversation)}
        />
      ) : null}

      {tagsDialogFor ? (
        <ConversationTagsDialog
          conversation={tagsDialogFor}
          onClose={() => setTagsDialogFor(null)}
        >
          {renderTagsPicker(tagsDialogFor)}
        </ConversationTagsDialog>
      ) : null}

      {labelsOpen ? (
        <ChatLabelsSheet
          controller={tagsController}
          portalContainer={rootRef}
          selectedTagIds={filters.tags}
          onFilterChange={setTagFilter}
          onClose={() => setLabelsOpen(false)}
        />
      ) : null}

      {confirmation ? (
        <ConversationActionDialog
          conversation={confirmation.conversation}
          action={confirmation.action}
          loading={actionLoading}
          onCancel={() => setConfirmation(null)}
          onConfirm={() =>
            void runAction(confirmation.conversation, confirmation.action)
          }
        />
      ) : null}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <div className="size-12 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between">
              <div className="h-3.5 w-32 animate-pulse rounded-full bg-muted" />
              <div className="h-2.5 w-10 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="h-3 w-44 animate-pulse rounded-full bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ListEmpty({
  archived,
  activeFilterCount,
  onClearFilters,
}: {
  archived: boolean;
  activeFilterCount: number;
  onClearFilters: () => void;
}) {
  // Vazio POR CAUSA DO FILTRO precisa dizer isso e oferecer a saída no mesmo
  // lugar: sem o aviso, a lista some e a pessoa acha que perdeu as conversas.
  // Um texto só para qualquer combinação — enumerar quais filtros estão
  // ligados seria repetir a barra que está logo acima, ainda visível.
  if (activeFilterCount > 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 px-6 text-center">
        <WhatsAppIcon className="size-9 text-[var(--wa-meta)]/40" />
        <p className="text-sm font-medium text-foreground">
          Nenhuma conversa com {activeFilterCount === 1 ? "esse filtro" : "esses filtros"}
        </p>
        <button
          type="button"
          onClick={onClearFilters}
          className="min-h-11 rounded-lg px-3 text-[13px] font-medium text-[var(--wa-green-deep)] transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
        >
          Limpar filtros
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-48 flex-col items-center justify-center gap-2 px-6 text-center">
      <WhatsAppIcon className="size-9 text-[var(--wa-meta)]/40" />
      <p className="text-sm font-medium text-foreground">
        {archived ? "Nenhuma conversa arquivada" : "Nenhuma conversa encontrada"}
      </p>
      <p className="text-xs text-[var(--wa-meta)]">
        Mensagens recebidas no WhatsApp aparecem aqui.
      </p>
    </div>
  );
}

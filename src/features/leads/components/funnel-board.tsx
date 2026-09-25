"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDaysIcon,
  ArrowRightIcon,
  BanknoteIcon,
  InboxIcon,
  Loader2Icon,
  MegaphoneIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  PlusIcon,
  Rows3Icon,
  SearchXIcon,
  Settings2Icon,
  UserRoundIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
  type DragEndEvent,
} from "@/components/kibo-ui/kanban";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AvatarInitials } from "@/components/data-display/avatar-initials";
import {
  ActiveFilters,
  DataToolbar,
  FilterButton,
  FilterField,
  ToolbarSearch,
} from "@/components/data-display/data-toolbar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormSelect } from "@/components/forms/form-select";
import { Input } from "@/components/ui/input";
import { CreateLeadDialog } from "@/features/leads/components/create-lead-dialog";
import { CreateDealDialog } from "@/features/deals/components/create-deal-dialog";
import { LeadDetailDialog } from "@/features/leads/components/lead-detail-dialog";
import { SaleDialog } from "@/features/financeiro/components/sale-dialog";
import type { Procedure } from "@/features/financeiro/lib/procedure-options";
import {
  EMPTY_SALE_RANGE,
  hasSaleFilter,
  matchesSaleFilter,
  summarizeLeadSales,
  type SaleRangeFilter,
} from "@/features/financeiro/lib/lead-sale-summary";
import type { LeadSale } from "@/features/financeiro/types";
import { FunnelSettingsDialog } from "@/features/board/components/funnel-settings-dialog";
import { useFunnelView } from "@/features/board/lib/funnel-view";
import { getColorStyle } from "@/features/leads/schemas/colors";
import {
  getLeadSourceLabel,
  getLeadStatusLabel,
  getTipoEnsaioLabel,
} from "@/features/leads/schemas/status";
import {
  stageTypeColor,
  stageTypeLabel,
  toStageType,
} from "@/features/board/schemas/stage";
import {
  attributionCampaignLabel,
  type LeadAttribution,
} from "@/features/meta/lead-attribution";
import type { BoardColumn } from "@/features/board/types";
import type { Deal } from "@/features/deals/types";
import type { Lead, Tag } from "@/features/leads/types";
import { formatPhone } from "@/lib/formatters/phone";
import { formatMoney } from "@/lib/formatters/money";
import { cn } from "@/lib/utils";

const shortDate = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
});

type Card = { id: string; name: string; column: string; deal: Deal };
type SortMode = "recent" | "oldest" | "scheduled" | "value" | "value-asc";

function toCards(deals: Deal[]): Card[] {
  return deals.map((deal) => ({
    id: deal.id,
    name: deal.lead?.name ?? "Sem nome",
    column: deal.stage,
    deal,
  }));
}

export function FunnelBoard({
  deals,
  columns,
  tags,
  attributions = {},
  procedures = [],
  sales = {},
  showStageMeta = false,
}: {
  deals: Deal[];
  columns: BoardColumn[];
  tags: Tag[];
  attributions?: Record<string, LeadAttribution>;
  procedures?: Procedure[];
  sales?: Record<string, LeadSale[]>;
  showStageMeta?: boolean;
}) {
  const router = useRouter();
  const [cards, setCards] = useState<Card[]>(() => toCards(deals));
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [saleFilter, setSaleFilter] = useState<SaleRangeFilter>(EMPTY_SALE_RANGE);
  const { view, updateView } = useFunnelView();
  // Cards cuja etapa está sendo gravada. Sem isso o arraste some sem confirmar
  // nada e o usuário não sabe se salvou.
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());

  // Revalida o board contra o servidor ao montar e ao voltar para a aba. A troca
  // de etapa é confirmada no banco (o stage movido SEMPRE persiste) e a página é
  // `force-dynamic`/`no-store`; ainda assim uma view de cliente defasada — Service
  // Worker ou cache do navegador servindo HTML antigo no reload, ou o Router Cache
  // do Next numa navegação suave — podia mostrar a etapa antiga e dar a impressão
  // de que "não salvou". Buscar o estado real aqui elimina esse descompasso.
  useEffect(() => {
    router.refresh();
    function onVisible() {
      if (document.visibilityState === "visible") router.refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  // Re-sincroniza quando o server revalida (ajuste durante o render).
  const [syncedDeals, setSyncedDeals] = useState(deals);
  if (deals !== syncedDeals) {
    setSyncedDeals(deals);
    setCards(toCards(deals));
  }

  // Colunas conhecidas (keys do board) + uma coluna "Sem categoria" para stages órfãos.
  const knownKeys = new Set(columns.map((c) => c.key));
  const orphanKeys = Array.from(
    new Set(cards.map((c) => c.column).filter((k) => !knownKeys.has(k)))
  );
  const providerColumns = [
    ...columns.map((c) => ({ id: c.key, name: c.label, color: c.color })),
    ...orphanKeys.map((k) => ({ id: k, name: getLeadStatusLabel(k), color: "slate" })),
  ];
  const columnByKey = new Map(columns.map((c) => [c.key, c]));

  const services = useMemo(
    () => Array.from(new Set(cards.map((card) => card.deal.tipo_ensaio ?? card.deal.lead?.tipo_ensaio).filter(Boolean) as string[])).sort(),
    [cards]
  );
  const sources = useMemo(
    () => Array.from(new Set(cards.map((card) => card.deal.source || card.deal.lead?.source).filter(Boolean) as string[])).sort(),
    [cards]
  );
  const visibleCards = useMemo(() => {
    // Ordena pelo que foi VENDIDO. `deal.valor` é estimativa e segue como
    // desempate para card sem venda. Fica dentro do useMemo porque fecha sobre
    // `sales`, que já é dependência.
    const saleTotalOf = (card: Card) => {
      const leadId = card.deal.lead?.id;
      const summary = summarizeLeadSales(leadId ? sales[leadId] : undefined);
      return summary.hasSale ? summary.total : (card.deal.valor ?? 0);
    };
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    const next = cards.filter((card) => {
      const lead = card.deal.lead;
      if (!matchesSaleFilter(summarizeLeadSales(lead ? sales[lead.id] : undefined), saleFilter)) {
        return false;
      }
      const searchable = [
        card.name,
        lead?.phone,
        lead?.interesse,
        card.deal.title,
        ...(lead?.tags?.map((tag) => tag.name) ?? []),
      ].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
      const service = card.deal.tipo_ensaio ?? lead?.tipo_ensaio;
      const source = card.deal.source || lead?.source;
      return (!normalizedQuery || searchable.includes(normalizedQuery)) &&
        (tagFilter === "all" || lead?.tags?.some((tag) => tag.id === tagFilter)) &&
        (serviceFilter === "all" || service === serviceFilter) &&
        (sourceFilter === "all" || source === sourceFilter);
    });

    return next.sort((a, b) => {
      if (sortMode === "oldest") return a.deal.created_at.localeCompare(b.deal.created_at);
      if (sortMode === "scheduled") return (a.deal.scheduled_at ?? "9999").localeCompare(b.deal.scheduled_at ?? "9999");
      if (sortMode === "value") return saleTotalOf(b) - saleTotalOf(a);
      if (sortMode === "value-asc") return saleTotalOf(a) - saleTotalOf(b);
      return b.deal.created_at.localeCompare(a.deal.created_at);
    });
  }, [cards, query, serviceFilter, sortMode, sourceFilter, tagFilter, saleFilter, sales]);

  const activeFilterCount =
    [tagFilter, serviceFilter, sourceFilter].filter((value) => value !== "all").length +
    (hasSaleFilter(saleFilter) ? 1 : 0);
  const isFiltered = activeFilterCount > 0 || query.trim() !== "";
  // Filtro que zera tudo precisa dizer isso. Board vazio sem explicação parece bug.
  const filteredToNothing = isFiltered && cards.length > 0 && visibleCards.length === 0;

  function clearFilters() {
    setQuery("");
    setTagFilter("all");
    setServiceFilter("all");
    setSourceFilter("all");
    setSaleFilter(EMPTY_SALE_RANGE);
  }

  function mergeVisibleCards(nextVisible: Card[]) {
    const visibleIds = new Set(visibleCards.map((card) => card.id));
    setCards((current) => [...current.filter((card) => !visibleIds.has(card.id)), ...nextVisible]);
  }

  // Diálogos
  const [selected, setSelected] = useState<Lead | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [funnelSettingsOpen, setFunnelSettingsOpen] = useState(false);
  const [dealCreateOpen, setDealCreateOpen] = useState(false);
  const [dealCreateStage, setDealCreateStage] = useState<string | undefined>(undefined);
  const [saleOpen, setSaleOpen] = useState(false);
  const [saleDeal, setSaleDeal] = useState<Deal | null>(null);

  const draggedRef = useRef(false);
  // Coluna de origem do card no início do arraste. O Kanban (handleDragOver)
  // reatribui card.column para o destino DURANTE o arraste, então precisamos da
  // origem para saber se realmente houve troca de etapa no fim.
  const dragOriginRef = useRef<string | null>(null);

  function openLead(lead: Lead | null) {
    if (draggedRef.current || !lead) return;
    setSelected(lead);
    setDetailOpen(true);
  }
  function openDealCreate(stage: string) {
    setDealCreateStage(stage);
    setDealCreateOpen(true);
  }

  function markSaving(dealId: string, saving: boolean) {
    setSavingIds((current) => {
      const next = new Set(current);
      if (saving) next.add(dealId);
      else next.delete(dealId);
      return next;
    });
  }

  async function persistStage(dealId: string, stage: string) {
    markSaving(dealId, true);
    try {
      const res = await fetch(`/api/deals/${dealId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const result = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível mover o card.");
        setCards(toCards(deals));
        return;
      }
      toast.success(`Movido para "${getLeadStatusLabel(stage)}".`);
      router.refresh();
    } catch {
      toast.error("Não foi possível mover o card.");
      setCards(toCards(deals));
    } finally {
      markSaving(dealId, false);
    }
  }

  // Caminho do menu "Mover para": o arraste já move o card na tela antes de
  // gravar; pelo menu ele ficava parado até o refresh do servidor, dando a
  // impressão de que o clique não fez nada. Move local primeiro, grava depois.
  function moveCard(dealId: string, stage: string) {
    setCards((current) =>
      current.map((card) => (card.id === dealId ? { ...card, column: stage } : card))
    );
    persistStage(dealId, stage);
  }

  function handleDragEnd(event: DragEndEvent) {
    window.setTimeout(() => {
      draggedRef.current = false;
    }, 60);

    const { active, over } = event;
    const origin = dragOriginRef.current;
    dragOriginRef.current = null;
    if (!over) return;

    // Coluna de destino: a do card sob o cursor, ou a própria coluna alvo.
    const overColumn =
      providerColumns.find((col) => col.id === over.id)?.id ??
      cards.find((c) => c.id === over.id)?.column;

    // Compara com a coluna de ORIGEM (capturada no dragStart), NÃO com a coluna
    // atual do card: o handleDragOver do Kanban já reatribuiu card.column para o
    // destino durante o arraste, então comparar com ela dava sempre "igual" e o
    // persistStage nunca era chamado — o card movia na tela mas não gravava no
    // banco, voltando no reload.
    if (!overColumn || !origin || overColumn === origin) return;
    persistStage(active.id as string, overColumn);
  }

  return (
    <div className="flex h-full flex-col">
      <DataToolbar className="shrink-0">
        <ToolbarSearch
          aria-label="Buscar no funil"
          placeholder="Buscar cliente, telefone, tag..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:flex-nowrap">
          <FilterButton activeCount={activeFilterCount}>
            <FilterField label="Tag">
              <FormSelect value={tagFilter} onValueChange={setTagFilter} aria-label="Filtrar por tag" options={[{ value: "all", label: "Todas as tags" }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]} />
            </FilterField>
            <FilterField label="Serviço">
              <FormSelect value={serviceFilter} onValueChange={setServiceFilter} aria-label="Filtrar por serviço" options={[{ value: "all", label: "Todos os serviços" }, ...services.map((service) => ({ value: service, label: getTipoEnsaioLabel(service) }))]} />
            </FilterField>
            <FilterField label="Venda">
              <FormSelect
                value={saleFilter.sale}
                onValueChange={(value) =>
                  setSaleFilter((current) => ({
                    ...current,
                    sale: value as SaleRangeFilter["sale"],
                  }))
                }
                aria-label="Filtrar por venda"
                options={[
                  { value: "all", label: "Todos" },
                  { value: "with", label: "Com venda" },
                  { value: "without", label: "Sem venda" },
                ]}
              />
            </FilterField>
            <FilterField label="Valor vendido">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="Mínimo"
                  aria-label="Valor vendido mínimo"
                  value={saleFilter.min}
                  onChange={(event) =>
                    setSaleFilter((current) => ({ ...current, min: event.target.value }))
                  }
                  className="h-11 sm:h-9"
                />
                <span className="text-xs text-muted-foreground" aria-hidden>
                  até
                </span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="Máximo"
                  aria-label="Valor vendido máximo"
                  value={saleFilter.max}
                  onChange={(event) =>
                    setSaleFilter((current) => ({ ...current, max: event.target.value }))
                  }
                  className="h-11 sm:h-9"
                />
              </div>
            </FilterField>
            <FilterField label="Origem">
              <FormSelect value={sourceFilter} onValueChange={setSourceFilter} aria-label="Filtrar por origem" options={[{ value: "all", label: "Todas as origens" }, ...sources.map((source) => ({ value: source, label: getLeadSourceLabel(source) }))]} />
            </FilterField>
          </FilterButton>
          <FormSelect value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)} aria-label="Ordenar cards" className="w-[10rem]" options={[{ value: "recent", label: "Mais recentes" }, { value: "oldest", label: "Mais antigos" }, { value: "scheduled", label: "Data agendada" }, { value: "value", label: "Maior valor" }, { value: "value-asc", label: "Menor valor" }]} />
          <ActiveFilters count={activeFilterCount + (query ? 1 : 0)} onClear={clearFilters} />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="h-11 sm:h-8"
                aria-label="Mais ações do funil"
              />
            }
          >
            <MoreHorizontalIcon data-icon="inline-start" />
            <span className="hidden sm:inline">Mais</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuCheckboxItem
              className="min-h-11 sm:min-h-8"
              checked={view.compact}
              onCheckedChange={(checked) => updateView({ compact: checked === true })}
            >
              <Rows3Icon />
              Usar visual compacto
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={() => setFunnelSettingsOpen(true)}>
              <Settings2Icon />
              Configurar funil
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CreateDealDialog columns={columns} />
        <CreateLeadDialog columns={columns} />
        </div>
      </DataToolbar>

      {/* Só diz "X de Y" quando há filtro: sem filtro, "309 de 309" é ruído. */}
      <div className="flex h-8 shrink-0 items-center text-xs text-muted-foreground" aria-live="polite">
        <span className="font-medium tabular-nums text-foreground">{visibleCards.length}</span>
        <span className="ml-1">
          {isFiltered ? `de ${cards.length} ` : ""}
          {(isFiltered ? cards.length : visibleCards.length) === 1
            ? "oportunidade"
            : "oportunidades"}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        {filteredToNothing ? (
          <div className="grid h-full place-items-center rounded-lg border border-dashed border-border/70 bg-muted/20 p-8 text-center">
            <div className="grid justify-items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <SearchXIcon className="size-5" aria-hidden />
              </span>
              <div className="grid gap-1">
                <p className="text-sm font-medium">Nenhuma oportunidade encontrada</p>
                <p className="max-w-xs text-xs leading-snug text-muted-foreground">
                  {cards.length} {cards.length === 1 ? "card existe" : "cards existem"} no funil, mas
                  nenhum passa pelos filtros atuais.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Limpar filtros
              </Button>
            </div>
          </div>
        ) : (
        <KanbanProvider
          columns={providerColumns}
          data={visibleCards}
          onDragStart={(event) => {
            draggedRef.current = true;
            dragOriginRef.current =
              cards.find((c) => c.id === event.active.id)?.column ?? null;
          }}
          onDataChange={mergeVisibleCards}
          onDragEnd={handleDragEnd}
          className="h-full"
        >
          {(column) => {
            const style = getColorStyle(column.color as string);
            const total = visibleCards.filter((c) => c.column === column.id).length;
            const isManaged = knownKeys.has(column.id as string);
            const col = columnByKey.get(column.id as string);
            const stageType = toStageType(col?.stage_type);
            const stageStyle = getColorStyle(stageTypeColor[stageType]);

            return (
              // A cor da etapa tinge a COLUNA inteira. O card fica neutro e a
              // identidade da etapa vem do painel que o contém — dá para saber
              // em que etapa se está sem ler o rótulo.
              <KanbanBoard id={column.id} key={column.id} className={style.panel}>
                <KanbanHeader
                  className="flex items-center justify-between gap-2 border-b border-border/60 bg-card/70 px-3 py-3 backdrop-blur-sm"
                >
                  <span className={cn("flex min-w-0 items-center gap-2", style.text)}>
                    <span className={cn("size-2 shrink-0 rounded-full", style.dot)} aria-hidden />
                    <span className="truncate text-xs font-semibold uppercase tracking-wide">
                      {column.name as string}
                    </span>
                    {/* Pílula, não círculo: com 3+ dígitos o número precisa crescer
                        na horizontal em vez de vazar do aro. */}
                    <span
                      className={cn(
                        "flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-background px-1.5 text-[11px] font-semibold tabular-nums ring-1",
                        style.ring,
                        style.text
                      )}
                    >
                      {total}
                    </span>
                    {showStageMeta && isManaged ? (
                      <>
                        {col?.probability !== null && col?.probability !== undefined ? (
                          <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
                            {col.probability}%
                          </span>
                        ) : null}
                        <Badge
                          variant="outline"
                          className={cn(
                            "shrink-0 rounded-full border px-1.5 py-0 text-[10px] font-medium",
                            stageStyle.badge
                          )}
                        >
                          {stageTypeLabel[stageType]}
                        </Badge>
                      </>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5">
                    {isManaged ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Configurar ${column.name}`}
                        onClick={() => setFunnelSettingsOpen(true)}
                        className="size-11 text-muted-foreground hover:text-foreground sm:size-8"
                      >
                        <Settings2Icon />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Novo card em ${column.name}`}
                      onClick={() => openDealCreate(column.id as string)}
                      className="size-11 text-muted-foreground hover:text-foreground sm:size-8"
                    >
                      <PlusIcon />
                    </Button>
                  </span>
                </KanbanHeader>

                <KanbanCards
                  id={column.id}
                  empty={
                    <div className="grid min-h-32 place-items-center rounded-lg border border-dashed border-border/70 bg-background/60 px-4 py-6 text-center">
                      <div className="grid justify-items-center gap-2">
                        <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <InboxIcon className="size-4" aria-hidden />
                        </span>
                        <div className="grid gap-1">
                          <p className="text-sm font-medium">
                            {isFiltered ? "Nada nesta etapa com os filtros atuais" : "Sem cards aqui"}
                          </p>
                          <p className="max-w-44 text-xs leading-snug text-muted-foreground">
                            {isFiltered
                              ? "Ajuste ou limpe os filtros para ver o que existe nesta etapa."
                              : "Arraste um card para esta etapa ou crie um novo direto nela."}
                          </p>
                        </div>
                        {isFiltered ? (
                          <Button variant="outline" size="sm" onClick={clearFilters}>
                            Limpar filtros
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openDealCreate(column.id as string)}
                          >
                            <PlusIcon data-icon="inline-start" />
                            Novo card
                          </Button>
                        )}
                      </div>
                    </div>
                  }
                >
                  {(card: Card) => {
                    const cardCol = columnByKey.get(card.column);
                    const cardStyle = getColorStyle((cardCol?.color as string) ?? "slate");
                    const cardStage = toStageType(cardCol?.stage_type);
                    const cardStageStyle = getColorStyle(stageTypeColor[cardStage]);
                    const lead = card.deal.lead;
                    const tipoEnsaio = card.deal.tipo_ensaio ?? lead?.tipo_ensaio ?? null;
                    const attribution = lead ? attributions[lead.id] : undefined;
                    const saleSummary = summarizeLeadSales(lead ? sales[lead.id] : undefined);
                    const isSaving = savingIds.has(card.id);
                    return (
                      <KanbanCard
                        key={card.id}
                        id={card.id}
                        name={card.name}
                        column={card.column}
                        className={cn(
                          // Card neutro: a cor forte é da coluna. Aqui a etapa aparece
                          // só como aro fino, e o hover eleva para dizer "sou clicável".
                          "group/card relative overflow-hidden border-transparent bg-card p-0 shadow-none ring-1 ring-inset transition-[transform,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                          cardStyle.ring,
                          isSaving && "pointer-events-none"
                        )}
                      >
                        {/* Gravando a etapa: o card fica ocupado e diz isso. */}
                        {isSaving ? (
                          <span
                            className="absolute inset-0 z-20 grid place-items-center bg-card/70"
                            role="status"
                            aria-label={`Salvando ${card.name}`}
                          >
                            <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-hidden />
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => openLead(lead)}
                          className={cn(
                            "flex w-full items-start gap-2.5 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            view.compact ? "p-2.5 pr-12" : "p-3 pr-12"
                          )}
                        >
                          <AvatarInitials name={card.name} size="sm" className="mt-px" />
                          {/* grid-cols-[minmax(0,1fr)] é obrigatório: sem isso a trilha
                              do grid vira max-content e conteúdo longo (nome da
                              campanha) vaza do card em vez de truncar. */}
                          <span
                            className={cn(
                              "grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)]",
                              view.compact ? "gap-1" : "gap-1.5"
                            )}
                          >
                            <span className="flex items-start justify-between gap-2">
                              <span className="line-clamp-2 min-w-0 text-sm font-semibold leading-snug">
                                {card.name}
                              </span>
                              {/* Venda registrada ocupa o slot de valor do card,
                                  que a estimativa deixava vazio. O ícone separa
                                  "vendeu" de "vale estimados X". */}
                              {saleSummary.hasSale ? (
                                <span
                                  className="flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400"
                                  title={
                                    saleSummary.count > 1
                                      ? `${saleSummary.count} vendas registradas`
                                      : "Venda registrada"
                                  }
                                >
                                  <BanknoteIcon className="size-3.5 shrink-0" aria-hidden />
                                  <span className="sr-only">Vendido:</span>
                                  {formatMoney(saleSummary.total)}
                                </span>
                              ) : card.deal.valor !== null && card.deal.valor !== undefined ? (
                                <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                                  {formatMoney(card.deal.valor)}
                                </span>
                              ) : null}
                            </span>

                            <span className="flex min-w-0 items-center gap-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                              <PhoneIcon className="size-3 shrink-0" aria-hidden />
                              <span className="truncate">{formatPhone(lead?.phone ?? null)}</span>
                            </span>

                            {/* Veio de anúncio: mostra de qual campanha, não só "anúncio". */}
                            {attribution ? (
                              <span
                                className="flex min-w-0 items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                                title={[
                                  `Campanha: ${attributionCampaignLabel(attribution)}`,
                                  attribution.adName ? `Anúncio: ${attribution.adName}` : null,
                                ].filter(Boolean).join(" · ")}
                              >
                                <MegaphoneIcon className="size-3 shrink-0" aria-hidden />
                                <span className="sr-only">Campanha:</span>
                                <span className="truncate">{attributionCampaignLabel(attribution)}</span>
                              </span>
                            ) : null}

                            {showStageMeta && cardCol ? (
                              <span className="flex items-center gap-1.5">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "rounded-full border px-1.5 py-0 text-[10px] font-medium",
                                    cardStageStyle.badge
                                  )}
                                >
                                  {stageTypeLabel[cardStage]}
                                </Badge>
                                {cardCol.probability !== null &&
                                cardCol.probability !== undefined ? (
                                  <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                                    {cardCol.probability}%
                                  </span>
                                ) : null}
                              </span>
                            ) : null}

                            {!view.compact && lead?.tags && lead.tags.length > 0 ? (
                              <span className="flex flex-wrap gap-1">
                                {lead.tags.map((tag) => {
                                  const s = getColorStyle(tag.color);
                                  return (
                                    <Badge
                                      key={tag.id}
                                      variant="outline"
                                      className={cn(
                                        "rounded-sm border px-1.5 py-0 text-[10px] font-medium",
                                        s.badge
                                      )}
                                    >
                                      {tag.name}
                                    </Badge>
                                  );
                                })}
                              </span>
                            ) : null}

                            {!view.compact && (card.deal.scheduled_at || tipoEnsaio) ? (
                              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                {card.deal.scheduled_at ? (
                                  <span className="inline-flex items-center gap-1 tabular-nums">
                                    <CalendarDaysIcon className="size-3 shrink-0" aria-hidden />
                                    {shortDate.format(new Date(card.deal.scheduled_at))}
                                  </span>
                                ) : null}
                                {tipoEnsaio ? (
                                  <span className="truncate">{getTipoEnsaioLabel(tipoEnsaio)}</span>
                                ) : null}
                              </span>
                            ) : null}

                            {!view.compact && lead?.interesse ? (
                              <span className="line-clamp-2 text-xs text-muted-foreground">
                                {lead.interesse}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<Button type="button" variant="ghost" size="icon-sm" className="absolute right-1 top-1 z-10 size-11 bg-card/90 text-muted-foreground opacity-100 hover:text-foreground sm:right-2 sm:top-2 sm:size-8 sm:opacity-0 sm:group-hover/card:opacity-100 sm:focus-visible:opacity-100" aria-label={`Ações de ${card.name}`} />}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={() => openLead(lead)}>
                              <UserRoundIcon />
                              Abrir detalhes
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="min-h-11 sm:min-h-8"
                              onClick={() => {
                                setSaleDeal(card.deal);
                                setSaleOpen(true);
                              }}
                            >
                              <BanknoteIcon />
                              Registrar venda
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuLabel>Mover para</DropdownMenuLabel>
                              {providerColumns.filter((target) => target.id !== card.column).map((target) => (
                                <DropdownMenuItem key={target.id} className="min-h-11 sm:min-h-8" onClick={() => moveCard(card.id, String(target.id))}>
                                  <ArrowRightIcon />
                                  <span className="truncate">{String(target.name)}</span>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </KanbanCard>
                    );
                  }}
                </KanbanCards>
              </KanbanBoard>
            );
          }}
        </KanbanProvider>
        )}
      </div>

      <LeadDetailDialog
        lead={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        allTags={tags}
        attribution={selected ? attributions[selected.id] ?? null : null}
        sales={selected ? sales[selected.id] ?? [] : []}
        procedures={procedures}
      />
      <SaleDialog
        deal={saleDeal}
        procedures={procedures}
        open={saleOpen}
        onOpenChange={setSaleOpen}
      />
      <FunnelSettingsDialog
        columns={columns}
        open={funnelSettingsOpen}
        onOpenChange={setFunnelSettingsOpen}
        showStageMeta={showStageMeta}
      />
      {/* Instância controlada p/ o "+" de cada coluna */}
      <CreateDealDialog
        columns={columns}
        defaultStage={dealCreateStage}
        open={dealCreateOpen}
        onOpenChange={setDealCreateOpen}
        hideTrigger
      />
    </div>
  );
}

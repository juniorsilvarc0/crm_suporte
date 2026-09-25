"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArchiveIcon, BadgeCheckIcon, BanknoteIcon, CalendarCheckIcon, CopyIcon, EyeIcon, Loader2Icon, MegaphoneIcon, MoreHorizontalIcon, Settings2Icon, TagIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSelect } from "@/components/forms/form-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AvatarInitials } from "@/components/data-display/avatar-initials";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/data-display/empty-state";
import { FilterButton, FilterField } from "@/components/data-display/data-toolbar";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SaleDialog } from "@/features/financeiro/components/sale-dialog";
import { LeadDetailDialog } from "@/features/leads/components/lead-detail-dialog";
import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";
import { useStartConversation } from "@/features/chat/hooks/use-start-conversation";
import {
  LeadsSearch,
  type LeadSearchColumn,
} from "@/features/leads/components/leads-search";
import {
  getLeadSourceLabel,
  getLeadStatusLabel,
  getLeadStatusStyle,
  leadStatusLabel,
  leadStatusOrder,
} from "@/features/leads/schemas/status";
import { getTipoEnsaioLabel } from "@/features/leads/schemas/status";
import { getColorStyle } from "@/features/leads/schemas/colors";
import type { Procedure } from "@/features/financeiro/lib/procedure-options";
import {
  EMPTY_SALE_RANGE,
  hasSaleFilter,
  matchesSaleFilter,
  summarizeLeadSales,
  type SaleRangeFilter,
} from "@/features/financeiro/lib/lead-sale-summary";
import type { LeadSale } from "@/features/financeiro/types";
import {
  attributionCampaignLabel,
  type LeadAttribution,
} from "@/features/meta/lead-attribution";
import type { Lead, Tag } from "@/features/leads/types";
import { formatDateTime } from "@/lib/formatters/date";
import { formatMoney } from "@/lib/formatters/money";
import { formatPhone } from "@/lib/formatters/phone";
import { cn } from "@/lib/utils";
import { sanitizeLeadSearch } from "@/features/leads/lib/leads-search";

// Normaliza texto para busca case-insensitive e sem acentos.
function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

// Texto pesquisável de um lead, conforme a coluna escolhida no filtro.
function leadSearchText(lead: Lead, column: LeadSearchColumn): string {
  switch (column) {
    case "lead":
      // Inclui o telefone (bruto, normalizado e formatado) além do nome.
      return [
        lead.name,
        lead.phone,
        lead.normalized_phone,
        formatPhone(lead.phone),
      ]
        .filter(Boolean)
        .join(" ");
    case "contexto":
      return [
        lead.tipo_ensaio,
        lead.agencia_nome,
        lead.valor_estimado != null ? String(lead.valor_estimado) : null,
        lead.interesse,
        lead.notes,
      ]
        .filter(Boolean)
        .join(" ");
    case "origem":
      return getLeadSourceLabel(lead.source ?? "outro");
    case "status":
      return getLeadStatusLabel(lead.status);
    case "entrada":
      return formatDateTime(lead.created_at);
  }
}

export function LeadsTable({
  leads,
  showSummary = false,
  allTags = [],
  summary,
  attributions = {},
  sales = {},
  procedures = [],
  initialSearchColumn = "lead",
  initialSearchQuery = "",
}: {
  leads: Lead[];
  showSummary?: boolean;
  allTags?: Tag[];
  summary?: { total: number; qualified: number; agendados: number };
  attributions?: Record<string, LeadAttribution>;
  sales?: Record<string, LeadSale[]>;
  procedures?: Procedure[];
  initialSearchColumn?: LeadSearchColumn;
  initialSearchQuery?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { startConversation, checkingPhone } = useStartConversation();
  const [selected, setSelected] = useState<Lead | null>(null);
  const [open, setOpen] = useState(false);
  const [searchColumn, setSearchColumn] = useState<LeadSearchColumn>(initialSearchColumn);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [bulkPending, setBulkPending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saleFilter, setSaleFilter] = useState<SaleRangeFilter>(EMPTY_SALE_RANGE);
  const [saleSort, setSaleSort] = useState<"none" | "desc" | "asc">("none");
  // Dois estados, como no funil: se `open` fosse derivado de `saleLead`, fechar
  // zeraria o lead no mesmo render e a guarda interna do SaleDialog
  // desmontaria o modal no meio da animação de saída.
  const [saleLead, setSaleLead] = useState<Lead | null>(null);
  const [saleOpen, setSaleOpen] = useState(false);

  useEffect(() => {
    if (
      searchColumn === initialSearchColumn &&
      searchQuery.trim() === initialSearchQuery.trim()
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const query = searchQuery.trim();
      params.delete("page");
      if (query) {
        params.set("q", query);
        if (searchColumn === "lead") params.delete("column");
        else params.set("column", searchColumn);
      } else {
        params.delete("q");
        params.delete("column");
      }
      const next = params.toString();
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [
    initialSearchColumn,
    initialSearchQuery,
    pathname,
    router,
    searchColumn,
    searchParams,
    searchQuery,
  ]);

  const filteredLeads = useMemo(() => {
    const term = normalizeSearch(searchQuery.trim());
    const totalOf = (lead: Lead) => summarizeLeadSales(sales[lead.id]).total;

    const matched = leads.filter((lead) => {
      if (term && !normalizeSearch(leadSearchText(lead, searchColumn)).includes(term)) {
        return false;
      }
      return matchesSaleFilter(summarizeLeadSales(sales[lead.id]), saleFilter);
    });

    if (saleSort === "none") return matched;
    return [...matched].sort((a, b) =>
      saleSort === "desc" ? totalOf(b) - totalOf(a) : totalOf(a) - totalOf(b)
    );
  }, [leads, searchColumn, searchQuery, saleFilter, saleSort, sales]);

  function openLead(lead: Lead) {
    setSelected(lead);
    setOpen(true);
  }

  function toggleLead(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(filteredLeads.map((lead) => lead.id)) : new Set());
  }

  async function runBulk(
    requestFor: (id: string) => Promise<Response>,
    successMessage: string,
  ) {
    if (!selectedIds.size) return;
    setBulkPending(true);
    try {
      const responses = await Promise.all([...selectedIds].map(requestFor));
      const failed = responses.filter((response) => !response.ok).length;
      if (failed) {
        toast.error(`${failed} ${failed === 1 ? "lead não pôde" : "leads não puderam"} ser atualizado${failed === 1 ? "" : "s"}.`);
        return;
      }
      toast.success(successMessage);
      setSelectedIds(new Set());
      setBulkStatus("");
      setBulkTag("");
      setDeleteOpen(false);
      router.refresh();
    } catch {
      toast.error("Não foi possível concluir a ação em massa.");
    } finally {
      setBulkPending(false);
    }
  }

  if (leads.length === 0 && !initialSearchQuery) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-8">
        <EmptyState>Nenhum lead cadastrado ainda.</EmptyState>
      </div>
    );
  }

  const qualifiedTotal = leads.filter((lead) =>
    ["qualificado", "agendado", "compareceu", "cliente", "recorrente"].includes(lead.status)
  ).length;
  const handoffTotal = leads.filter((lead) =>
    ["agendado", "compareceu", "cliente", "recorrente"].includes(lead.status)
  ).length;

  return (
    <>
      {/* Resumo em widgets SOLTOS, fora do painel — mesma linguagem dos KPIs do
          dashboard. Dentro do painel eles eram três células de uma régua. */}
      {showSummary ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <SummaryItem icon={<UsersIcon />} label="Total" value={summary?.total ?? leads.length} />
          <SummaryItem icon={<BadgeCheckIcon />} label="Qualificados" value={summary?.qualified ?? qualifiedTotal} />
          <SummaryItem icon={<CalendarCheckIcon />} label="Agendados" value={summary?.agendados ?? handoffTotal} />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
        <LeadsSearch
          column={searchColumn}
          query={searchQuery}
          onColumnChange={setSearchColumn}
          onQueryChange={(value) => setSearchQuery(sanitizeLeadSearch(value))}
          filters={
            <FilterButton
              activeCount={(hasSaleFilter(saleFilter) ? 1 : 0) + (saleSort === "none" ? 0 : 1)}
            >
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
              <FilterField label="Ordenar por valor">
                <FormSelect
                  value={saleSort}
                  onValueChange={(value) => setSaleSort(value as "none" | "desc" | "asc")}
                  aria-label="Ordenar por valor vendido"
                  options={[
                    { value: "none", label: "Sem ordenação" },
                    { value: "desc", label: "Maior valor" },
                    { value: "asc", label: "Menor valor" },
                  ]}
                />
              </FilterField>
            </FilterButton>
          }
        />

        {selectedIds.size ? (
          <div className="flex flex-col gap-3 border-b border-border bg-muted/20 px-3 py-3 lg:flex-row lg:items-center">
            <div className="flex min-w-0 items-center gap-2 lg:mr-auto">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Settings2Icon className="size-4" aria-hidden /></span>
              <p className="text-sm font-medium">{selectedIds.size} {selectedIds.size === 1 ? "lead selecionado" : "leads selecionados"}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[12rem_auto_12rem_auto_auto]">
              <FormSelect value={bulkStatus} onValueChange={setBulkStatus} emptyLabel="Alterar status" aria-label="Novo status dos leads" options={leadStatusOrder.map((status) => ({ value: status, label: leadStatusLabel[status] }))} />
              <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={!bulkStatus || bulkPending} onClick={() => runBulk((id) => fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: bulkStatus }) }), "Status atualizado em massa.")}>
                Aplicar
              </Button>
              <FormSelect value={bulkTag} onValueChange={setBulkTag} emptyLabel="Adicionar tag" aria-label="Tag para adicionar aos leads" options={allTags.map((tag) => ({ value: tag.id, label: tag.name }))} />
              <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={!bulkTag || bulkPending} onClick={() => runBulk((id) => fetch(`/api/leads/${id}/tags`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag_id: bulkTag }) }), "Tag adicionada em massa.")}>
                <TagIcon data-icon="inline-start" />Aplicar
              </Button>
              <Button type="button" variant="ghost" className="h-11 sm:h-9" disabled={bulkPending} onClick={() => setDeleteOpen(true)}>
                <ArchiveIcon data-icon="inline-start" />Arquivar
              </Button>
            </div>
          </div>
        ) : null}

        {filteredLeads.length === 0 ? (
          <div className="p-8">
            <EmptyState>Nenhum lead encontrado para a busca.</EmptyState>
          </div>
        ) : (
          <>
        {/*
          Casca 3.0 no desktop: a lista NÃO é uma grade de linhas coladas — cada
          pessoa é um cartão. `border-separate` + `border-spacing-y-2` afasta as
          linhas, e o cartão é desenhado nas CÉLULAS (`<tr>` não aceita raio nem
          borda de forma confiável): fundo do cartão em toda `td`, borda em cima
          e embaixo, e o arredondamento nas pontas.
        */}
        <div className="hidden bg-muted/20 px-2 pb-2 md:block">
          <Table variant="cards" className="w-full table-fixed">
            <TableHeader>
              <TableRow variant="cards-header">
                <TableHead className="h-9 w-12 px-4">
                  <Checkbox checked={filteredLeads.length > 0 && filteredLeads.every((lead) => selectedIds.has(lead.id))} onCheckedChange={(checked) => toggleAll(Boolean(checked))} aria-label="Selecionar todos os leads exibidos" />
                </TableHead>
                {/* Origem ganhou espaço de Contexto: nome de campanha do Meta
                    tem 40+ caracteres e a coluna de 12% não cabia nem metade. */}
                <TableHead className="h-9 w-[24%] px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Lead
                </TableHead>
                <TableHead className="h-9 w-[22%] px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Contexto
                </TableHead>
                <TableHead className="h-9 w-[18%] px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Origem
                </TableHead>
                <TableHead className="h-9 w-[14%] px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="h-9 w-[14%] px-4 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Entrada
                </TableHead>
                <TableHead className="h-9 w-[8%] px-2" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLeads.map((lead) => (
                <TableRow
                  key={lead.id}
                  onClick={() => openLead(lead)}
                  variant="card"
                  className={cn("group cursor-pointer", selectedIds.has(lead.id) && "[&>td]:bg-primary/[0.05]")}
                >
                  <TableCell className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                    <Checkbox checked={selectedIds.has(lead.id)} onCheckedChange={(checked) => toggleLead(lead.id, Boolean(checked))} aria-label={`Selecionar ${lead.name ?? "lead"}`} />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <LeadIdentity lead={lead} />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    {/* `minmax(0,1fr)`: track de grid é `auto` por padrão e não
                        encolhe abaixo do conteúdo — uma tag longa esticaria a
                        célula por cima da vizinha. Ver UI.md §Anti-padrões. */}
                    <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
                      <LeadContext lead={lead} sales={sales[lead.id]} />
                      <TagPills tags={lead.tags} />
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <SourceBadge source={lead.source} attribution={attributions[lead.id]} />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <LeadStatusBadge status={lead.status} />
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(lead.created_at)}
                  </TableCell>
                  <TableCell className="px-2 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <OpenChatButton lead={lead} pending={Boolean(lead.phone && checkingPhone === lead.phone)} onOpen={startConversation} />
                      <LeadRowMenu lead={lead} onOpen={() => openLead(lead)} onRegisterSale={() => { setSaleLead(lead); setSaleOpen(true); }} onOpenChat={startConversation} checkingPhone={checkingPhone} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Casca 3.0: no celular a lista é uma pilha de CARTÕES de pessoa, não
            linhas de tabela espremidas. Cada cartão tem avatar, faixa de status
            e a ação de conversa à mão.
            O leito levemente tingido é o que faz o cartão branco existir: dentro
            de um painel branco, cartão branco só teria a borda para se separar. */}
        <div className="grid gap-2 bg-muted/25 p-2 md:hidden">
          {filteredLeads.map((lead) => (
            <article
              key={lead.id}
              onClick={() => openLead(lead)}
              // ⚠️ `grid-cols-[minmax(0,1fr)]` NÃO é enfeite — sem ele o cartão
              // vaza da tela no celular. Um grid sem coluna declarada cria uma
              // trilha implícita `auto`, cujo piso é o min-content do conteúdo.
              // E aqui nada encolhe: `truncate` implica `white-space: nowrap`
              // (min-content = a frase inteira), o Badge é `shrink-0
              // whitespace-nowrap` e o botão de ações tem 44px fixos. A trilha
              // estoura os ~302px do celular e o `overflow-hidden` fatia o
              // resto — o `truncate` nunca dispara, porque a caixa se ajusta ao
              // texto em vez do contrário.
              //
              // `minmax(0,1fr)` resolve em dois níveis: fixa a base da trilha em
              // 0 e, por a função de mínimo deixar de ser `auto`, desliga o
              // automatic minimum size do item (CSS Grid §6.6). Só então o
              // `min-w-0` e o `truncate` que já existem passam a valer.
              //
              // `min-w-0` nos ancestrais NÃO resolve: ele tira o piso de
              // encolhimento, mas não reduz a contribuição de min-content que
              // sobe até a trilha.
              className={cn("relative grid w-full grid-cols-[minmax(0,1fr)] cursor-pointer gap-3 overflow-hidden rounded-xl border border-border/70 bg-card px-4 py-3 pl-5 text-left transition-colors hover:bg-muted/40", selectedIds.has(lead.id) && "bg-primary/[0.04]")}
            >
              {/* Barra de acento na cor do status — classes literais de colors.ts. */}
              <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", getLeadStatusStyle(lead.status).bar)} />
              {/* ⚠️ `min-w-0` nas DUAS linhas do cartão, não só nos filhos.
                  Elas são itens de grid, e item de grid tem `min-width: auto` —
                  que só resolve para 0 quando a trilha não tem mínimo `auto`.
                  Depender dessa sutileza deixou o conteúdo estourando no Safari
                  do iPhone mesmo depois de a trilha ser corrigida: o cartão
                  passou a caber, o texto dentro dele não. Declarar `min-w-0` é
                  explícito e vale em qualquer motor. */}
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span onClick={(event) => event.stopPropagation()}><Checkbox checked={selectedIds.has(lead.id)} onCheckedChange={(checked) => toggleLead(lead.id, Boolean(checked))} aria-label={`Selecionar ${lead.name ?? "lead"}`} /></span>
                  <LeadIdentity lead={lead} />
                </div>
                <div className="flex shrink-0 items-center gap-1"><LeadStatusBadge status={lead.status} /><LeadRowMenu lead={lead} onOpen={() => openLead(lead)} onRegisterSale={() => { setSaleLead(lead); setSaleOpen(true); }} onOpenChat={startConversation} checkingPhone={checkingPhone} /></div>
              </div>
              <LeadContext lead={lead} sales={sales[lead.id]} />
              <TagPills tags={lead.tags} />
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                {/* Wrapper com `min-w-0`: a Badge é `shrink-0` no primitivo, e
                    sem isto o nome da campanha empurra a data para fora. */}
                <div className="min-w-0">
                  <SourceBadge source={lead.source} attribution={attributions[lead.id]} />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono tabular-nums">{formatDateTime(lead.created_at)}</span>
                  <OpenChatButton lead={lead} pending={Boolean(lead.phone && checkingPhone === lead.phone)} onOpen={startConversation} />
                </div>
              </div>
            </article>
          ))}
        </div>
          </>
        )}
      </div>

      <LeadDetailDialog
        lead={selected}
        open={open}
        onOpenChange={setOpen}
        allTags={allTags}
        attribution={selected ? attributions[selected.id] ?? null : null}
        sales={selected ? sales[selected.id] ?? [] : []}
        procedures={procedures}
      />
      <SaleDialog
        lead={saleLead}
        procedures={procedures}
        open={saleOpen}
        onOpenChange={setSaleOpen}
      />
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Arquivar pessoas selecionadas?</DialogTitle><DialogDescription>Elas sairão da lista ativa, mas conversas, oportunidades e histórico serão preservados.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)} disabled={bulkPending}>Cancelar</Button>
            <Button type="button" disabled={bulkPending} onClick={() => runBulk((id) => fetch(`/api/leads/${id}`, { method: "DELETE" }), "Pessoas arquivadas.")}>
              {bulkPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <ArchiveIcon data-icon="inline-start" />}Arquivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OpenChatButton({
  lead,
  pending,
  onOpen,
}: {
  lead: Lead;
  pending: boolean;
  onOpen: (phone: string, name?: string) => Promise<boolean>;
}) {
  return (
    <button
      type="button"
      // A linha inteira abre o modal de detalhe; impedimos que o clique/teclado
      // do botão de chat borbulhe e dispare o modal junto.
      onClick={(event) => {
        event.stopPropagation();
        if (lead.phone) void onOpen(lead.phone, lead.name ?? undefined);
      }}
      onKeyDown={(event) => event.stopPropagation()}
      disabled={!lead.phone || pending}
      aria-label={`Abrir chat com ${lead.name ?? "lead"}`}
      title="Abrir chat"
      // O verde é o do WhatsApp e diz, sozinho, o que o botão faz. Círculo
      // porque é ação de contato, não item de barra de ferramentas.
      className="inline-flex size-11 items-center justify-center rounded-full bg-[#25D366]/10 text-[#128C7E] outline-none transition-colors hover:bg-[#25D366]/20 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 sm:size-9 dark:text-[#25D366]"
    >
      {pending ? <Loader2Icon className="size-4 animate-spin" /> : <WhatsAppIcon className="size-[18px]" />}
    </button>
  );
}

function LeadRowMenu({
  lead,
  onOpen,
  onRegisterSale,
  onOpenChat,
  checkingPhone,
}: {
  lead: Lead;
  onOpen: () => void;
  onRegisterSale: () => void;
  onOpenChat: (phone: string, name?: string) => Promise<boolean>;
  checkingPhone: string | null;
}) {
  async function copyPhone() {
    if (!lead.phone) return;
    try {
      await navigator.clipboard.writeText(lead.phone);
      toast.success("Telefone copiado.");
    } catch {
      toast.error("Não foi possível copiar o telefone.");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" className="size-11 text-muted-foreground sm:size-8" aria-label={`Ações de ${lead.name ?? "lead"}`} onClick={(event) => event.stopPropagation()} />}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={onOpen}><EyeIcon />Ver detalhes</DropdownMenuItem>
        {/* Mesmo componente do funil (SaleDialog). O card de destino é resolvido
            no servidor, porque a lista de leads não carrega `deals`. */}
        <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={onRegisterSale}><BanknoteIcon />Registrar venda</DropdownMenuItem>
        {lead.phone ? <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={copyPhone}><CopyIcon />Copiar telefone</DropdownMenuItem> : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-11 sm:min-h-8"
          disabled={!lead.phone || checkingPhone === lead.phone}
          onClick={() => {
            if (lead.phone) void onOpenChat(lead.phone, lead.name ?? undefined);
          }}
        >
          {checkingPhone === lead.phone ? <Loader2Icon className="size-4 animate-spin" /> : <WhatsAppIcon className="size-4" brand />}Abrir conversa
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TagPills({ tags }: { tags?: Tag[] }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => {
        const s = getColorStyle(tag.color);
        return (
          <Badge
            key={tag.id}
            variant="outline"
            className={cn("rounded-sm border px-1.5 py-0 text-[10px] font-medium", s.badge)}
          >
            {tag.name}
          </Badge>
        );
      })}
    </div>
  );
}

function SummaryItem({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center gap-3 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-[18px] [&_svg]:stroke-[1.75]" aria-hidden>{icon}</span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-0.5 font-display text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        </div>
      </div>
    </Card>
  );
}

function LeadIdentity({ lead }: { lead: Lead }) {
  return (
    // Pessoa antes de dado: a inicial dá âncora visual para varrer a lista, do
    // mesmo jeito que o card do funil. Tom neutro — cor aqui é etapa, não gente.
    <div className="flex min-w-0 items-center gap-2.5">
      <AvatarInitials name={lead.name} size="md" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{lead.name ?? "Sem nome"}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-muted-foreground">
          <span className="tabular-nums">{formatPhone(lead.phone)}</span>
          {lead.instagram_user ? (
            <span>@{lead.instagram_user.replace(/^@/, "")}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LeadContext({ lead, sales }: { lead: Lead; sales?: LeadSale[] }) {
  const summary = summarizeLeadSales(sales);
  const details = [
    lead.tipo_ensaio ? `Serviço: ${getTipoEnsaioLabel(lead.tipo_ensaio)}` : null,
    lead.valor_estimado ? `R$ ${lead.valor_estimado}` : null,
  ].filter(Boolean);

  return (
    <div className="min-w-0">
      {/* Venda registrada vem antes do contexto: é o dado mais forte da linha. */}
      {summary.hasSale ? (
        <div className="mb-0.5 flex items-center gap-1 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
          <BanknoteIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="sr-only">Vendido:</span>
          {formatMoney(summary.total)}
          {summary.count > 1 ? (
            <span className="font-normal text-muted-foreground">
              ({summary.count} vendas)
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="truncate text-sm text-foreground">
        {details.length > 0 ? details.join(" · ") : "Sem contexto informado"}
      </div>
      {lead.notes ? (
        <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{lead.notes}</div>
      ) : null}
    </div>
  );
}

// Com atribuição, a badge deixa de dizer só "veio de anúncio" e nomeia a campanha.
function SourceBadge({
  source,
  attribution,
}: {
  source: Lead["source"];
  attribution?: LeadAttribution;
}) {
  if (attribution) {
    const campaign = attributionCampaignLabel(attribution);
    return (
      // `max-w-full`, não uma largura fixa: a coluna Origem é menor que 14rem
      // no desktop, e o `shrink-0` do primitivo Badge fazia a badge transbordar
      // por cima da coluna Status. O nome inteiro fica no `title`.
      <Badge
        variant="outline"
        className="max-w-full rounded-sm border-primary/30 bg-primary/5 px-2 py-0 text-[11px] font-medium text-primary"
        title={`Campanha: ${campaign}`}
      >
        <MegaphoneIcon className="size-3 shrink-0" aria-hidden />
        <span className="sr-only">Campanha:</span>
        {/* `min-w-0` é o que permite o item flex encolher e o `truncate` agir. */}
        <span className="min-w-0 truncate">{campaign}</span>
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="rounded-sm border-border bg-background px-2 py-0 text-[11px] font-medium text-muted-foreground"
    >
      {getLeadSourceLabel(source ?? "outro")}
    </Badge>
  );
}

function LeadStatusBadge({ status }: { status: Lead["status"] }) {
  const style = getLeadStatusStyle(status);
  return (
    <Badge
      variant="outline"
      className={cn("rounded-sm border px-2 py-0 text-[11px] font-medium", style.badge)}
    >
      <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden />
      {getLeadStatusLabel(status)}
    </Badge>
  );
}

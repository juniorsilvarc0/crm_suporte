"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarIcon, SlidersHorizontalIcon } from "lucide-react";

import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { MetaFilterOptions } from "@/features/meta/report";
import { cn } from "@/lib/utils";

export type TrackingFilterValues = {
  from: string;
  to: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
};

const TIME_ZONE = "America/Fortaleza";

const presets = [
  { days: 7, label: "7 dias" },
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
] as const;

function isoDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

function rangeFor(days: number) {
  const today = new Date();
  return {
    from: isoDate(new Date(today.getTime() - (days - 1) * 86_400_000)),
    to: isoDate(today),
  };
}

/**
 * Qual atalho de período está valendo, deduzido do que está aplicado.
 *
 * O estado do chip **não é guardado** — é derivado do `from`/`to` da URL. Guardar
 * "qual chip está aceso" ao lado do período real cria duas verdades que divergem
 * no primeiro voltar do navegador. É o padrão do `detectActiveQuickFilter` do
 * financeiro do JuridiQ.
 */
export function activePresetDays(filters: { from: string; to: string }): number | null {
  for (const preset of presets) {
    const range = rangeFor(preset.days);
    if (filters.from === range.from && filters.to === range.to) return preset.days;
  }
  return null;
}

export function TrackingFilters({
  filters,
  options,
}: {
  filters: TrackingFilterValues;
  /** Campanhas, conjuntos e anúncios com contato no período. */
  options: MetaFilterOptions;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);

  // O servidor é a fonte de verdade: ao voltar de uma navegação, o rascunho
  // acompanha os parâmetros que realmente estão aplicados.
  const [applied, setApplied] = useState(filters);
  if (filters !== applied) {
    setApplied(filters);
    setDraft(filters);
  }

  // Fechar sem aplicar descarta o rascunho. É um evento, não sincronização —
  // por isso vive aqui e não num efeito.
  function handleOpenChange(next: boolean) {
    if (!next) setDraft(applied);
    setOpen(next);
  }

  const advancedCount = [filters.campaignId, filters.adsetId, filters.adId].filter(
    Boolean
  ).length;
  const invalidRange = draft.from > draft.to;
  const currentPreset = activePresetDays(filters);

  // ⚠️ Parte do que JÁ está na URL, não de um `URLSearchParams` vazio. A aba
  // ativa vive em `?aba=`; montando a query do zero, trocar o período jogava
  // quem estava em Custos de volta para a Visão geral a cada clique.
  function navigate(next: TrackingFilterValues) {
    const query = new URLSearchParams(searchParams.toString());
    query.set("from", next.from);
    query.set("to", next.to);
    for (const key of ["campaignId", "adsetId", "adId"] as const) {
      const value = next[key]?.trim();
      if (value) query.set(key, value);
      else query.delete(key);
    }
    router.push(`${pathname}?${query}`);
  }

  function set(patch: Partial<TrackingFilterValues>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function apply() {
    if (invalidRange) return;
    setOpen(false);
    navigate(draft);
  }

  // "Limpar tudo" zera os filtros, não a aba: quem está em Custos continua em
  // Custos com o período padrão.
  function clear() {
    setOpen(false);
    const query = new URLSearchParams(searchParams.toString());
    for (const key of ["from", "to", "campaignId", "adsetId", "adId"] as const) {
      query.delete(key);
    }
    const rest = query.toString();
    router.push(rest ? `${pathname}?${rest}` : pathname);
  }

  return (
    <div className="flex flex-col gap-2">
      {/*
        Atalhos de período em linha. Antes, trocar de 30 para 7 dias custava três
        toques dentro de um popover; agora custa um. A faixa rola na horizontal
        para nunca quebrar em duas linhas no telefone.
      */}
      <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {presets.map((preset) => {
          const active = currentPreset === preset.days;
          return (
            <button
              key={preset.days}
              type="button"
              aria-pressed={active}
              onClick={() => navigate({ ...filters, ...rangeFor(preset.days) })}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors sm:h-9",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {preset.label}
            </button>
          );
        })}

        <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger
            className={cn(
              "inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors sm:h-9",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              advancedCount || currentPreset === null
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <SlidersHorizontalIcon className="size-3.5" aria-hidden />
            {advancedCount ? `Filtros (${advancedCount})` : "Filtros"}
          </PopoverTrigger>

          <PopoverContent
            align="start"
            className="w-[min(24rem,calc(100vw-2rem))] gap-4 p-4"
          >
            <FieldGroup
              label="Período"
              hint="Conta pela data em que a pessoa falou com a clínica pela primeira vez vindo de um anúncio."
            >
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1.5">
                  <span className="text-xs text-muted-foreground">De</span>
                  <Input
                    type="date"
                    value={draft.from}
                    max={draft.to}
                    onChange={(event) => set({ from: event.target.value })}
                    className="h-11 sm:h-9"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs text-muted-foreground">Até</span>
                  <Input
                    type="date"
                    value={draft.to}
                    min={draft.from}
                    onChange={(event) => set({ to: event.target.value })}
                    className="h-11 sm:h-9"
                  />
                </label>
              </div>
              {invalidRange ? (
                <p className="text-xs text-destructive">
                  A data inicial não pode ser maior que a final.
                </p>
              ) : null}
            </FieldGroup>

            {/*
              Seletores, não campos de ID. Antes era preciso saber e colar
              "120200000000000000" para filtrar uma campanha — na prática o
              filtro não existia para quem opera.
            */}
            <FieldGroup label="Campanha" hint="Só as que trouxeram contato no período.">
              <FormSelect
                value={draft.campaignId ?? ""}
                onValueChange={(campaignId) => set({ campaignId })}
                emptyLabel="Todas as campanhas"
                options={options.campaigns}
                disabled={options.campaigns.length === 0}
                aria-label="Filtrar por campanha"
              />
            </FieldGroup>

            <FieldGroup label="Conjunto" hint="O público dentro da campanha.">
              <FormSelect
                value={draft.adsetId ?? ""}
                onValueChange={(adsetId) => set({ adsetId })}
                emptyLabel="Todos os conjuntos"
                options={options.adsets}
                disabled={options.adsets.length === 0}
                aria-label="Filtrar por conjunto"
              />
            </FieldGroup>

            <FieldGroup label="Anúncio" hint="A peça que a pessoa clicou.">
              <FormSelect
                value={draft.adId ?? ""}
                onValueChange={(adId) => set({ adId })}
                emptyLabel="Todos os anúncios"
                options={options.ads}
                disabled={options.ads.length === 0}
                aria-label="Filtrar por anúncio"
              />
            </FieldGroup>

            <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
              <Button variant="ghost" size="lg" onClick={clear} className="h-11 sm:h-9">
                Limpar tudo
              </Button>
              <Button size="lg" onClick={apply} disabled={invalidRange} className="h-11 sm:h-9">
                Aplicar
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <p className="ms-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
          <CalendarIcon className="size-3.5" aria-hidden />
          {shortDate(filters.from)} <span aria-hidden>–</span> {shortDate(filters.to)}
          <span className="sr-only">é o período aplicado</span>
        </p>
      </div>

      {advancedCount > 0 ? <ActiveFilterChips filters={filters} options={options} /> : null}
    </div>
  );
}

/**
 * O que está filtrado, por nome, com como tirar.
 *
 * Sem isto o contador "Filtros (2)" é a única pista, e descobrir QUAIS dois
 * exige abrir o popover.
 */
function ActiveFilterChips({
  filters,
  options,
}: {
  filters: TrackingFilterValues;
  options: MetaFilterOptions;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const active = (
    [
      { key: "campaignId", label: "Campanha", list: options.campaigns },
      { key: "adsetId", label: "Conjunto", list: options.adsets },
      { key: "adId", label: "Anúncio", list: options.ads },
    ] as const
  ).flatMap((entry) => {
    const value = filters[entry.key];
    if (!value) return [];
    const name = entry.list.find((option) => option.value === value)?.label ?? value;
    return [{ ...entry, value, name }];
  });

  function removeFilter(key: "campaignId" | "adsetId" | "adId") {
    const query = new URLSearchParams(searchParams.toString());
    query.set("from", filters.from);
    query.set("to", filters.to);
    for (const candidate of ["campaignId", "adsetId", "adId"] as const) {
      const value = candidate === key ? undefined : filters[candidate]?.trim();
      if (value) query.set(candidate, value);
      else query.delete(candidate);
    }
    router.push(`${pathname}?${query}`);
  }

  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {active.map((entry) => (
        <li key={entry.key}>
          <button
            type="button"
            onClick={() => removeFilter(entry.key)}
            aria-label={`Remover filtro de ${entry.label.toLowerCase()}: ${entry.name}`}
            className="inline-flex h-9 max-w-[min(18rem,80vw)] items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="shrink-0 text-muted-foreground/70">{entry.label}:</span>
            <span className="min-w-0 truncate">{entry.name}</span>
            <span aria-hidden className="shrink-0 text-sm leading-none">
              ×
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}

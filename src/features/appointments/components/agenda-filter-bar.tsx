"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { RefreshCwIcon } from "lucide-react";

import {
  ActiveFilters,
  FilterButton,
  FilterField,
  ToolbarSearch,
} from "@/components/data-display/data-toolbar";
import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui/button";
import { AgendaNavProgress } from "@/features/appointments/components/agenda-nav-progress";
import {
  statusFilterOptions,
  type AgendaView,
} from "@/features/appointments/components/agenda-utils";
import { cn } from "@/lib/utils";

/**
 * Busca, filtros e contagem — **uma linha no telefone**.
 *
 * Antes usava a `DataToolbar` padrão, que empilha no mobile: busca numa linha,
 * "Filtros" noutra, contagem numa terceira. Três faixas de 44 px para dois
 * controles ocasionais, tirando altura da lista de agendamentos. Aqui a
 * `DataToolbar` sai e as peças dela (`ToolbarSearch`, `FilterButton`,
 * `ActiveFilters`) continuam as mesmas — é o *arranjo* que muda, não o
 * vocabulário.
 *
 * "Limpar filtros" desceu para dentro do popover: em linha única ele espremia a
 * busca a nada justamente quando havia filtro ativo. O aviso de que existe
 * filtro continua onde sempre esteve, no contador do próprio botão "Filtros".
 */
export function AgendaFilterBar({
  monthKey,
  dateKey,
  view,
  status,
  tipo,
  q,
  resultCount,
  tipoOptions,
}: {
  monthKey: string;
  dateKey: string;
  view: AgendaView;
  status: string;
  tipo: string;
  q: string;
  resultCount: number;
  /** Serviços presentes nos agendamentos em tela. Ver buildTipoFilterOptions. */
  tipoOptions: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState(q);
  // Duas transições porque os dois estados dizem coisas diferentes: a barra da
  // faixa acende para qualquer uma, mas só o "atualizar" gira o próprio ícone.
  const [filterPending, startFilter] = useTransition();
  const [refreshPending, startRefresh] = useTransition();

  function hrefFor(next: { status?: string; tipo?: string; q?: string }) {
    const params = new URLSearchParams();
    params.set("view", view);
    if (view === "semana" || view === "dia") params.set("date", dateKey);
    else params.set("month", monthKey);

    const nextStatus = next.status ?? status;
    const nextTipo = next.tipo ?? tipo;
    const nextQuery = (next.q ?? q).trim();
    if (nextStatus) params.set("status", nextStatus);
    if (nextTipo) params.set("tipo", nextTipo);
    if (nextQuery) params.set("q", nextQuery);
    return `/app/agendamentos?${params.toString()}`;
  }

  function navigate(next: { status?: string; tipo?: string; q?: string }) {
    startFilter(() => {
      router.push(hrefFor(next), { scroll: false });
    });
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate({ q: search });
  }

  const filterCount = [status, tipo].filter(Boolean).length;

  return (
    <div className="relative flex items-center gap-2 border-b border-border/70 bg-card px-3 py-2 lg:px-4">
      <form onSubmit={handleSearch} className="min-w-0 flex-1 sm:max-w-xs">
        <ToolbarSearch
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            if (!event.target.value) navigate({ q: "" });
          }}
          placeholder="Buscar cliente, telefone, serviço..."
          aria-label="Buscar agendamentos"
        />
      </form>
      <FilterButton activeCount={filterCount}>
        <FilterField label="Status">
          <FormSelect
            value={status}
            onValueChange={(value) => navigate({ status: value })}
            emptyLabel="Todos os status"
            options={statusFilterOptions.filter((option) => option.value)}
          />
        </FilterField>
        <FilterField label="Serviço">
          <FormSelect
            value={tipo}
            onValueChange={(value) => navigate({ tipo: value })}
            emptyLabel="Todos os serviços"
            options={tipoOptions}
          />
        </FilterField>
        <ActiveFilters count={filterCount} onClear={() => navigate({ status: "", tipo: "" })} />
      </FilterButton>
      {/*
        `aria-live` porque o número é a única confirmação de que o filtro pegou:
        quem não vê a lista precisa ouvir "12 agendamentos". A palavra some da
        tela abaixo de `sm` para caber na linha, mas continua sendo lida.
      */}
      <p aria-live="polite" className="shrink-0 text-xs text-muted-foreground">
        <span className="font-medium tabular-nums text-foreground">{resultCount}</span>{" "}
        <span className="max-sm:sr-only">
          {resultCount === 1 ? "agendamento" : "agendamentos"}
        </span>
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => startRefresh(() => router.refresh())}
        aria-label="Atualizar agenda"
        className="size-11 shrink-0 sm:size-9"
      >
        <RefreshCwIcon aria-hidden className={cn(refreshPending && "animate-spin")} />
      </Button>
      <AgendaNavProgress active={filterPending || refreshPending} />
    </div>
  );
}

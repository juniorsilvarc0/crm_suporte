"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, SlidersHorizontalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { cn } from "@/lib/utils";

/**
 * O que o seletor precisa saber de um funil.
 *
 * Estrutural de propósito: qualquer linha de `pipelines` satisfaz este tipo,
 * então a tela não fica presa ao tipo exato devolvido pela consulta.
 */
export type PipelineSwitcherItem = {
  id: string;
  name: string;
  color: string;
  /** Cards ativos, quando a consulta já os contou. */
  cardCount?: number;
};

/**
 * Acima disto as pílulas param de caber.
 *
 * Escolha: **pílulas até 5 funis, menu acima disso.** Com poucos funis, as
 * pílulas mostram tudo de uma vez e trocar é um toque só — o menu esconderia
 * uma lista que já cabia na tela. A partir do sexto, a fileira só caberia
 * rolando na horizontal, e opção que só existe depois de rolar é opção que
 * ninguém acha; aí o menu, que mostra o funil atual e abre a lista inteira,
 * passa a ser o controle honesto.
 */
const PILL_LIMIT = 5;

/** Endereço do funil. O estado da tela mora na URL, não em `useState`. */
export function pipelineHref(pipelineId: string) {
  return `/app/funil?funil=${encodeURIComponent(pipelineId)}`;
}

export function PipelineSwitcher({
  pipelines,
  activeId,
}: {
  pipelines: PipelineSwitcherItem[];
  /** Funil aberto agora. `null` só quando não há funil nenhum para abrir. */
  activeId: string | null;
}) {
  /*
    Seleção otimista, mesmo padrão do segmentado da agenda (UI.md §5.21):
    trocar de funil é um `<Link>` para `?funil=…`, e como só os search params
    mudam o segmento não remonta — o `loading.tsx` não aparece e a tela antiga
    fica intacta enquanto o servidor refaz a consulta. A pílula acende no toque.

    O palpite local cai assim que a prop `activeId` muda (inclusive ao voltar
    pelo histórico), ajustando estado durante a renderização — não em efeito.
  */
  const [clickedId, setClickedId] = useState<string | null>(null);
  const [lastActiveId, setLastActiveId] = useState(activeId);
  if (lastActiveId !== activeId) {
    setLastActiveId(activeId);
    setClickedId(null);
  }
  const selectedId = clickedId ?? activeId;

  // Sem funil não há o que trocar — e uma barra vazia só ocuparia altura numa
  // tela que já é de altura cheia.
  if (pipelines.length === 0) return null;

  const active = pipelines.find((pipeline) => pipeline.id === selectedId) ?? null;

  return (
    <nav
      aria-label="Funis"
      className="flex shrink-0 items-center gap-2 px-4 pt-3 sm:px-6 lg:px-8"
    >
      {pipelines.length > PILL_LIMIT ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="h-11 max-w-[16rem] font-display sm:h-9"
                aria-label="Trocar de funil"
              />
            }
          >
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                getColorStyle(active?.color).dot
              )}
              aria-hidden
            />
            <span className="truncate">{active?.name ?? "Escolher funil"}</span>
            <ChevronsUpDownIcon data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Funis</DropdownMenuLabel>
            {pipelines.map((pipeline) => {
              const isActive = pipeline.id === selectedId;
              return (
                <DropdownMenuItem
                  key={pipeline.id}
                  className="min-h-11 gap-2 sm:min-h-8"
                  render={
                    <Link
                      href={pipelineHref(pipeline.id)}
                      aria-current={pipeline.id === activeId ? "page" : undefined}
                    />
                  }
                  onClick={() => setClickedId(pipeline.id)}
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      getColorStyle(pipeline.color).dot
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{pipeline.name}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {pipeline.cardCount !== undefined ? (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {pipeline.cardCount}
                      </span>
                    ) : null}
                    {isActive ? <CheckIcon className="text-primary" aria-hidden /> : null}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <ul
          // Rola na horizontal no celular: com 5 pílulas a fileira ainda cabe
          // no desktop, mas numa tela estreita ela precisa poder deslizar.
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {pipelines.map((pipeline) => {
            const isActive = pipeline.id === selectedId;
            return (
              <li key={pipeline.id} className="shrink-0">
                <Link
                  href={pipelineHref(pipeline.id)}
                  // `aria-current` segue o funil REAL da página; o realce
                  // otimista mora só no visual (UI.md §5.21).
                  aria-current={pipeline.id === activeId ? "page" : undefined}
                  onClick={() => setClickedId(pipeline.id)}
                  className={cn(
                    "flex h-11 items-center gap-2 rounded-full px-3.5 font-display text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:h-9",
                    isActive
                      ? "bg-brand-gradient text-primary-foreground shadow-sm"
                      : "border border-border/70 bg-card/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {/*
                    A cor do funil só aparece na pílula inativa: sobre o
                    gradiente da marca ela brigaria com o realce que já diz
                    "este é o funil aberto". O nome, esse, está sempre lá.
                  */}
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      isActive ? "bg-primary-foreground" : getColorStyle(pipeline.color).dot
                    )}
                    aria-hidden
                  />
                  <span className="max-w-[12rem] truncate">{pipeline.name}</span>
                  {pipeline.cardCount !== undefined ? (
                    <span
                      className={cn(
                        "shrink-0 text-xs tabular-nums",
                        isActive ? "text-primary-foreground/80" : "text-muted-foreground"
                      )}
                    >
                      {pipeline.cardCount}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Link
        href="/app/configuracoes"
        className="ml-auto flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 sm:h-9"
      >
        <SlidersHorizontalIcon className="size-4" aria-hidden />
        <span className="hidden sm:inline">Gerenciar funis</span>
        <span className="sr-only sm:hidden">Gerenciar funis</span>
      </Link>
    </nav>
  );
}

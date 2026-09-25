"use client";

import Link from "next/link";
import { CalendarOffIcon, PlusIcon, SearchIcon, UsersRoundIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/data-display/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PersonCard } from "@/features/home/components/person-card";
import type { HomePerson } from "@/features/home/types";
import { useStartConversation } from "@/features/chat/hooks/use-start-conversation";
import { formatPhone } from "@/lib/formatters/phone";
import { cn } from "@/lib/utils";

type PeopleFilter = "todos" | "agendados" | "sem-agenda";

const FILTERS: ReadonlyArray<{ value: PeopleFilter; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "agendados", label: "Com sessão" },
  { value: "sem-agenda", label: "Sem sessão" },
];

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
}

/**
 * Coluna de pessoas: busca, filtros e a grade de cartões.
 *
 * A busca é local **de propósito**: a lista da tela de Início é curta (as
 * pessoas mais recentes). Quem precisa procurar na base inteira tem a tela de
 * Leads, com busca server-side — e o rodapé leva até lá.
 */
export function PeoplePanel({ people, now }: { people: HomePerson[]; now: Date }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PeopleFilter>("todos");
  const { startConversation, checkingPhone } = useStartConversation();

  const visible = useMemo(() => {
    const term = normalize(query.trim());
    return people.filter((person) => {
      if (filter === "agendados" && !person.nextAppointmentAt) return false;
      if (filter === "sem-agenda" && person.nextAppointmentAt) return false;
      if (!term) return true;
      const haystack = normalize(
        `${person.name ?? ""} ${person.phone ?? ""} ${formatPhone(person.phone)}`
      );
      return haystack.includes(term);
    });
  }, [people, query, filter]);

  return (
    <section aria-labelledby="home-people-title" className="flex min-h-0 flex-col gap-3 lg:flex-1">
      <h2 id="home-people-title" className="sr-only">
        Pessoas em acompanhamento
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Buscar pessoa</span>
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Busque uma pessoa…"
            className="h-11 rounded-full pl-9 sm:h-10"
          />
        </label>
        {/* Link com a APARÊNCIA de botão — não um Button que finge ser link: o
            primitivo do Base UI exige <button> nativo, e navegação é <a>. */}
        <Link href="/app/leads" className={cn(buttonVariants(), "h-11 shrink-0 sm:h-10")}>
          <PlusIcon data-icon="inline-start" />
          Adicionar
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((option) => {
          const active = filter === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              aria-pressed={active}
              className={cn(
                "h-9 rounded-full px-3.5 font-display text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-brand-gradient text-primary-foreground shadow-sm"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
          {visible.length} {visible.length === 1 ? "pessoa" : "pessoas"}
        </span>
      </div>

      {/* Altura controlada: a lista rola por dentro em vez de esticar a página. */}
      {/* A folga (`p-1` + `-m-1`) dá espaço para a sombra e para o hover
          que levanta o cartão — sem ela o recorte da rolagem corta os dois. */}
      <div className="-mx-1 min-h-0 px-1 py-1 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain [scrollbar-width:thin]">
        {visible.length === 0 ? (
          <EmptyState>
            {people.length === 0 ? (
              <span className="flex flex-col items-center gap-1">
                <UsersRoundIcon className="size-5 text-muted-foreground" aria-hidden />
                Nenhuma pessoa ainda. Elas aparecem aqui assim que chega a primeira conversa.
              </span>
            ) : (
              <span className="flex flex-col items-center gap-1">
                <CalendarOffIcon className="size-5 text-muted-foreground" aria-hidden />
                Ninguém encontrado com esse recorte.
              </span>
            )}
          </EmptyState>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {visible.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                now={now}
                pending={Boolean(person.phone && checkingPhone === person.phone)}
                onOpenChat={(target) => {
                  if (target.phone) void startConversation(target.phone, target.name ?? undefined);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <Link
        href="/app/leads"
        className="w-fit rounded-md text-xs font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        Ver todas as pessoas
      </Link>
    </section>
  );
}

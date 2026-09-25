"use client";

import { ChevronDownIcon, ListFilterIcon, XIcon } from "lucide-react";

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
import {
  clearChatFilters,
  countActiveFilters,
  toggleFilterValue,
  type ChatFilters,
} from "@/features/chat/lib/chat-filters";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { cn } from "@/lib/utils";
import type { Tag } from "@/features/tags/types";
import type { StatusFilter } from "@/features/chat/types";

/**
 * Filtros rápidos da lista de conversas.
 *
 * ## Por que NÃO há rolagem horizontal aqui
 *
 * A versão anterior era um trilho `overflow-x-auto` com todos os chips —
 * responsável, não lidas e cada etiqueta. Não funcionou, e
 * o problema não era o ajuste: **a quantidade de filtros não cabe numa faixa de
 * 360px e nenhum truque de rolagem conserta isso**. Roda de mouse não rola na
 * horizontal, o gesto de dois dedos vira "voltar" do navegador, a barra de
 * rolagem escondida não avisa que há mais, e o que está fora da vista é, na
 * prática, invisível.
 *
 * O desenho certo separa **o que é frequente** do **que é ocasional**:
 *
 * - **Linha 1 — sempre visível, nunca transborda.** Quatro chips que cabem:
 *   `Tudo · IA · Humano · Não lidas`. Mais o botão do painel. `flex-wrap` é a
 *   rede de segurança: se um dia não couber, quebra a linha — nunca vaza nem
 *   esconde.
 * - **Painel (dropdown).** Etiquetas, em lista vertical com
 *   marcação. Rolagem **vertical** dentro do popup, que é confiável, esperada e
 *   já vem pronta do primitivo (`max-h-(--available-height) overflow-y-auto`).
 * - **Linha 2 — só quando há etiqueta escolhida.** O que está filtrando
 *   aparece como chip removível, com `flex-wrap`. Nada fica escondido: se são
 *   seis filtros, a linha vira duas.
 *
 * Consequência boa: sumiu a engrenagem de "quais etapas aparecem". Ela existia
 * para caber tudo na faixa; com o painel, cabe tudo por construção.
 */
export function ConversationFilters({
  filters,
  onFiltersChange,
  tags,
}: {
  filters: ChatFilters;
  onFiltersChange: (next: ChatFilters) => void;
  /** Catálogo de etiquetas, já carregado pelo ChatShell. */
  tags: readonly Tag[];
}) {
  const activeCount = countActiveFilters(filters);
  // Só etiqueta vira chip na linha 2 — responsável e "não lidas" já estão
  // acesos na linha 1, e repeti-los seria dizer duas vezes a mesma coisa.
  const refinements = filters.tags.length;

  const toggleTag = (id: string) =>
    onFiltersChange({ ...filters, tags: toggleFilterValue(filters.tags, id) });

  return (
    <div className="shrink-0 px-3 pb-2 pt-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {RESPONSIBLE_TABS.map((tab) => (
          <FilterChip
            key={tab.value}
            active={filters.status === tab.value}
            onClick={() => onFiltersChange({ ...filters, status: tab.value })}
          >
            {tab.label}
          </FilterChip>
        ))}

        <FilterChip
          active={filters.unread}
          onClick={() => onFiltersChange({ ...filters, unread: !filters.unread })}
        >
          Não lidas
        </FilterChip>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={
                  refinements > 0
                    ? `Filtros: ${refinements} aplicado${refinements > 1 ? "s" : ""}`
                    : "Filtros por etapa e etiqueta"
                }
                className={cn(
                  "flex min-h-11 shrink-0 select-none items-center gap-1.5 rounded-full px-3",
                  "text-[12.5px] font-medium leading-none transition-colors sm:min-h-8",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  refinements > 0
                    ? "bg-[var(--wa-green)]/16 text-[var(--wa-green-deep)]"
                    : "bg-black/[0.045] text-[var(--wa-meta)] hover:bg-black/[0.07] hover:text-foreground dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
                )}
              />
            }
          >
            <ListFilterIcon aria-hidden className="size-3.5" />
            Filtros
            {refinements > 0 ? (
              <span className="rounded-full bg-[var(--wa-green-deep)] px-1.5 text-[10px] font-semibold leading-[16px] text-white tabular-nums">
                {refinements}
              </span>
            ) : null}
            <ChevronDownIcon aria-hidden className="size-3.5 opacity-70" />
          </DropdownMenuTrigger>

          {/* ⚠️ Largura por `style`, não por classe. O primitivo traz
              `w-(--anchor-width)` — ancorado num botão de ~90px, o painel
              nasceria com 90px e ficaria inutilizável. Sobrescrever por classe
              dependeria de o `twMerge` desduplicar a forma `w-(--var)` do
              Tailwind v4; se ele não desduplicar, as duas classes sobrevivem e
              quem vence é a ordem do CSS gerado — aposta que não vale a pena
              num painel que precisa simplesmente funcionar. Estilo inline ganha
              de qualquer classe, sempre. O `min()` impede estourar o celular. */}
          <DropdownMenuContent
            align="end"
            style={{ width: "min(19rem, calc(100vw - 1.5rem))" }}
          >
            {/* ⚠️ `DropdownMenuLabel` é o `Menu.GroupLabel` do Base UI e
                **lança** fora de um `Menu.Group`: "MenuGroupRootContext is
                missing". Sem o `DropdownMenuGroup` em volta, abrir este painel
                derrubava a tela inteira no error boundary — e typecheck, lint e
                build passam, porque só quebra na interação. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Etiquetas</DropdownMenuLabel>
              {tags.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  Nenhuma etiqueta criada ainda.
                </p>
              ) : (
                tags.map((tag) => (
                  <DropdownMenuCheckboxItem
                    key={tag.id}
                    checked={filters.tags.includes(tag.id)}
                    onCheckedChange={() => toggleTag(tag.id)}
                    className="min-h-11 sm:min-h-8"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        getColorStyle(tag.color).dot
                      )}
                    />
                    <span className="min-w-0 truncate">{tag.name}</span>
                  </DropdownMenuCheckboxItem>
                ))
              )}
            </DropdownMenuGroup>

            {activeCount > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="min-h-11 sm:min-h-8"
                  onClick={() => onFiltersChange(clearChatFilters(filters))}
                >
                  <XIcon />
                  Limpar filtros
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {refinements > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {filters.tags.map((id) => {
            const tag = tags.find((item) => item.id === id);
            if (!tag) return null;
            return (
              <ActiveFilterChip
                key={id}
                label={tag.name}
                color={tag.color}
                onRemove={() => toggleTag(id)}
              />
            );
          })}
          <button
            type="button"
            onClick={() => onFiltersChange(clearChatFilters(filters))}
            className="min-h-11 rounded-full px-2 text-[12px] font-medium text-[var(--wa-meta)] transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5 sm:min-h-8"
          >
            Limpar
          </button>
        </div>
      ) : null}
    </div>
  );
}

// "Resolvidos" saiu a pedido: conversa resolvida continua em "Tudo" e no status
// da própria linha. "Arquivadas" segue como linha de atalho abaixo, com contador.
const RESPONSIBLE_TABS: { label: string; value: StatusFilter }[] = [
  { label: "Tudo", value: "all" },
  { label: "IA", value: "bot" },
  { label: "Humano", value: "human" },
];

/**
 * Pílula do WhatsApp: fundo quase imperceptível em repouso, tinta verde quando
 * ativa. `transition-colors` e não `transition-all` — animar largura faria a
 * linha respirar a cada clique.
 */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-11 shrink-0 select-none items-center whitespace-nowrap rounded-full px-3",
        "text-[12.5px] font-medium leading-none transition-colors sm:min-h-8",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-[var(--wa-green)]/16 text-[var(--wa-green-deep)]"
          : "bg-black/[0.045] text-[var(--wa-meta)] hover:bg-black/[0.07] hover:text-foreground dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
      )}
    >
      {children}
    </button>
  );
}

/**
 * O que está filtrando agora, removível no próprio chip.
 *
 * A **pílula inteira** é o botão de remover, não um ✕ de 12px dentro dela: o
 * alvo passa a ter a largura do rótulo em vez de exigir mira. O ✕ fica como
 * ícone, dizendo o que o clique faz.
 *
 * ⚠️ Etiqueta usa a variante `badge` da paleta, **nunca** a `solid` — mesma
 * decisão de acessibilidade do `conversation-tag-chips`: `solid` foi desenhada
 * para botão, e `bg-yellow-500 text-white` dá 1,98:1. Como a cor é escolhida
 * pelo operador entre 19 opções, amarelo, lima, âmbar e ciano sairiam
 * ilegíveis. O `badge` passa no AA por construção, nos dois temas.
 */
function ActiveFilterChip({
  label,
  color,
  onRemove,
}: {
  label: string;
  /** Cor da etiqueta. Ausente = filtro de etapa, que é neutro. */
  color?: string;
  onRemove: () => void;
}) {
  const style = color ? getColorStyle(color) : null;

  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remover filtro ${label}`}
      className={cn(
        "flex min-h-11 max-w-full shrink-0 select-none items-center gap-1.5 rounded-full px-3",
        "text-[12.5px] font-medium leading-none transition-opacity hover:opacity-75 sm:min-h-8",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        style
          ? cn("border", style.badge)
          : "bg-[var(--wa-green)]/16 text-[var(--wa-green-deep)]"
      )}
    >
      {style ? (
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
      <XIcon aria-hidden className="size-3 shrink-0 opacity-70" />
    </button>
  );
}

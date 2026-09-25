import { memo } from "react";

import { getColorStyle } from "@/features/leads/schemas/colors";
import { cn } from "@/lib/utils";
import type { Tag } from "@/features/leads/types";

/**
 * Etiquetas na linha da conversa.
 *
 * ⚠️ **Usa `badge`, não `solid`, e isso é acessibilidade — não gosto.** A
 * referência do WhatsApp mostra pílula sólida com texto branco, e a variante
 * `solid` da paleta existe. Mas ela foi desenhada para botão e barra de kanban:
 * `bg-yellow-500 text-white` dá **1,98:1** de contraste, e a pessoa escolhe
 * entre as 19 cores num seletor — amarelo, lima, âmbar, ciano e azul-céu sairiam
 * ilegíveis. O `badge` (borda + fundo a 10% + texto em `-700`/`-300`) passa no
 * AA em qualquer cor **por construção**, nos dois temas.
 *
 * De quebra, é exatamente o chip que a tabela de leads já desenha para a mesma
 * tag — a etiqueta fica igual nos dois lugares do app.
 *
 * `memo` porque desce para todas as linhas. Depende de a lista entregar a MESMA
 * referência de array para conversa cuja etiqueta não mudou — é o que
 * `mergeTagAssignment` garante.
 */
export const ConversationTagChips = memo(function ConversationTagChips({
  tags,
  className,
}: {
  tags: readonly Tag[];
  className?: string;
}) {
  if (tags.length === 0) return null;

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {/* Sem o prefixo, o leitor de tela lê "Maria, Acho bom, Resolver,
          Pagamento pendente" e as duas últimas palavras parecem parte da
          mensagem. Esconder as etiquetas seria pior: elas são o estado da
          conversa, e é justamente isso que a pessoa precisa saber antes de
          decidir se abre. */}
      <span className="sr-only">Etiquetas: </span>
      {tags.map((tag) => (
        <span
          key={tag.id}
          className={cn(
            // `rounded-sm border ... text-[11px] font-medium` é o mesmo chip do
            // `lead-tags-editor`: raio da escala, não `[3px]` arbitrário.
            "max-w-full truncate rounded-sm border px-1.5 py-px",
            "text-[11px] leading-[15px] font-medium",
            getColorStyle(tag.color).badge
          )}
        >
          {tag.name}
        </span>
      ))}
    </div>
  );
});

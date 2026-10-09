"use client";

import { useLinkStatus } from "next/link";

import { cn } from "@/lib/utils";

/**
 * Faixa de progresso indeterminada na base de uma faixa de controles da agenda.
 *
 * A página de agendamentos é `force-dynamic` e refaz a consulta a cada troca de
 * visualização ou de período. Como só os *search params* mudam, o segmento não
 * remonta e o `loading.tsx` **não** aparece: a tela antiga ficava intacta por
 * quase um segundo, sem nenhum sinal de que o toque foi registrado.
 *
 * ⚠️ **Nunca ocupa espaço no fluxo.** Fica `absolute` contra o ancestral
 * posicionado mais próximo — a própria faixa que a contém — porque um indicador
 * que empurra o conteúdo é pior que indicador nenhum.
 *
 * ⚠️ **O atraso de 150 ms é proposital.** Navegação rápida termina antes disso e
 * a barra nunca chega a aparecer; sem ele, todo toque daria um flash. É a
 * recomendação da própria doc do `useLinkStatus`.
 */
export function AgendaNavProgress({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        // `bottom-0` = base da caixa de padding, ou seja, encostada na borda
        // inferior da faixa e ainda DENTRO dela. Com `-bottom-px` metade da
        // barra invadia a faixa seguinte, que é `relative` + `bg-background` e
        // pinta depois — comia 1px dos 2px.
        "pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden transition-opacity duration-200",
        active ? "opacity-100 delay-150" : "opacity-0 delay-0"
      )}
    >
      {/*
        Mesma animação da barra de envio de anexo do chat (`globals.css`).

        ⚠️ Em `prefers-reduced-motion` a regra global do `globals.css` corta
        `animation-duration` e `iteration-count`: a faixa correria uma vez, em
        0,01 ms, e pararia FORA da tela — quem pediu menos movimento ficaria sem
        indicador nenhum. Por isso ela vira uma barra parada de largura cheia.
      */}
      <span className="block h-full w-1/3 animate-[wa-indeterminate_1.1s_ease-in-out_infinite] rounded-full bg-primary motion-reduce:w-full motion-reduce:animate-none" />
    </span>
  );
}

/**
 * A mesma faixa, alimentada pelo `<Link>` que a contém.
 *
 * Precisa ser **descendente de um `Link`**: `useLinkStatus` é a única forma que
 * o Next 16 dá de saber que uma navegação começou. Fora de um `Link` o hook
 * devolve `pending: false` para sempre — e a barra nunca apareceria.
 */
export function AgendaLinkProgress() {
  const { pending } = useLinkStatus();
  return <AgendaNavProgress active={pending} />;
}

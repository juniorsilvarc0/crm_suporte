"use client";

import { useState } from "react";
import { ExternalLinkIcon, XIcon } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Pílula escura, legível sobre qualquer foto. */
const PILL =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-black/60 px-4 text-[13px] font-medium text-white backdrop-blur transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:min-h-9";

/**
 * Imagem da conversa, ampliável.
 *
 * A miniatura é um `<button>`, não um `<img>` com `onClick`: sem isso não há
 * foco nem tecla, e ver uma foto de exame exigia abrir outra aba na mão.
 *
 * O diálogo só monta quando abre — 123 imagens em produção, e um `DialogContent`
 * por bolha seria peso morto em toda conversa.
 *
 * ⚠️ Na bolha vai a MINIATURA (ver `image-variant.ts`); o original só quando
 * amplia. Servir o original nas duas pontas custava 5,5 MB de RAM por foto e
 * matava o processo do Safari no PWA.
 */
export function ImageLightbox({
  src,
  thumb,
  alt = "Imagem",
  width,
  height,
}: {
  src: string;
  /** Miniatura a exibir na bolha. Igual a `src` quando não há uma. */
  thumb: string;
  alt?: string;
  /** Dimensões originais, quando o provedor as mandou. Reservam a altura. */
  width?: number;
  height?: number;
}) {
  const [open, setOpen] = useState(false);
  // Depois da primeira abertura o diálogo fica montado, senão fechar o
  // desmontaria no mesmo render e a animação de saída não chegaria a rodar.
  // Quem nunca ampliou a imagem não paga nada.
  const [everOpened, setEverOpened] = useState(false);
  // A miniatura é outro arquivo (R2) ou outra rota (transformador do Supabase,
  // para o acervo antigo). Se ela falhar, cai no original em vez de sumir com
  // a foto.
  const [thumbFailed, setThumbFailed] = useState(false);
  const [broken, setBroken] = useState(false);

  const thumbSrc = thumbFailed ? src : thumb;
  // ⚠️ Mídia que ficou na URL do provedor não tem miniatura: `chatImageThumbUrl`
  // devolve a própria `src`. Aí não existe segunda tentativa — trocar `src` por
  // um valor idêntico não refaz requisição nenhuma, e sem esta checagem o
  // primeiro erro só marcava `thumbFailed` e a bolha ficava com o ícone de
  // imagem quebrada para sempre. Antes o `onError` escondia já na primeira vez.
  const semSegundaChance = thumbFailed || thumb === src;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setEverOpened(true);
          setOpen(true);
        }}
        aria-label="Ampliar imagem"
        className="block overflow-hidden rounded-[5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* `contents` para o <picture> não criar caixa nenhuma: quem manda na
            geometria continua sendo o <img>. */}
        <picture className="contents">
          {/*
            Monitor muito largo recebe o ORIGINAL — ali a miniatura de 640px
            apareceria esticada.

            1600px sai da conta do layout, não de chute: a coluna de mensagens é
            a tela menos a barra lateral (400px) e o respiro do
            `CHAT_COLUMN_CLASS` (~144px), e a bolha é `sm:max-w-[68%]` disso.
            Só acima de ~1650px de janela a bolha passa de 640px de largura.
            Abaixo disso o original é peso puro.

            E o limite de memória que derruba o PWA é do iPhone, não do desktop.
          */}
          {!thumbFailed && (
            <source media="(min-width: 1600px)" srcSet={src} />
          )}
          {/* Sem `eslint-disable` aqui: dentro de <picture> a regra
              `@next/next/no-img-element` não reclama. */}
          <img
            src={thumbSrc}
            alt={alt}
            width={width}
            height={height}
            loading="lazy"
            decoding="async"
            className={cn(
              "max-h-[26rem] w-full rounded-[5px] object-cover transition-opacity hover:opacity-95",
              broken && "hidden"
            )}
            onError={() => {
              if (semSegundaChance) setBroken(true);
              else setThumbFailed(true);
            }}
          />
        </picture>
      </button>

      {everOpened && (
        // `variant="dialog"`: visualizador de foto em tela cheia.
        <Dialog variant="dialog" open={open} onOpenChange={setOpen}>
          {/* O `sm:` precisa ser repetido: o primitivo tem `sm:max-w-sm`, e
              tailwind-merge trata `max-w-*` e `sm:max-w-*` como grupos
              separados — sem isso a foto ficaria espremida em 24rem no
              desktop. `ring-0` mata o anel do primitivo sobre o fundo
              transparente. */}
          <DialogContent
            showCloseButton={false}
            // Visualizador de foto continua em tela cheia — gaveta aqui não faria
            // sentido. O que faltava era a área segura: em tela cheia os
            // controles do rodapé caíam na barra de gestos do iOS.
            className="max-w-[96vw] gap-0 border-0 bg-transparent p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-none ring-0 sm:max-w-[min(96vw,72rem)]"
          >
            <DialogTitle className="sr-only">{alt}</DialogTitle>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              className="mx-auto max-h-[85dvh] w-auto max-w-full rounded-lg object-contain"
            />
            {/* Botão próprio em vez do padrão do primitivo: `ghost` sobre foto
                clara fica invisível. Esc e clique fora continuam fechando. */}
            <div className="mt-3 flex items-center justify-center gap-2">
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className={PILL}
              >
                <ExternalLinkIcon className="size-3.5" aria-hidden />
                Abrir original
              </a>
              <button type="button" onClick={() => setOpen(false)} className={PILL}>
                <XIcon className="size-3.5" aria-hidden />
                Fechar
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

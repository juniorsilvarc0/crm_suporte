"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "@/lib/utils";

/**
 * Gaveta que sobe pelo rodapé, sobre `vaul`.
 *
 * É a forma do modal no **celular**: um diálogo centrado ali nasce colado no
 * topo (embaixo do entalhe, com o botão de fechar inalcançável) e estoura a
 * altura quando o teclado sobe. A gaveta é ancorada embaixo, tem teto de
 * altura e fecha arrastando — o gesto que a pessoa já espera do sistema.
 *
 * ⚠️ `vaul` traz `@radix-ui/react-dialog` como dependência. É a **única** porta
 * do Radix neste repositório, confinada aqui dentro: os primitivos continuam
 * sendo Base UI, e o desktop nunca passa por este arquivo (ver `dialog.tsx`).
 */

function Drawer({
  // O padrão da lib encolhe a página atrás. Aqui a casca do app tem barra fixa
  // e cabeçalho grudento; encolher tudo dá um efeito de tela quebrada.
  shouldScaleBackground = false,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return (
    <DrawerPrimitive.Root
      data-slot="drawer"
      shouldScaleBackground={shouldScaleBackground}
      {...props}
    />
  );
}

function DrawerTrigger(props: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal(props: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose(props: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 supports-[backdrop-filter]:bg-black/40 supports-[backdrop-filter]:backdrop-blur-sm",
        className
      )}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  overlayClassName,
  children,
  showHandle = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content> & {
  /** A alça de arrastar. Só some quando o conteúdo tem cabeçalho próprio. */
  showHandle?: boolean;
  /**
   * Geometria do véu. Existe para a gaveta poder cobrir **uma coluna** em vez
   * da tela inteira: sem isto o véu escurece a lista de conversas junto, e a
   * gaveta deixa de parecer parte da conversa em que ela foi aberta.
   */
  overlayClassName?: string;
}) {
  return (
    <DrawerPortal>
      <DrawerOverlay className={overlayClassName} />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col",
          "rounded-t-2xl bg-popover text-popover-foreground outline-none",
          "ring-1 ring-foreground/10",
          className
        )}
        {...props}
      >
        {showHandle && (
          <div
            aria-hidden
            // `bg-current` + opacidade, não `bg-foreground`: a gaveta da tela
            // de envio tem fundo escuro fixo nos dois temas, e um punho preso
            // ao token do tema sumiria lá no claro. Herdando a cor do texto,
            // ele funciona em qualquer superfície.
            className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-current opacity-20"
          />
        )}
        {children}
        {/* A barra de gestos do iOS come a última linha do conteúdo.
            Vai como ESPAÇADOR e não como `padding-bottom: env(safe-area-inset-bottom)`
            na classe: qualquer `p-*` vindo do `className` de quem chama venceria
            o padding no `twMerge` e o respiro sumiria em silêncio. Um elemento
            não some.

            ⚠️ E não escreva o nome dessa classe com reticências literais neste
            arquivo. O Tailwind v4 varre o código atrás de candidatos a classe,
            inclusive dentro de comentário — e um `env(` com três pontos vira
            CSS inválido no bundle. Era um comentário aqui que derrubava o
            `pnpm dev` com "Parsing CSS source code failed". */}
        <div
          aria-hidden
          className="shrink-0"
          style={{ height: "env(safe-area-inset-bottom)" }}
        />
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
};

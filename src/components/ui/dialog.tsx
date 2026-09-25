"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { FloatingPortalContainerProvider } from "@/components/ui/floating-portal-context"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { useIsMobile } from "@/lib/use-media-query"
import { XIcon } from "lucide-react"

/**
 * Modal do app — **caixa centrada no desktop, gaveta no celular**.
 *
 * A troca acontece aqui, no primitivo, e não em cada tela: são 20 modais no
 * app, e mexer em todos seria 20 chances de divergir. Quem chama não muda nada.
 *
 * O motivo é concreto: no celular o diálogo centrado nascia colado no topo,
 * com o botão de fechar embaixo do entalhe do iOS e a altura estourando quando
 * o teclado subia. A gaveta é ancorada no rodapé, tem teto de altura, respeita
 * a área segura e fecha arrastando.
 *
 * Use `variant="dialog"` para escapar da troca. É para a superfície que **já**
 * tem geometria própria — sheet de anexo, lightbox e menu de contexto do chat.
 * Virar gaveta ali seria uma regressão.
 */

type DialogSurface = "dialog" | "drawer"

const DialogSurfaceContext = React.createContext<DialogSurface>("dialog")

const useDialogSurface = () => React.useContext(DialogSurfaceContext)

/**
 * Ponte entre dois sistemas de diálogo. Base UI e vaul (Radix por dentro) têm
 * formas de prop diferentes, e é **aqui** que a diferença morre — não nas 25
 * telas que chamam este componente.
 *
 * Os `as` abaixo estão confinados a esta fronteira e são todos do mesmo tipo:
 * repassar `children` e props de DOM para o outro lado. Nenhum inventa valor.
 */
function asDrawerProps<T>(props: unknown): T {
  return props as T
}

type DialogProps = DialogPrimitive.Root.Props & {
  /** `responsive` (padrão) vira gaveta no celular; `dialog` nunca troca. */
  variant?: "responsive" | "dialog"
}

function Dialog({ variant = "responsive", ...props }: DialogProps) {
  const isMobile = useIsMobile()
  const live: DialogSurface =
    variant === "dialog" || !isMobile ? "dialog" : "drawer"

  // A superfície é decidida na ABERTURA e congelada enquanto o modal está no ar.
  //
  // Sem isto, girar o telefone com um formulário aberto cruza os 640px (390px
  // em pé viram 844px deitado), a superfície troca, o conteúdo inteiro
  // desmonta e remonta — e o que já tinha sido digitado some. Ajuste durante o
  // render, o mesmo padrão do `ContactAvatar` e do `ChatView`.
  const [surface, setSurface] = React.useState(live)
  if (!props.open && surface !== live) setSurface(live)

  if (surface === "drawer") {
    const { open, defaultOpen, onOpenChange, children } = props
    return (
      <DialogSurfaceContext.Provider value="drawer">
        <Drawer
          open={open}
          defaultOpen={defaultOpen}
          // O Base UI entrega `(open, eventDetails)`; o vaul, só `(open)`.
          // Conferido nos 25 call sites: todos leem apenas o primeiro
          // argumento. O segundo vai como `undefined`, que é o que ele já é
          // para quem não o usa.
          onOpenChange={(next) =>
            onOpenChange?.(next, undefined as never)
          }
        >
          {/* O Base UI aceita `children` como função de render (payload);
              o vaul, só nós. Nenhum dos 25 call sites usa a forma de função. */}
          {children as React.ReactNode}
        </Drawer>
      </DialogSurfaceContext.Provider>
    )
  }

  return (
    <DialogSurfaceContext.Provider value="dialog">
      <DialogPrimitive.Root data-slot="dialog" {...props} />
    </DialogSurfaceContext.Provider>
  )
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  const surface = useDialogSurface()
  if (surface === "drawer") {
    return (
      <DrawerTrigger
        {...asDrawerProps<React.ComponentProps<typeof DrawerTrigger>>(props)}
      />
    )
  }
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  // A gaveta já porta o próprio conteúdo (`DrawerContent`).
  const surface = useDialogSurface()
  if (surface === "drawer") return <>{props.children}</>
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  const surface = useDialogSurface()
  if (surface === "drawer") {
    return (
      <DrawerClose
        {...asDrawerProps<React.ComponentProps<typeof DrawerClose>>(props)}
      />
    )
  }
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 duration-100 supports-[backdrop-filter]:bg-black/40 supports-[backdrop-filter]:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  overlayClassName,
  presentation = "modal",
  portalContainer,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  overlayClassName?: string
  /** `sheet` ocupa o contêiner do portal e entra lateralmente pela direita. */
  presentation?: "modal" | "sheet"
  /** Ancora o portal numa região da tela em vez de usar o `<body>`. */
  portalContainer?: DialogPrimitive.Portal.Props["container"]
}) {
  const surface = useDialogSurface()
  const drawerContentRef = React.useRef<HTMLDivElement>(null)

  if (surface === "drawer") {
    return (
      <DrawerContent
        ref={drawerContentRef}
        // A alça já sinaliza como fechar; com o X vira ruído no topo.
        showHandle
        className={cn(
          "gap-0 p-4",
          className,
          // ⚠️ Depois do `className`, de propósito. Os modais do app passam
          // geometria de CAIXA — o `ModalShell` manda `w-[calc(100vw-2rem)]` e
          // `rounded-xl`. Numa gaveta isso vira uma folha 32px mais estreita
          // que a tela, encostada à esquerda, e com canto arredondado embaixo.
          // Gaveta ocupa a largura toda e só arredonda em cima; isto não é
          // negociável por quem chama.
          "inset-x-0 w-auto max-w-none rounded-t-2xl rounded-b-none"
        )}
        {...asDrawerProps<React.ComponentProps<typeof DrawerContent>>(props)}
      >
        <FloatingPortalContainerProvider value={drawerContentRef}>
          {children}
          {/* A alça já ensina o gesto, mas o X fica: o `ModalShell` reserva
              `pr-16` no cabeçalho contando com ele, e sem o botão sobra um vão.
              Vem depois de `children` para ficar por cima do cabeçalho. */}
          {showCloseButton && (
            <DrawerClose
              className="absolute top-3 right-3 flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <XIcon className="size-[18px]" />
              <span className="sr-only">Fechar</span>
            </DrawerClose>
          )}
        </FloatingPortalContainerProvider>
      </DrawerContent>
    )
  }

  const isSheet = presentation === "sheet"

  return (
    <DialogPortal
      container={portalContainer}
      className={cn(
        isSheet && "pointer-events-none absolute inset-0 z-50 overflow-hidden"
      )}
    >
      <DialogOverlay
        className={cn(
          isSheet &&
            cn(
              "pointer-events-auto absolute data-closed:pointer-events-none",
              // ⚠️ **Sheet contido não borra o fundo.** Duas razões, e a
              // primeira é um defeito de verdade: no WebKit, um elemento com
              // `backdrop-filter` dentro de ancestral que recorta (`overflow`)
              // e cria contexto de empilhamento pode amostrar a VIEWPORT
              // inteira no quadro em que a camada de composição é desmontada.
              // Era o clarão de tela cheia ao fechar a tela de contato no PWA.
              // A segunda razão é que o painel cobre 100% do contêiner: não há
              // o que ver através do véu, então o blur nunca teve função aqui.
              "supports-[backdrop-filter]:backdrop-blur-none",
              // Acompanha o painel (200ms). Em 100ms o véu sumia com o painel
              // ainda deslizando, e a metade final da saída acontecia sem ele.
              "duration-200"
            ),
          overlayClassName
        )}
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          isSheet
            ? "pointer-events-auto absolute inset-0 z-50 flex h-full w-full flex-col overflow-hidden bg-background text-foreground duration-200 outline-none data-open:animate-in data-open:slide-in-from-right data-closed:pointer-events-none data-closed:animate-out data-closed:slide-out-to-right"
            : "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2 size-11 sm:size-9"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Fechar</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogClose render={<Button variant="outline" />}>
          Fechar
        </DialogClose>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  const surface = useDialogSurface()
  const classes = cn(
    "font-heading text-base leading-none font-medium",
    className
  )
  if (surface === "drawer") {
    return (
      <DrawerTitle
        className={classes}
        {...asDrawerProps<React.ComponentProps<typeof DrawerTitle>>(props)}
      />
    )
  }
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={classes}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  const surface = useDialogSurface()
  const classes = cn(
    "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
    className
  )
  if (surface === "drawer") {
    return (
      <DrawerDescription
        className={classes}
        {...asDrawerProps<React.ComponentProps<typeof DrawerDescription>>(props)}
      />
    )
  }
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={classes}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}

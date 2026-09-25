"use client";

import { useEffect, useRef, useState } from "react";
import {
  DownloadIcon,
  PlusSquareIcon,
  ShareIcon,
  SmartphoneIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LogoMark } from "@/components/ui/logo-mark";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type Mode = "hidden" | "android" | "ios";

const DISMISS_KEY = "pwa-install-dismissed-v1";
const SHOW_DELAY_MS = 1500;

export function InstallPwaBanner() {
  const [mode, setMode] = useState<Mode>("hidden");
  const [iosOpen, setIosOpen] = useState(false);
  const [entered, setEntered] = useState(false);
  const promptEvent = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    let dismissed = false;
    try {
      dismissed = Boolean(window.localStorage.getItem(DISMISS_KEY));
    } catch {
      /* localStorage unavailable */
    }
    if (dismissed) return;

    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/i.test(ua);

    let revealDelay: ReturnType<typeof setTimeout> | null = null;
    let enterDelay: ReturnType<typeof setTimeout> | null = null;

    const reveal = (next: Exclude<Mode, "hidden">) => {
      setMode(next);
      enterDelay = setTimeout(() => setEntered(true), 20);
    };

    if (isIOS) {
      revealDelay = setTimeout(() => reveal("ios"), SHOW_DELAY_MS);
      return () => {
        if (revealDelay) clearTimeout(revealDelay);
        if (enterDelay) clearTimeout(enterDelay);
      };
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      promptEvent.current = event as BeforeInstallPromptEvent;
      revealDelay = setTimeout(() => reveal("android"), SHOW_DELAY_MS);
    };

    const onInstalled = () => {
      promptEvent.current = null;
      setEntered(false);
      setMode("hidden");
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (revealDelay) clearTimeout(revealDelay);
      if (enterDelay) clearTimeout(enterDelay);
    };
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setEntered(false);
    setTimeout(() => setMode("hidden"), 200);
  }

  async function handleInstallClick() {
    if (mode === "ios") {
      setIosOpen(true);
      return;
    }

    const event = promptEvent.current;
    if (!event) return;

    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === "accepted") {
        setEntered(false);
        setTimeout(() => setMode("hidden"), 200);
      }
    } catch {
      /* user cancelled */
    } finally {
      promptEvent.current = null;
    }
  }

  if (mode === "hidden") return null;

  return (
    <>
      <div
        role="dialog"
        aria-labelledby="install-banner-title"
        aria-describedby="install-banner-description"
        className={cn(
          "pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3",
          "bottom-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom)+0.5rem)] lg:bottom-6",
          "lg:inset-x-auto lg:right-6 lg:px-0"
        )}
      >
        <div
          className={cn(
            "pointer-events-auto w-full max-w-sm rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85",
            "motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-out",
            entered
              ? "translate-y-0 opacity-100"
              : "motion-safe:translate-y-3 motion-safe:opacity-0"
          )}
        >
          <div className="flex items-start gap-3 p-3.5 sm:p-4">
            <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-accent/50">
              <LogoMark size={30} aria-label={siteConfig.name} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p
                    id="install-banner-title"
                    className="truncate text-sm font-semibold leading-5"
                  >
                    Instalar {siteConfig.name}
                  </p>
                  <p
                    id="install-banner-description"
                    className="mt-0.5 text-xs leading-snug text-muted-foreground"
                  >
                    {mode === "ios"
                      ? "Acesso rápido como app no iPhone."
                      : "Acesso rápido como app no celular."}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={dismiss}
                  aria-label="Dispensar"
                  className="-mr-1.5 -mt-1 size-10 shrink-0 text-muted-foreground"
                >
                  <XIcon className="size-4" />
                </Button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  type="button"
                  onClick={handleInstallClick}
                  className="h-11 flex-1 gap-2 text-sm"
                >
                  {mode === "ios" ? (
                    <SmartphoneIcon className="size-4" />
                  ) : (
                    <DownloadIcon className="size-4" />
                  )}
                  {mode === "ios" ? "Como instalar" : "Instalar agora"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={dismiss}
                  className="h-11 px-3 text-sm text-muted-foreground hover:text-foreground"
                >
                  Agora não
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={iosOpen} onOpenChange={setIosOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar à tela de início</DialogTitle>
            <DialogDescription>
              No Safari, siga os 3 passos abaixo para instalar como app.
            </DialogDescription>
          </DialogHeader>
          <ol className="mt-2 grid gap-3 text-sm">
            <IosStep number={1} icon={<ShareIcon className="size-4" />}>
              Toque no ícone <span className="font-medium">Compartilhar</span> na barra
              inferior do Safari.
            </IosStep>
            <IosStep number={2} icon={<PlusSquareIcon className="size-4" />}>
              Selecione{" "}
              <span className="font-medium">&quot;Adicionar à Tela de Início&quot;</span>.
            </IosStep>
            <IosStep number={3} icon={<SmartphoneIcon className="size-4" />}>
              Toque em <span className="font-medium">&quot;Adicionar&quot;</span> e pronto
              — o app aparece como ícone.
            </IosStep>
          </ol>
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              onClick={() => {
                setIosOpen(false);
                dismiss();
              }}
              className="h-11"
            >
              Entendi
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function IosStep({
  number,
  icon,
  children,
}: {
  number: number;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 inline-flex size-7 items-center justify-center rounded-md bg-background text-muted-foreground">
          {icon}
        </div>
        <p className="text-sm leading-snug text-foreground">{children}</p>
      </div>
    </li>
  );
}

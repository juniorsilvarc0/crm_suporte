"use client";

import type { FormEventHandler, ReactNode, RefObject } from "react";

import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ModalShellProps = {
  title: ReactNode;
  description?: ReactNode;
  headerExtra?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  size?: "compact" | "medium" | "wide";
  formRef?: RefObject<HTMLFormElement | null>;
  onSubmit?: FormEventHandler<HTMLFormElement>;
};

export function ModalShell({
  title,
  description,
  headerExtra,
  children,
  footer,
  className,
  bodyClassName,
  size = "wide",
  formRef,
  onSubmit,
}: ModalShellProps) {
  const body = (
    <>
      <DialogHeader className="shrink-0 border-b border-border/70 px-5 py-4 pr-16 sm:px-7 sm:pr-16">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <DialogTitle className="text-lg font-semibold leading-tight">{title}</DialogTitle>
            {description ? (
              <DialogDescription className="mt-1 max-w-3xl">{description}</DialogDescription>
            ) : null}
          </div>
          {headerExtra ? <div className="shrink-0">{headerExtra}</div> : null}
        </div>
      </DialogHeader>
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 [-webkit-overflow-scrolling:touch] sm:px-7 sm:py-6",
          bodyClassName
        )}
      >
        {children}
      </div>
      {footer ? (
        <div className="shrink-0 border-t border-border/70 bg-card/95 px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-7">
          {footer}
        </div>
      ) : null}
    </>
  );

  return (
    <DialogContent
      showCloseButton
      className={cn(
        "flex w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-xl p-0",
        size === "wide" && "h-[95dvh] max-w-[97vw] sm:max-w-5xl",
        size === "medium" && "max-h-[90dvh] sm:max-w-xl",
        size === "compact" && "max-h-[90dvh] sm:max-w-md",
        className
      )}
    >
      {onSubmit ? (
        <form ref={formRef} onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          {body}
        </form>
      ) : body}
    </DialogContent>
  );
}

export function ModalFooterActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>;
}

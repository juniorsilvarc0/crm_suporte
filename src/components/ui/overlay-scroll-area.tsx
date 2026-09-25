"use client";

import * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";

import { cn } from "@/lib/utils";

type OverlayScrollAreaProps = ScrollAreaPrimitive.Root.Props & {
  viewportClassName?: string;
  orientation?: "vertical" | "horizontal" | "both";
};

function OverlayScrollArea({
  className,
  viewportClassName,
  orientation = "vertical",
  children,
  ...props
}: OverlayScrollAreaProps) {
  const showVertical = orientation === "vertical" || orientation === "both";
  const showHorizontal = orientation === "horizontal" || orientation === "both";

  return (
    <ScrollAreaPrimitive.Root
      data-slot="overlay-scroll-area"
      className={cn("relative min-h-0 overflow-hidden rounded-[inherit]", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="overlay-scroll-area-viewport"
        className={cn(
          "size-full min-h-0 rounded-[inherit] overscroll-contain outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          viewportClassName
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>

      {showVertical ? <OverlayScrollBar orientation="vertical" /> : null}
      {showHorizontal ? <OverlayScrollBar orientation="horizontal" /> : null}
      <ScrollAreaPrimitive.Corner className="bg-transparent" />
    </ScrollAreaPrimitive.Root>
  );
}

function OverlayScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="overlay-scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "z-10 flex touch-none select-none p-0.5 opacity-70 transition-opacity hover:opacity-100 data-horizontal:h-2.5 data-horizontal:flex-col data-vertical:h-full data-vertical:w-2.5",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="overlay-scroll-area-thumb"
        className="relative flex-1 rounded-full bg-muted-foreground/25 transition-colors hover:bg-muted-foreground/45"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { OverlayScrollArea, OverlayScrollBar };

'use client'

import * as React from "react"
import { cn } from "@/lib/utils"
import { LogoMark } from "@/components/ui/logo-mark"
import { siteConfig } from "@/config/site"

type BrandLoaderProps = {
  fullscreen?: boolean
  label?: string
  size?: number
  className?: string
}

export function BrandLoader({
  fullscreen = true,
  label = siteConfig.name,
  size = 120,
  className,
}: BrandLoaderProps) {
  const cycleDurationMs = 2200
  const [cycleKey, setCycleKey] = React.useState(0)

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      setCycleKey((current) => current + 1)
    }, cycleDurationMs)

    return () => window.clearInterval(interval)
  }, [])

  return (
    <div
      className={cn(
        fullscreen
          ? "fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/88 backdrop-blur-xl backdrop-saturate-150"
          : "flex flex-col items-center justify-center",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="flex flex-col items-center gap-8 text-primary">
        <style>{`
          .brand-loader-mark {
            animation: brand-loader-descent ${cycleDurationMs}ms cubic-bezier(0.22, 1, 0.36, 1) both;
            will-change: transform, opacity, filter;
          }

          @keyframes brand-loader-descent {
            0% {
              opacity: 0;
              transform: translateY(-42px) scale(0.94);
              filter: blur(6px);
            }
            16% {
              opacity: 1;
              transform: translateY(-12px) scale(1);
              filter: blur(0);
            }
            72% {
              opacity: 1;
              transform: translateY(28px) scale(1);
              filter: blur(0);
            }
            100% {
              opacity: 0;
              transform: translateY(56px) scale(0.98);
              filter: blur(4px);
            }
          }
        `}</style>

        <div
          className="relative flex items-start justify-center"
          style={{ height: size + 56 }}
        >
          <LogoMark
            key={cycleKey}
            size={size}
            className="brand-loader-mark"
            aria-label={label}
          />
        </div>

        {label ? (
          <div className="brand-loader-text text-sm font-medium uppercase tracking-[0.22em] text-muted-foreground">
            {label}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default BrandLoader

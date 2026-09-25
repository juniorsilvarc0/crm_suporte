import * as React from "react"
import Image from "next/image"

import { siteConfig } from "@/config/site"
import { cn } from "@/lib/utils"

// Proporção natural da marca (public/brand/logo*.png: 550×586).
const LOGO_RATIO = 550 / 586

type LogoMarkProps = {
  size?: number
  className?: string
  "aria-label"?: string
}

// Marca do produto (`src/config/site.ts`). `size` é a ALTURA em px; a largura segue a proporção
// natural do arquivo. No tema escuro troca para a versão branca da marca.
export function LogoMark({
  size = 104,
  className,
  "aria-label": ariaLabel = siteConfig.name,
}: LogoMarkProps) {
  const width = Math.round(size * LOGO_RATIO)

  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      role="img"
      aria-label={ariaLabel}
    >
      <Image
        src="/brand/logo.png"
        alt=""
        aria-hidden
        width={width}
        height={size}
        className="dark:hidden"
        style={{ width, height: size }}
      />
      <Image
        src="/brand/logo-branca.png"
        alt=""
        aria-hidden
        width={width}
        height={size}
        className="hidden dark:block"
        style={{ width, height: size }}
      />
    </span>
  )
}

export default LogoMark
